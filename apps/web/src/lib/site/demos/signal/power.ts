export type SignalRaster = [number, number, number, number];
export type SignalPowerPhase = 'waiting' | 'starting' | 'on' | 'stopping' | 'off';
type PowerFrame = { time: number; raster: SignalRaster; boot: number };

/** CRT deflection and phosphor envelope; the shader supplies the actual light profile. */
export function createSignalPower() {
	let requested = true;
	let ready = false;
	let phase: SignalPowerPhase = 'waiting';
	let raster: SignalRaster = [1, 1, 0, 0];
	let boot = 0;
	let power = 0;
	let elapsed = 0;
	let frames: PowerFrame[] | null = null;

	const transition = (turnOn: boolean) => {
		const start: PowerFrame = { time: 0, raster: [...raster], boot };
		elapsed = 0;
		power = turnOn ? 1 : 0;
		phase = turnOn ? 'starting' : 'stopping';
		if (turnOn) {
			frames = [
				start,
				{ time: 0.1, raster: [0.018, 0.008, 0, 0], boot: 1 },
				{ time: 0.18, raster: [0.024, 0.01, 0, 0.42], boot: 1 },
				{ time: 0.34, raster: [1, 0.01, 0, 0.92], boot: 0.95 },
				{ time: 0.67, raster: [1, 1, 0.72, 0.04], boot: 0.62 },
				{ time: 0.96, raster: [1, 1, 0.96, 0], boot: 0.18 },
				{ time: 1.24, raster: [1, 1, 1, 0], boot: 0 }
			];
		} else {
			const width = raster[0];
			const height = Math.min(raster[1], 0.008);
			const dotWidth = Math.min(width, 0.014);
			// A reversal during the dark heater delay must not create a bright shutdown flash.
			const energy = Math.max(raster[2], raster[3]);
			frames = [
				start,
				{ time: 0.19, raster: [width, height, 0, energy * 1.12], boot: 0 },
				{ time: 0.36, raster: [dotWidth, height, 0, energy * 0.8], boot: 0 },
				{ time: 0.52, raster: [dotWidth * 0.72, height, 0, energy * 0.32], boot: 0 },
				{ time: 0.82, raster: [0, 0, 0, 0], boot: 0 }
			];
		}
	};

	return {
		get requested() {
			return requested;
		},
		get fullyOn() {
			return phase === 'on';
		},
		get animating() {
			return frames !== null;
		},
		get state() {
			return { raster: [...raster] as SignalRaster, boot, power, phase };
		},
		setReady(value: boolean) {
			// Only the first decoded frame gates the tube; a later media stall is not a power cycle.
			ready ||= value;
			if (ready && requested && phase === 'waiting') transition(true);
		},
		setPowered(value: boolean) {
			if (requested === value) return;
			requested = value;
			if (value && !ready) {
				phase = 'waiting';
				power = 0;
				frames = null;
				return;
			}
			if (!value && phase === 'waiting') {
				phase = 'off';
				return;
			}
			transition(value);
		},
		advance(delta: number) {
			if (!frames) return;
			elapsed += Math.max(0, Number.isFinite(delta) ? delta : 0);
			const end = frames.at(-1)!;
			if (elapsed >= end.time) {
				raster = [...end.raster];
				boot = end.boot;
				phase = requested ? 'on' : 'off';
				frames = null;
				return;
			}
			const nextIndex = frames.findIndex((frame) => frame.time > elapsed);
			const previous = frames[nextIndex - 1]!;
			const next = frames[nextIndex]!;
			const progress = (elapsed - previous.time) / (next.time - previous.time);
			const weight = progress * progress * (3 - 2 * progress);
			raster = previous.raster.map(
				(value, axis) => value + (next.raster[axis]! - value) * weight
			) as SignalRaster;
			boot = previous.boot + (next.boot - previous.boot) * weight;
		}
	};
}
