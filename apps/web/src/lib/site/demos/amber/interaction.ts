import type { CurrentReadable, FrameState, LoadedTexture } from 'spektral';

type InspectionPointer = {
	ndc: [number, number];
	downUv: [number, number] | null;
	inside: boolean;
	pressed: boolean;
};
type TextureState = {
	textures: CurrentReadable<LoadedTexture[] | null>;
	loading: CurrentReadable<boolean>;
	error: CurrentReadable<Error | null>;
};

const dataSlots = ['uNormal', 'uRoughness', 'uHeight', 'uAO'];

function publishTexture(frame: FrameState, name: string, texture: LoadedTexture) {
	frame.setTexture(name, {
		source: texture.source,
		width: texture.width,
		height: texture.height,
		colorSpace: texture.colorSpace,
		update: texture.update,
		flipY: texture.flipY,
		premultipliedAlpha: texture.premultipliedAlpha,
		generateMipmaps: texture.generateMipmaps
	});
}

/** The load hooks own bitmap cleanup; this callback only publishes them to the GPU. */
export function createInspectionInteraction() {
	let x = 0;
	let y = 0;
	let rotation = 0;
	let desiredRotation = 0;
	let reveal = 0;
	let dragging = false;
	let dragOrigin = 0;
	let dragRotation = 0;
	let publishedAlbedo: LoadedTexture[] | null = null;
	let publishedSurface: LoadedTexture[] | null = null;
	let lastAlbedoError: Error | null = null;
	let lastSurfaceError: Error | null = null;

	return (
		frame: FrameState,
		pointer: InspectionPointer,
		albedo: TextureState,
		surface: TextureState
	) => {
		const albedoError = albedo.error.current;
		const surfaceError = surface.error.current;
		if (albedoError && albedoError !== lastAlbedoError) console.error('Amber albedo', albedoError);
		if (surfaceError && surfaceError !== lastSurfaceError)
			console.error('Amber surface maps', surfaceError);
		lastAlbedoError = albedoError;
		lastSurfaceError = surfaceError;

		const colorMaps = albedo.textures.current;
		const dataMaps = surface.textures.current;
		if (
			!albedo.loading.current &&
			!surface.loading.current &&
			colorMaps?.length === 1 &&
			dataMaps?.length === dataSlots.length &&
			(colorMaps !== publishedAlbedo || dataMaps !== publishedSurface)
		) {
			// All maps and readiness change before a single GPU render, so no partial material appears.
			publishTexture(frame, 'uAlbedo', colorMaps[0]!);
			dataSlots.forEach((slot, index) => publishTexture(frame, slot, dataMaps[index]!));
			frame.setUniform('uReady', 1);
			publishedAlbedo = colorMaps;
			publishedSurface = dataMaps;
			frame.invalidate('amber-textures-ready');
		}

		const engaged = pointer.inside || pointer.pressed;
		const desiredX = engaged ? Math.max(-1, Math.min(1, pointer.ndc[0])) : 0;
		const desiredY = engaged ? Math.max(-1, Math.min(1, pointer.ndc[1])) : 0;
		if (pointer.pressed && !dragging) {
			dragOrigin = pointer.downUv ? pointer.downUv[0] * 2 - 1 : pointer.ndc[0];
			dragRotation = desiredRotation;
		}
		if (pointer.pressed || dragging) {
			// Keep unclamped coordinates during capture so rotation continues beyond the canvas.
			desiredRotation = dragRotation + (pointer.ndc[0] - dragOrigin) * 2.8;
		}
		dragging = pointer.pressed;

		const delta = Math.min(Math.max(frame.delta, 0), 1 / 30);
		const damp = (current: number, desired: number, speed: number) => {
			const value = current + (desired - current) * (1 - Math.exp(-delta * speed));
			return Math.abs(desired - value) < 0.0003 ? desired : value;
		};
		const nextX = damp(x, desiredX, 9);
		const nextY = damp(y, desiredY, 9);
		const nextRotation = damp(rotation, desiredRotation, 12);
		const nextReveal = damp(reveal, pointer.pressed ? 1 : 0, 10);
		let changed = false;
		if (nextX !== x || nextY !== y) {
			x = nextX;
			y = nextY;
			frame.setUniform('uInspect', [x, y]);
			changed = true;
		}
		if (nextRotation !== rotation) {
			rotation = nextRotation;
			frame.setUniform('uRotation', rotation);
			changed = true;
		}
		if (nextReveal !== reveal) {
			reveal = nextReveal;
			frame.setUniform('uReveal', reveal);
			changed = true;
		}
		if (changed) frame.invalidate('amber-interaction');
	};
}
