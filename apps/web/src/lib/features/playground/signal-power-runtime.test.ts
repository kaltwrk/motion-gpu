import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCurrentWritable, type FrameState, type LoadedTexture } from 'spektral';

const media = vi.hoisted(() => ({
	ready: false,
	paused: false,
	currentTime: 3,
	duration: 18,
	sync: vi.fn(),
	dispose: vi.fn(),
	seek: vi.fn(),
	play: vi.fn(),
	pause: vi.fn()
}));
vi.mock('$lib/site/demos/signal/media', () => ({ createSignalVideo: () => media }));
vi.mock('$lib/site/demos/signal/geometry', () => ({
	projectSignalScreen: (
		uv: [number, number],
		_w: number,
		_h: number,
		_inspect: number[],
		clip = true
	) => (!clip || (uv[0] > 0.1 && uv[0] < 0.9 && uv[1] > 0.2 && uv[1] < 0.8) ? uv : null),
	hitSignalPowerButton: (uv: [number, number]) => uv[0] < 0.1 && uv[1] < 0.1
}));

import { createSignalRuntime } from '$lib/site/demos/signal/interaction';

afterEach(() => vi.unstubAllGlobals());

describe('Signal power and scheduler integration', () => {
	it('gates first boot, seeks only fully on, sleeps when off and starts from the physical button', () => {
		vi.stubGlobal('window', { location: { href: 'http://localhost/playground/embed' } });
		media.play.mockImplementation(() => {
			media.paused = false;
		});
		media.pause.mockImplementation(() => {
			media.paused = true;
		});
		const canvas = {
			getBoundingClientRect: () => ({ width: 800, height: 600 })
		} as HTMLCanvasElement;
		const frame = {
			time: 0,
			delta: 1 / 60,
			setTexture: vi.fn(),
			setUniform: vi.fn(),
			writeStorageBuffer: vi.fn(),
			readStorageBuffer: vi.fn(async () => new ArrayBuffer(0)),
			invalidate: vi.fn(),
			advance: vi.fn(),
			renderMode: 'on-demand',
			autoRender: true,
			canvas
		} satisfies FrameState;
		const runtime = createSignalRuntime(() => canvas, vi.fn());
		const dispose = runtime.mount();
		const labels = {
			textures: createCurrentWritable<LoadedTexture[] | null>(null),
			error: createCurrentWritable<Error | null>(null)
		};
		const idle = {
			uv: [0.5, 0.5] as [number, number],
			ndc: [0, 0] as [number, number],
			px: [400, 300] as [number, number],
			inside: false,
			pressed: false
		};
		const tick = (count: number) => {
			for (let i = 0; i < count; i++) runtime.update(frame, idle, labels);
		};
		const down = { button: 0, type: 'pointerdown' } as PointerEvent;
		const up = { button: 0, type: 'pointerup' } as PointerEvent;
		tick(120);
		expect(frame.setUniform).not.toHaveBeenCalled();
		expect(frame.invalidate).not.toHaveBeenCalled();
		media.ready = true;
		tick(80);
		expect(frame.setUniform).toHaveBeenCalledWith('uRaster', [1, 1, 1, 0]);

		const dragged = {
			...idle,
			uv: [0.7, 0.5] as [number, number],
			px: [560, 300] as [number, number]
		};
		runtime.pointerOptions.onDown(idle, down);
		runtime.pointerOptions.onMove(dragged);
		runtime.pointerOptions.onUp(dragged, up);
		expect(media.seek).toHaveBeenCalled();
		expect(media.play).toHaveBeenCalledTimes(1);

		runtime.pointerOptions.onDown(idle, down);
		runtime.pointerOptions.onUp(idle, up);
		expect(media.paused).toBe(true);
		tick(60);
		expect(frame.setUniform).toHaveBeenCalledWith('uRaster', [0, 0, 0, 0]);
		frame.setUniform.mockClear();
		frame.invalidate.mockClear();
		tick(120);
		expect(frame.setUniform).not.toHaveBeenCalled();
		expect(frame.invalidate).not.toHaveBeenCalled();

		media.seek.mockClear();
		media.play.mockClear();
		runtime.pointerOptions.onDown(idle, down);
		runtime.pointerOptions.onMove(dragged);
		runtime.pointerOptions.onUp(dragged, up);
		expect(media.seek).not.toHaveBeenCalled();
		expect(media.play).not.toHaveBeenCalled();
		const button = { ...idle, uv: [0.05, 0.05] as [number, number] };
		runtime.pointerOptions.onDown(button, down);
		runtime.pointerOptions.onUp(button, up);
		expect(media.play).toHaveBeenCalledTimes(1);
		tick(80);
		expect(frame.setUniform).toHaveBeenCalledWith('uRaster', [1, 1, 1, 0]);
		dispose();
		expect(media.dispose).toHaveBeenCalledTimes(1);
	});
});
