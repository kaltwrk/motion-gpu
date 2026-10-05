import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCurrentWritable, type FrameState, type LoadedTexture } from 'spektral';

vi.mock('$lib/site/demos/nixie/geometry', () => ({
	hitNixieControl: (uv: [number, number]) =>
		uv[0] < 0.1 ? null : uv[0] > 0.8 ? 'brightness' : 'clock'
}));
import { createNixieRuntime } from '$lib/site/demos/nixie/interaction';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function setup() {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 9, 5, 12, 34, 56, 950));
	const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
	vi.stubGlobal('document', document);
	const canvas = {
		getBoundingClientRect: () => ({ width: 800, height: 600 })
	} as HTMLCanvasElement;
	const invalidate = vi.fn();
	const runtime = createNixieRuntime(() => canvas, invalidate);
	const frame = {
		time: 0,
		delta: 1 / 60,
		canvas,
		renderMode: 'on-demand',
		autoRender: true,
		setTexture: vi.fn(),
		setUniform: vi.fn(),
		writeStorageBuffer: vi.fn(),
		readStorageBuffer: vi.fn(async () => new ArrayBuffer(0)),
		invalidate: vi.fn(),
		advance: vi.fn()
	} satisfies FrameState;
	const pointer = {
		uv: [0.5, 0.5] as [number, number],
		ndc: [0, 0] as [number, number],
		px: [400, 300] as [number, number],
		inside: false,
		pressed: false
	};
	const textureState = () => ({
		textures: createCurrentWritable<LoadedTexture[] | null>(null),
		error: createCurrentWritable<Error | null>(null),
		loading: createCurrentWritable(false)
	});
	const cathodes = textureState();
	const woodColor = textureState();
	const woodSurface = textureState();
	const tick = (count = 1) => {
		for (let i = 0; i < count; i++)
			runtime.update(frame, pointer, cathodes, woodColor, woodSurface);
	};
	const click = (uv: [number, number], cancelled = false) => {
		const point = { ...pointer, uv };
		runtime.pointerOptions.onDown(point, { button: 0 } as PointerEvent);
		runtime.pointerOptions.onUp(point, {
			type: cancelled ? 'pointercancel' : 'pointerup'
		} as PointerEvent);
	};
	return {
		runtime,
		frame,
		pointer,
		cathodes,
		woodColor,
		woodSurface,
		tick,
		click,
		invalidate,
		document
	};
}

describe('Nixie on-demand lifecycle', () => {
	it('waits for the atlas and stamp together, independently of the complete wood-map set', () => {
		const { frame, cathodes, woodColor, woodSurface, tick } = setup();
		const texture = (url: string, colorSpace: 'srgb' | 'linear'): LoadedTexture => ({
			url,
			colorSpace,
			source: { width: 1024, height: 1024, close: vi.fn() },
			width: 1024,
			height: 1024,
			update: 'once',
			flipY: false,
			premultipliedAlpha: false,
			generateMipmaps: true,
			dispose: vi.fn()
		});
		const atlas = texture('cathodes.png', 'linear');
		const stamp = texture('stamp.png', 'linear');
		const albedo = texture('wood-albedo.jpg', 'srgb');
		const normal = texture('wood-normal.jpg', 'linear');
		const roughness = texture('wood-roughness.jpg', 'linear');
		woodSurface.loading.set(true);
		cathodes.textures.set([atlas]);
		woodColor.textures.set([albedo]);
		tick();
		expect(frame.setTexture).not.toHaveBeenCalled();
		expect(frame.setUniform).not.toHaveBeenCalledWith('uReady', 1);
		cathodes.textures.set([atlas, stamp]);
		tick();
		expect(frame.setTexture).toHaveBeenCalledTimes(2);
		expect(frame.setTexture).toHaveBeenCalledWith(
			'uStamp',
			expect.objectContaining({
				source: stamp.source,
				colorSpace: 'linear',
				flipY: false,
				generateMipmaps: true
			})
		);
		expect(frame.setUniform).toHaveBeenCalledWith('uReady', 1);
		expect(frame.setUniform).not.toHaveBeenCalledWith('uWoodReady', 1);
		woodSurface.textures.set([normal, roughness]);
		tick();
		expect(frame.setTexture).toHaveBeenCalledTimes(2);
		woodSurface.loading.set(false);
		tick();
		expect(frame.setTexture.mock.calls.slice(2).map(([name]) => name)).toEqual([
			'uWoodAlbedo',
			'uWoodNormal',
			'uWoodRoughness'
		]);
		expect(frame.setTexture).toHaveBeenCalledWith(
			'uWoodAlbedo',
			expect.objectContaining({
				source: albedo.source,
				colorSpace: 'srgb',
				flipY: false,
				generateMipmaps: true
			})
		);
		expect(frame.setUniform).toHaveBeenCalledWith('uWoodReady', 1);
		tick();
		expect(frame.setTexture).toHaveBeenCalledTimes(5);
	});

	it('wakes at second boundaries, sleeps after the fade and resynchronizes after hidden time', () => {
		const { runtime, frame, tick, invalidate, document } = setup();
		const dispose = runtime.mount();
		tick();
		frame.setUniform.mockClear();
		frame.invalidate.mockClear();
		invalidate.mockClear();
		vi.advanceTimersByTime(53);
		expect(invalidate).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(invalidate).toHaveBeenCalledTimes(1);
		tick(10);
		expect(frame.setUniform).toHaveBeenCalledWith('uDigitsB', [5, 7, 0, 0]);
		expect(frame.setUniform).toHaveBeenCalledWith('uDigitMixB', [1, 1, 1, 1]);
		frame.setUniform.mockClear();
		frame.invalidate.mockClear();
		tick(20);
		expect(frame.setUniform).not.toHaveBeenCalled();
		expect(frame.invalidate).not.toHaveBeenCalled();

		document.visibilityState = 'hidden';
		document.dispatchEvent(new Event('visibilitychange'));
		expect(vi.getTimerCount()).toBe(0);
		invalidate.mockClear();
		vi.advanceTimersByTime(90_000);
		expect(invalidate).not.toHaveBeenCalled();
		document.visibilityState = 'visible';
		document.dispatchEvent(new Event('visibilitychange'));
		tick();
		expect(frame.setUniform).toHaveBeenCalledWith('uDigitsA', [1, 2, 3, 6]);
		expect(frame.setUniform).toHaveBeenCalledWith('uDigitsB', [2, 7, 0, 0]);
		dispose();
		expect(vi.getTimerCount()).toBe(0);
		invalidate.mockClear();
		document.dispatchEvent(new Event('visibilitychange'));
		vi.advanceTimersByTime(2000);
		expect(invalidate).not.toHaveBeenCalled();
	});

	it('maps date and brightness to separate physical hits and rejects cancelled or dragged clicks', () => {
		const { runtime, frame, pointer, tick, click } = setup();
		const dispose = runtime.mount();
		tick();
		frame.setUniform.mockClear();
		click([0.5, 0.5]);
		tick(10);
		expect(frame.setUniform).toHaveBeenCalledWith('uDigitsA', [0, 5, 1, 0]);
		expect(frame.setUniform).toHaveBeenCalledWith('uDigitsB', [2, 6, 0, 0]);
		frame.setUniform.mockClear();
		click([0.95, 0.5]);
		tick(60);
		expect(frame.setUniform).toHaveBeenCalledWith('uBrightness', 0.6);
		frame.setUniform.mockClear();
		click([0.95, 0.5], true);
		click([0.05, 0.5]);
		runtime.pointerOptions.onDown(pointer, { button: 0 } as PointerEvent);
		const dragged = { ...pointer, px: [430, 300] as [number, number] };
		runtime.pointerOptions.onMove(dragged);
		runtime.pointerOptions.onUp(dragged, { type: 'pointerup' } as PointerEvent);
		tick(10);
		expect(frame.setUniform).not.toHaveBeenCalled();
		dispose();
	});
});
