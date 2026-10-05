import type { CurrentReadable, FrameState, LoadedTexture } from 'spektral';
import { createNixieClock } from './clock';
import { hitNixieControl } from './geometry';

type NixiePointer = {
	uv: [number, number];
	ndc: [number, number];
	px: [number, number];
	inside: boolean;
	pressed: boolean;
};

type Control = 'clock' | 'brightness';
type CathodeState = {
	textures: CurrentReadable<LoadedTexture[] | null>;
	error: CurrentReadable<Error | null>;
};
type WoodState = CathodeState & { loading: CurrentReadable<boolean> };

function publishTexture(frame: FrameState, name: string, texture: LoadedTexture) {
	frame.setTexture(name, {
		source: texture.source,
		width: texture.width,
		height: texture.height,
		colorSpace: texture.colorSpace,
		generateMipmaps: texture.generateMipmaps,
		update: texture.update,
		flipY: texture.flipY,
		premultipliedAlpha: texture.premultipliedAlpha
	});
}

export function createNixieRuntime(
	getCanvas: () => HTMLCanvasElement | undefined,
	invalidate: () => void
) {
	const clock = createNixieClock();
	let inspect: [number, number] = [0, 0];
	const levels = [1, 0.6, 0.3];
	let level = 0;
	let brightness = levels[0]!;
	let published: typeof clock.state | undefined;
	let cathodes: LoadedTexture[] | null = null;
	let cathodeError: Error | null = null;
	let woodColor: LoadedTexture[] | null = null;
	let woodSurface: LoadedTexture[] | null = null;
	let woodColorError: Error | null = null;
	let woodSurfaceError: Error | null = null;
	let gesture: { control: Control; px: [number, number]; moved: boolean } | null = null;

	const hit = (pointer: NixiePointer) => {
		const bounds = getCanvas()?.getBoundingClientRect();
		return bounds ? hitNixieControl(pointer.uv, bounds.width, bounds.height, inspect) : null;
	};

	return {
		mount() {
			let disposed = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const tick = () => {
				clearTimeout(timer);
				if (disposed || document.visibilityState === 'hidden') return;
				if (clock.sample(new Date())) invalidate();
				// Recalculate from wall time after every wake; delayed tabs never accumulate drift.
				timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 4);
			};
			document.addEventListener('visibilitychange', tick);
			tick();
			invalidate();
			return () => {
				disposed = true;
				clearTimeout(timer);
				document.removeEventListener('visibilitychange', tick);
				gesture = null;
			};
		},
		pointerOptions: {
			capturePointer: true,
			trackWhilePressedOutsideCanvas: true,
			clickEnabled: false,
			onDown(pointer: NixiePointer, event: PointerEvent) {
				if (event.button !== 0) return;
				const control = hit(pointer);
				if (control) gesture = { control, px: [...pointer.px], moved: false };
			},
			onMove(pointer: NixiePointer) {
				if (gesture)
					gesture.moved ||=
						Math.hypot(pointer.px[0] - gesture.px[0], pointer.px[1] - gesture.px[1]) > 6;
			},
			onUp(pointer: NixiePointer, event: PointerEvent) {
				if (!gesture) return;
				const moved =
					gesture.moved ||
					Math.hypot(pointer.px[0] - gesture.px[0], pointer.px[1] - gesture.px[1]) > 6;
				if (!moved && event.type !== 'pointercancel' && hit(pointer) === gesture.control) {
					if (gesture.control === 'brightness') level = (level + 1) % levels.length;
					else clock.toggleMode(new Date());
					invalidate();
				}
				gesture = null;
			}
		},
		update(
			frame: FrameState,
			pointer: NixiePointer,
			cathodeState: CathodeState,
			colorState: WoodState,
			surfaceState: WoodState
		) {
			const loaded = cathodeState.textures.current;
			if (loaded?.length === 2 && loaded !== cathodes) {
				publishTexture(frame, 'uCathodes', loaded[0]!);
				publishTexture(frame, 'uStamp', loaded[1]!);
				frame.setUniform('uReady', 1);
				cathodes = loaded;
				frame.invalidate('nixie-cathodes');
			}
			if (cathodeState.error.current && cathodeState.error.current !== cathodeError)
				console.error('Nixie cathodes', cathodeState.error.current);
			cathodeError = cathodeState.error.current;
			const colors = colorState.textures.current;
			const surfaces = surfaceState.textures.current;
			if (
				!colorState.loading.current &&
				!surfaceState.loading.current &&
				colors?.length === 1 &&
				surfaces?.length === 2 &&
				(colors !== woodColor || surfaces !== woodSurface)
			) {
				publishTexture(frame, 'uWoodAlbedo', colors[0]!);
				publishTexture(frame, 'uWoodNormal', surfaces[0]!);
				publishTexture(frame, 'uWoodRoughness', surfaces[1]!);
				frame.setUniform('uWoodReady', 1);
				woodColor = colors;
				woodSurface = surfaces;
				frame.invalidate('nixie-wood');
			}
			if (colorState.error.current && colorState.error.current !== woodColorError)
				console.error('Nixie wood color', colorState.error.current);
			if (surfaceState.error.current && surfaceState.error.current !== woodSurfaceError)
				console.error('Nixie wood surface', surfaceState.error.current);
			woodColorError = colorState.error.current;
			woodSurfaceError = surfaceState.error.current;
			clock.advance(frame.delta);
			const state = clock.state;
			let changed = false;
			const publish = (field: 'digits' | 'previous' | 'mix', uniform: string, filler: number) => {
				for (const [part, start, count] of [
					['A', 0, 4],
					['B', 4, 2]
				] as const) {
					const values = state[field].slice(start, start + count);
					if (
						!published ||
						values.some((value, index) => value !== published![field][start + index])
					) {
						frame.setUniform(uniform + part, [
							values[0]!,
							values[1]!,
							values[2] ?? filler,
							values[3] ?? filler
						]);
						changed = true;
					}
				}
			};
			publish('digits', 'uDigits', 0);
			publish('previous', 'uPrevious', 0);
			publish('mix', 'uDigitMix', 1);
			published = state;

			const delta = Math.min(Math.max(frame.delta, 0), 1 / 30);
			const follow = 1 - Math.exp(-delta * 10);
			const smooth = (value: number, desired: number) => {
				const next = value + (desired - value) * follow;
				return Math.abs(next - desired) < 0.0003 ? desired : next;
			};
			const nextBrightness = smooth(brightness, levels[level]!);
			if (brightness !== nextBrightness) {
				brightness = nextBrightness;
				frame.setUniform('uBrightness', brightness);
				changed = true;
			}
			if (!gesture) {
				const desired = pointer.inside
					? pointer.ndc.map((value) => Math.max(-1, Math.min(1, value)))
					: [0, 0];
				const next: [number, number] = [
					smooth(inspect[0], desired[0]!),
					smooth(inspect[1], desired[1]!)
				];
				if (next[0] !== inspect[0] || next[1] !== inspect[1]) {
					inspect = next;
					frame.setUniform('uInspect', inspect);
					changed = true;
				}
			}
			if (changed || clock.animating) frame.invalidate('nixie-clock');
		}
	};
}
