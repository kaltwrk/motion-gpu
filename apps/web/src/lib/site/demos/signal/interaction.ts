import type { CurrentReadable, FrameState, LoadedTexture } from 'spektral';
import { signalVideoUrl } from './assets';
import { hitSignalPowerButton, projectSignalScreen } from './geometry';
import { createSignalVideo } from './media';
import { createSignalPower } from './power';

type SignalPointer = {
	uv: [number, number];
	ndc: [number, number];
	px: [number, number];
	inside: boolean;
	pressed: boolean;
};
type LabelState = {
	textures: CurrentReadable<LoadedTexture[] | null>;
	error: CurrentReadable<Error | null>;
};

export function createSignalRuntime(
	getCanvas: () => HTMLCanvasElement | undefined,
	invalidate: () => void
) {
	let video: ReturnType<typeof createSignalVideo> | null = null;
	const power = createSignalPower();
	let publishedPower = power.state;
	let inspect: [number, number] = [0, 0];
	let labels: LoadedTexture[] | null = null;
	let labelError: Error | null = null;
	let gesture: {
		control: 'screen' | 'power';
		pixelX: number;
		pixelY: number;
		screenU: number;
		time: number;
		resume: boolean;
		dragged: boolean;
		moved: boolean;
	} | null = null;

	const screenPoint = (pointer: SignalPointer, clip = true) => {
		const canvas = getCanvas();
		if (!canvas) return null;
		const bounds = canvas.getBoundingClientRect();
		return projectSignalScreen(pointer.uv, bounds.width, bounds.height, inspect, clip);
	};
	const powerButton = (pointer: SignalPointer) => {
		const canvas = getCanvas();
		if (!canvas) return false;
		const bounds = canvas.getBoundingClientRect();
		return hitSignalPowerButton(pointer.uv, bounds.width, bounds.height, inspect);
	};
	const togglePower = () => {
		if (!video) return;
		const turnOn = !power.requested;
		power.setPowered(turnOn);
		// play() stays inside the user gesture so a browser can grant autoplay permission.
		if (turnOn) video.play();
		else video.pause();
		invalidate();
	};
	const seekGesture = (pointer: SignalPointer) => {
		if (!gesture || !video) return;
		const point = screenPoint(pointer, false);
		if (point) video.seek(gesture.time + (point[0] - gesture.screenU) * video.duration);
	};

	return {
		mount() {
			const mounted = createSignalVideo(signalVideoUrl(), invalidate);
			video = mounted;
			return () => {
				mounted.dispose();
				if (video === mounted) video = null;
				gesture = null;
			};
		},
		pointerOptions: {
			capturePointer: true,
			trackWhilePressedOutsideCanvas: true,
			clickEnabled: false,
			onDown(pointer: SignalPointer, event: PointerEvent) {
				if (event.button !== 0 || !video) return;
				const point = screenPoint(pointer);
				const button = powerButton(pointer);
				if (!point && !button) return;
				gesture = {
					control: button ? 'power' : 'screen',
					pixelX: pointer.px[0],
					pixelY: pointer.px[1],
					screenU: point?.[0] ?? 0,
					time: video.currentTime,
					resume: !video.paused,
					dragged: false,
					moved: false
				};
			},
			onMove(pointer: SignalPointer) {
				if (!gesture || !video) return;
				gesture.moved ||=
					Math.hypot(pointer.px[0] - gesture.pixelX, pointer.px[1] - gesture.pixelY) > 6;
				if (gesture.control !== 'screen' || !power.fullyOn) return;
				if (!gesture.dragged && Math.abs(pointer.px[0] - gesture.pixelX) > 6) {
					gesture.dragged = true;
					video.pause();
				}
				if (gesture.dragged) seekGesture(pointer);
			},
			onUp(pointer: SignalPointer, event: PointerEvent) {
				if (!gesture || !video) return;
				gesture.moved ||=
					Math.hypot(pointer.px[0] - gesture.pixelX, pointer.px[1] - gesture.pixelY) > 6;
				if (gesture.dragged) {
					seekGesture(pointer);
					if (gesture.resume) video.play();
				} else if (
					!gesture.moved &&
					event.type !== 'pointercancel' &&
					(gesture.control === 'power' ? powerButton(pointer) : screenPoint(pointer))
				) {
					togglePower();
				}
				gesture = null;
			}
		},
		update(frame: FrameState, pointer: SignalPointer, labelState: LabelState) {
			video?.sync(frame);
			power.setReady(video?.ready ?? false);
			power.advance(frame.delta);
			const currentPower = power.state;
			let powerChanged = false;
			if (currentPower.raster.some((value, axis) => value !== publishedPower.raster[axis])) {
				frame.setUniform('uRaster', currentPower.raster);
				powerChanged = true;
			}
			if (currentPower.boot !== publishedPower.boot) {
				frame.setUniform('uBoot', currentPower.boot);
				powerChanged = true;
			}
			if (currentPower.power !== publishedPower.power) {
				frame.setUniform('uPower', currentPower.power);
				powerChanged = true;
			}
			publishedPower = currentPower;
			if (powerChanged) frame.invalidate('signal-power');
			const loaded = labelState.textures.current;
			if (loaded?.[0] && loaded !== labels) {
				const texture = loaded[0];
				frame.setTexture('uLabels', {
					source: texture.source,
					width: texture.width,
					height: texture.height,
					colorSpace: texture.colorSpace,
					generateMipmaps: texture.generateMipmaps,
					update: texture.update,
					flipY: texture.flipY,
					premultipliedAlpha: texture.premultipliedAlpha
				});
				labels = loaded;
				frame.invalidate('signal-labels');
			}
			if (labelState.error.current && labelState.error.current !== labelError)
				console.error('Signal labels', labelState.error.current);
			labelError = labelState.error.current;

			// Keep the screen stationary under the pointer throughout a click or scrub gesture.
			if (gesture) return;
			const desired: [number, number] = pointer.inside
				? [Math.max(-1, Math.min(1, pointer.ndc[0])), Math.max(-1, Math.min(1, pointer.ndc[1]))]
				: [0, 0];
			const follow = 1 - Math.exp(-Math.min(Math.max(frame.delta, 0), 1 / 30) * 8);
			const next = inspect.map((value, axis) => {
				const smoothed = value + (desired[axis]! - value) * follow;
				return Math.abs(smoothed - desired[axis]!) < 0.0003 ? desired[axis]! : smoothed;
			}) as [number, number];
			if (next[0] !== inspect[0] || next[1] !== inspect[1]) {
				inspect = next;
				frame.setUniform('uInspect', inspect);
				frame.invalidate('signal-inspection');
			}
		}
	};
}
