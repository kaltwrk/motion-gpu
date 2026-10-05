import { describe, expect, it, vi } from 'vitest';
import { createCurrentWritable, type FrameState, type LoadedTexture } from 'spektral';
import { createInspectionInteraction } from '$lib/site/demos/amber/interaction';

const texture = (colorSpace: 'srgb' | 'linear'): LoadedTexture => ({
	url: 'https://example.com/map.png',
	source: { width: 1024, height: 1024 } as ImageBitmap,
	width: 1024,
	height: 1024,
	colorSpace,
	update: 'once',
	generateMipmaps: true,
	flipY: false,
	premultipliedAlpha: false,
	dispose: vi.fn()
});

const textureState = () => ({
	textures: createCurrentWritable<LoadedTexture[] | null>(null),
	loading: createCurrentWritable(true),
	error: createCurrentWritable<Error | null>(null)
});

const frameState = () => ({
	time: 0,
	delta: 1 / 60,
	setUniform: vi.fn(),
	setTexture: vi.fn(),
	writeStorageBuffer: vi.fn(),
	readStorageBuffer: vi.fn(),
	invalidate: vi.fn(),
	advance: vi.fn(),
	renderMode: 'on-demand' as const,
	autoRender: true,
	canvas: {} as HTMLCanvasElement
});

const idlePointer = {
	ndc: [0, 0] as [number, number],
	downUv: null,
	inside: false,
	pressed: false
};

describe('Amber texture lifecycle', () => {
	it('publishes a complete map set once, with color and upload metadata intact', () => {
		const update = createInspectionInteraction();
		const frame = frameState();
		const albedo = textureState();
		const surface = textureState();
		const color = texture('srgb');
		albedo.textures.set([color]);
		albedo.loading.set(false);
		update(frame as FrameState, idlePointer, albedo, surface);
		expect(frame.setTexture).not.toHaveBeenCalled();
		expect(frame.setUniform).not.toHaveBeenCalled();

		surface.textures.set(Array.from({ length: 4 }, () => texture('linear')));
		surface.loading.set(false);
		update(frame as FrameState, idlePointer, albedo, surface);
		expect(frame.setTexture).toHaveBeenCalledTimes(5);
		expect(frame.setTexture).toHaveBeenNthCalledWith(1, 'uAlbedo', {
			source: color.source,
			width: 1024,
			height: 1024,
			colorSpace: 'srgb',
			update: 'once',
			generateMipmaps: true,
			flipY: false,
			premultipliedAlpha: false
		});
		expect(frame.setTexture).toHaveBeenNthCalledWith(
			2,
			'uNormal',
			expect.objectContaining({ colorSpace: 'linear' })
		);
		expect(frame.setUniform).toHaveBeenCalledWith('uReady', 1);
		expect(frame.setUniform.mock.invocationCallOrder[0]).toBeGreaterThan(
			frame.setTexture.mock.invocationCallOrder[4]!
		);
		expect(frame.invalidate).toHaveBeenCalledTimes(1);

		update(frame as FrameState, idlePointer, albedo, surface);
		expect(frame.setTexture).toHaveBeenCalledTimes(5);
		expect(frame.invalidate).toHaveBeenCalledTimes(1);
		expect(color.dispose).not.toHaveBeenCalled();
	});

	it('stops invalidating after the inspection light settles', () => {
		const update = createInspectionInteraction();
		const frame = frameState();
		const albedo = textureState();
		const surface = textureState();
		const pointer = { ...idlePointer, ndc: [0.7, -0.3] as [number, number], inside: true };
		update(frame as FrameState, pointer, albedo, surface);
		expect(frame.invalidate).toHaveBeenCalledWith('amber-interaction');
		for (let i = 0; i < 120; i++) update(frame as FrameState, pointer, albedo, surface);
		const count = frame.invalidate.mock.calls.length;
		update(frame as FrameState, pointer, albedo, surface);
		expect(frame.invalidate).toHaveBeenCalledTimes(count);
		expect(frame.setUniform).toHaveBeenLastCalledWith('uInspect', [0.7, -0.3]);
	});

	it('captures rotation outside the canvas, preserves it on release and resets optical reveal', () => {
		const update = createInspectionInteraction();
		const frame = frameState();
		const albedo = textureState();
		const surface = textureState();
		const pointer = {
			ndc: [0, 0] as [number, number],
			downUv: [0.5, 0.5] as [number, number],
			inside: true,
			pressed: true
		};
		update(frame as FrameState, pointer, albedo, surface);
		pointer.ndc = [1.5, 0];
		pointer.inside = false;
		for (let i = 0; i < 120; i++) update(frame as FrameState, pointer, albedo, surface);
		expect(frame.setUniform).toHaveBeenCalledWith('uRotation', 1.5 * 2.8);
		expect(frame.setUniform).toHaveBeenCalledWith('uReveal', 1);

		pointer.pressed = false;
		for (let i = 0; i < 120; i++) update(frame as FrameState, pointer, albedo, surface);
		expect(frame.setUniform).toHaveBeenCalledWith('uReveal', 0);
		const rotations = frame.setUniform.mock.calls.filter(([name]) => name === 'uRotation');
		expect(rotations.at(-1)?.[1]).toBe(1.5 * 2.8);
		const count = frame.invalidate.mock.calls.length;
		update(frame as FrameState, pointer, albedo, surface);
		expect(frame.invalidate).toHaveBeenCalledTimes(count);
	});

	it('adds a subsequent drag to the saved angle and retains movement on the release event', () => {
		const update = createInspectionInteraction();
		const frame = frameState();
		const albedo = textureState();
		const surface = textureState();
		const pointer = {
			ndc: [0.5, 0] as [number, number],
			downUv: [0.5, 0.5] as [number, number],
			inside: true,
			pressed: true
		};
		update(frame as FrameState, pointer, albedo, surface);
		pointer.ndc = [0.75, 0];
		pointer.pressed = false;
		for (let i = 0; i < 120; i++) update(frame as FrameState, pointer, albedo, surface);
		pointer.ndc = [0.25, 0];
		pointer.downUv = [0.5, 0.5];
		pointer.pressed = true;
		for (let i = 0; i < 120; i++) update(frame as FrameState, pointer, albedo, surface);
		const rotations = frame.setUniform.mock.calls.filter(([name]) => name === 'uRotation');
		expect(rotations.at(-1)?.[1]).toBeCloseTo(2.8, 10);
	});
});
