import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFrameRegistry } from '../../lib/core/frame-registry';
import { defineMaterial } from '../../lib/core/material';
import { createCurrentWritable } from '../../lib/core/current-value';
import type { RenderMode } from '../../lib/core/types';

const { createRendererMock } = vi.hoisted(() => ({ createRendererMock: vi.fn() }));
vi.mock('../../lib/core/renderer', () => ({ createRenderer: createRendererMock }));
import { createSpektralRuntimeLoop } from '../../lib/core/runtime-loop';

let queue: FrameRequestCallback[] = [];
let resized: ResizeObserverCallback;
const loops: ReturnType<typeof createSpektralRuntimeLoop>[] = [];
async function tick(timestamp = 16): Promise<void> {
	const callback = queue.shift();
	expect(callback).toBeDefined();
	callback!(timestamp);
	for (let index = 0; index < 6; index += 1) await Promise.resolve();
}
function setup(renderMode: RenderMode = 'on-demand') {
	const registry = createFrameRegistry({ renderMode });
	const material = defineMaterial({
		fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
	});
	const render = vi.fn();
	createRendererMock.mockResolvedValue({ render, destroy: vi.fn(), flushStorageWrites: vi.fn() });
	const canvas = {
		width: 0,
		height: 0,
		getBoundingClientRect: () => ({ width: 64, height: 64 })
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
		reportError: vi.fn()
	});
	loops.push(loop);
	return { registry, loop, render };
}
async function settle(): Promise<void> {
	await tick(16);
	await tick(32);
	await tick(48);
}
it('keeps always rendering after a transient task failure', async () => {
	const { registry, render } = setup('always');
	const callback = vi.fn().mockImplementationOnce(() => {
		throw new Error('Transient task failure');
	});
	registry.register('transient', callback);
	await tick(16);
	await tick(32);
	expect(callback).toHaveBeenCalledTimes(1);
	expect(render).not.toHaveBeenCalled();
	expect(queue).toHaveLength(1);
	await tick(48);
	expect(callback).toHaveBeenCalledTimes(2);
	expect(render).toHaveBeenCalledTimes(1);
});
beforeEach(() => {
	queue = [];
	createRendererMock.mockReset();
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		queue.push(callback);
		return queue.length;
	});
	vi.stubGlobal(
		'cancelAnimationFrame',
		vi.fn(() => {
			queue = [];
		})
	);
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor(callback: ResizeObserverCallback) {
				resized = callback;
			}
			observe() {}
			disconnect() {}
		}
	);
});

function resize(width: number, height: number, contentBox: boolean): void {
	resized(
		[
			{
				...(contentBox ? { contentBoxSize: [{ inlineSize: width, blockSize: height }] } : {}),
				contentRect: { width, height }
			} as unknown as ResizeObserverEntry
		],
		{} as ResizeObserver
	);
}

it.each([true, false])(
	'redraws changed on-demand dimensions (contentBox=%s)',
	async (contentBox) => {
		const { render } = setup();
		await settle();
		resize(64, 64, contentBox);
		await tick(64);
		expect(render).toHaveBeenCalledTimes(1);
		resize(128, 96, contentBox);
		await tick(80);
		expect(render).toHaveBeenCalledTimes(2);
		expect(render.mock.lastCall?.[0].canvasSize).toEqual({ width: 128, height: 96 });
		resize(128, 96, contentBox);
		await tick(96);
		expect(render).toHaveBeenCalledTimes(2);
		expect(queue).toHaveLength(0);
	}
);

it('keeps resized manual canvases waiting for advance', async () => {
	const { loop, render } = setup('manual');
	await tick(16);
	await tick(32);
	resize(128, 96, true);
	await tick(48);
	expect(render).not.toHaveBeenCalled();
	loop.advance();
	await tick(64);
	expect(render).toHaveBeenCalledTimes(1);
	expect(render.mock.lastCall?.[0].canvasSize).toEqual({ width: 128, height: 96 });
});
afterEach(() => {
	for (const loop of loops.splice(0)) loop.destroy();
	vi.unstubAllGlobals();
});

it('wakes an idle on-demand loop when a task starts and idles after it stops', async () => {
	const { registry, render, loop } = setup();
	const callback = vi.fn();
	const handle = registry.register('task', callback, { autoStart: false });
	await settle();
	expect(queue).toHaveLength(0);
	handle.start();
	await tick(64);
	expect(callback).toHaveBeenCalledTimes(1);
	expect(render).toHaveBeenCalledTimes(2);
	handle.stop();
	await tick(80);
	expect(queue).toHaveLength(0);
	loop.destroy();
	handle.start();
	expect(queue).toHaveLength(0);
});

it('continues polling on-change tokens without submitting unchanged frames', async () => {
	const { registry, render } = setup();
	let token = 0;
	registry.register('task', () => {}, { invalidation: { mode: 'on-change', token: () => token } });
	await settle();
	expect(render).toHaveBeenCalledTimes(1);
	token = 1;
	await tick(64);
	expect(render).toHaveBeenCalledTimes(2);
	await tick(80);
	expect(render).toHaveBeenCalledTimes(2);
});

it('observes a running predicate becoming true after idle GPU frames', async () => {
	const { registry, render } = setup();
	let running = false;
	const callback = vi.fn();
	registry.register('task', callback, { running: () => running });
	await settle();
	expect(callback).not.toHaveBeenCalled();
	running = true;
	await tick(64);
	expect(callback).toHaveBeenCalledTimes(1);
	expect(render).toHaveBeenCalledTimes(2);
});

it('runs non-invalidating callbacks and sleeps after their removal', async () => {
	const { registry, render } = setup();
	const callback = vi.fn();
	const handle = registry.register('task', callback, { invalidation: 'never' });
	await settle();
	await tick(64);
	expect(callback).toHaveBeenCalledTimes(3);
	expect(render).toHaveBeenCalledTimes(1);
	handle.unsubscribe();
	await tick(80);
	expect(queue).toHaveLength(0);
});

it('wakes for tasks registered after the loop becomes idle', async () => {
	const { registry } = setup();
	await settle();
	const callback = vi.fn();
	registry.register('late', callback);
	await tick(64);
	expect(callback).toHaveBeenCalledTimes(1);
});

it('keeps custom stage callbacks alive even without tasks', async () => {
	const { registry } = setup();
	await settle();
	const callback = vi.fn();
	registry.createStage('custom', { callback });
	await tick(64);
	await tick(80);
	expect(callback).toHaveBeenCalledTimes(2);
	registry.createStage('custom', { callback: null });
	await tick(96);
	expect(queue).toHaveLength(0);
});

it('keeps manual tasks gated by explicit frame requests', async () => {
	const { registry, loop, render } = setup('manual');
	await tick(16);
	await tick(32);
	expect(queue).toHaveLength(0);
	const callback = vi.fn();
	const handle = registry.register('task', callback, { autoStart: false });
	handle.start();
	expect(queue).toHaveLength(0);
	loop.advance();
	await tick(64);
	expect(callback).toHaveBeenCalledTimes(1);
	expect(render).toHaveBeenCalledTimes(1);
	expect(queue).toHaveLength(0);
});
