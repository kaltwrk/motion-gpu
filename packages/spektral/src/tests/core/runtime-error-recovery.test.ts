import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCurrentWritable } from '../../lib/core/current-value';
import { createFrameRegistry } from '../../lib/core/frame-registry';
import { defineMaterial } from '../../lib/core/material';
import type { SpektralRuntimeLoop } from '../../lib/core/runtime-loop';

const { createRendererMock } = vi.hoisted(() => ({ createRendererMock: vi.fn() }));
vi.mock('../../lib/core/renderer', () => ({ createRenderer: createRendererMock }));
import { createSpektralRuntimeLoop } from '../../lib/core/runtime-loop';

let now = 0;
let nextFrameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const loops: SpektralRuntimeLoop[] = [];

async function elapse(milliseconds: number) {
	now += milliseconds;
	await vi.advanceTimersByTimeAsync(milliseconds);
}

async function drainFrames() {
	for (let i = 0; frames.size > 0 && i < 10; i += 1) {
		const [id, callback] = frames.entries().next().value!;
		frames.delete(id);
		await elapse(16);
		callback(now);
		for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
	}
	expect(frames.size).toBe(0);
}

function setup(mode: 'on-demand' | 'manual', failInitialization = false) {
	const registry = createFrameRegistry();
	registry.setRenderMode(mode);
	const render = vi.fn();
	createRendererMock.mockResolvedValue({ render, destroy: vi.fn(), flushStorageWrites: vi.fn() });
	if (failInitialization)
		createRendererMock.mockRejectedValueOnce(new Error('initialization failure'));
	const reportError = vi.fn();
	const material = defineMaterial({
		fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }'
	});
	const canvas = {
		width: 0,
		height: 0,
		getBoundingClientRect: () => ({ width: 16, height: 16 })
	} as HTMLCanvasElement;
	const loop = createSpektralRuntimeLoop({
		canvas,
		registry,
		size: createCurrentWritable({ width: 0, height: 0 }),
		dpr: createCurrentWritable(1),
		maxDelta: createCurrentWritable(0.1),
		getMaterial: () => material,
		getRenderTargets: () => ({}),
		getPasses: () => [],
		getClearColor: () => [0, 0, 0, 1],
		getAdapterOptions: () => undefined,
		getDeviceDescriptor: () => undefined,
		getOnError: () => undefined,
		reportError
	});
	loops.push(loop);
	return {
		registry,
		loop,
		render,
		reportError,
		lastReport: () => reportError.mock.calls.at(-1)?.[0],
		async failFrame() {
			let failedAt = 0;
			render.mockImplementationOnce(() => {
				failedAt = now;
				throw new Error('temporary failure');
			});
			loop.advance();
			await drainFrames();
			return failedAt;
		},
		async recover() {
			loop.advance();
			await drainFrames();
			expect(render.mock.results.at(-1)?.type).toBe('return');
		},
		reportAsyncError(error: Error) {
			const options = createRendererMock.mock.calls.at(-1)![0] as {
				reportAsyncError: (error: Error) => void;
			};
			options.reportAsyncError(error);
		}
	};
}

beforeEach(() => {
	now = 0;
	nextFrameId = 0;
	frames.clear();
	vi.useFakeTimers();
	createRendererMock.mockReset();
	vi.stubGlobal('performance', { now: () => now });
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		const id = ++nextFrameId;
		frames.set(id, callback);
		return id;
	});
	vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		}
	);
});

afterEach(() => {
	for (const loop of loops.splice(0)) loop.destroy();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe.each(['on-demand', 'manual'] as const)('%s error recovery', (mode) => {
	it('clears a recovered frame-task error even when the task does not render', async () => {
		const fixture = setup(mode);
		await drainFrames();
		let failing = true;
		let failedAt = 0;
		const task = fixture.registry.register(
			'transient-task',
			() => {
				if (failing) {
					failedAt = now;
					throw new Error('task failure');
				}
				task.stop();
			},
			{ invalidation: { mode: 'never' } }
		);
		fixture.loop.advance();
		await drainFrames();
		expect(fixture.lastReport()?.message).toContain('task failure');
		const renderCount = fixture.render.mock.calls.length;
		failing = false;
		fixture.loop.requestFrame();
		await drainFrames();
		expect(fixture.render).toHaveBeenCalledTimes(renderCount);
		await elapse(failedAt + 750 - now);
		expect(fixture.lastReport()).toBeNull();
	});

	it('clears a recovered error after the grace period without scheduling GPU frames', async () => {
		const fixture = setup(mode);
		await drainFrames();
		const failedAt = await fixture.failFrame();
		await fixture.recover();
		const renderCount = fixture.render.mock.calls.length;
		await elapse(failedAt + 749 - now);
		expect(fixture.lastReport()?.message).toContain('temporary failure');
		await elapse(1);
		expect(fixture.lastReport()).toBeNull();
		expect(frames.size).toBe(0);
		expect(fixture.render).toHaveBeenCalledTimes(renderCount);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not clear an unrecovered error on an idle scheduler tick', async () => {
		const fixture = setup(mode);
		await drainFrames();
		await fixture.failFrame();
		const renderCount = fixture.render.mock.calls.length;
		await elapse(1000);
		fixture.loop.requestFrame();
		await drainFrames();
		expect(fixture.render).toHaveBeenCalledTimes(renderCount);
		expect(fixture.lastReport()?.message).toContain('temporary failure');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('restarts the grace period when the same deduplicated error returns', async () => {
		const fixture = setup(mode);
		await drainFrames();
		const firstFailure = await fixture.failFrame();
		await fixture.recover();
		await elapse(200);
		const secondFailure = await fixture.failFrame();
		await fixture.recover();
		await elapse(firstFailure + 750 - now);
		expect(fixture.reportError).toHaveBeenCalledTimes(1);
		expect(fixture.lastReport()?.message).toContain('temporary failure');
		await elapse(secondFailure + 750 - now);
		expect(fixture.reportError).toHaveBeenCalledTimes(2);
		expect(fixture.lastReport()).toBeNull();
	});

	it('cancels pending recovery if the error returns without another successful frame', async () => {
		const fixture = setup(mode);
		await drainFrames();
		await fixture.failFrame();
		await fixture.recover();
		await elapse(200);
		await fixture.failFrame();
		await elapse(2000);
		expect(fixture.reportError).toHaveBeenCalledTimes(1);
		expect(fixture.lastReport()?.message).toContain('temporary failure');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cancels pending recovery and ignores late reports after destroy', async () => {
		const fixture = setup(mode);
		await drainFrames();
		await fixture.failFrame();
		await fixture.recover();
		expect(vi.getTimerCount()).toBe(1);
		fixture.loop.destroy();
		expect(vi.getTimerCount()).toBe(0);
		const reportCount = fixture.reportError.mock.calls.length;
		fixture.reportAsyncError(new Error('late callback'));
		await elapse(1000);
		expect(fixture.reportError).toHaveBeenCalledTimes(reportCount);
		expect(frames.size).toBe(0);
	});

	it('times an asynchronous error from its arrival after a long idle period', async () => {
		const fixture = setup(mode);
		await drainFrames();
		await elapse(5000);
		const failedAt = now;
		fixture.reportAsyncError(new Error('asynchronous failure'));
		await fixture.recover();
		expect(fixture.lastReport()?.message).toContain('asynchronous failure');
		await elapse(failedAt + 750 - now);
		expect(fixture.lastReport()).toBeNull();
	});

	it('clears an initialization failure after a successful retry even without manual advance', async () => {
		const fixture = setup(mode, true);
		await drainFrames();
		const failedAt = now;
		expect(fixture.lastReport()?.phase).toBe('initialization');
		await elapse(250);
		await drainFrames();
		expect(createRendererMock).toHaveBeenCalledTimes(2);
		if (mode === 'manual') expect(fixture.render).not.toHaveBeenCalled();
		await elapse(failedAt + 750 - now);
		expect(fixture.lastReport()).toBeNull();
		expect(frames.size).toBe(0);
	});
});
