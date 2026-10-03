<script setup lang="ts">
import { useFrame, useSpektral, usePointer } from 'spektral/vue';

const MAX_IMPACTS = 8;
const REFERENCE_SHORT_EDGE = 860;
const MIN_FIT = 0.62;
const MAX_FIT = 1.36;

type ImpactState = [number, number, number, number];

const spektral = useSpektral();
const impacts: ImpactState[] = Array.from({ length: MAX_IMPACTS }, () => [0, 0, 1, -100]);

let frameTime = 0;
let impactCursor = 0;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const calcLens = (): number => {
	const canvas = spektral.canvas;
	if (canvas) {
		const shortEdge = Math.max(320, Math.min(canvas.clientWidth, canvas.clientHeight));
		const fit = clamp(shortEdge / REFERENCE_SHORT_EDGE, MIN_FIT, MAX_FIT);
		return 1.08 / fit;
	}

	const { width, height } = spektral.size.current;
	if (width <= 0 || height <= 0) {
		return 1;
	}

	const shortEdge = Math.max(320, Math.min(width, height));
	const fit = clamp(shortEdge / REFERENCE_SHORT_EDGE, MIN_FIT, MAX_FIT);
	return 1.08 / fit;
};

const rotateY = (v: [number, number, number], angle: number): [number, number, number] => {
	const s = Math.sin(angle);
	const c = Math.cos(angle);
	return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
};

const rotateX = (v: [number, number, number], angle: number): [number, number, number] => {
	const s = Math.sin(angle);
	const c = Math.cos(angle);
	return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
};

const worldToMoon = (v: [number, number, number], time: number): [number, number, number] => {
	const yaw = time * 0.145;
	const tilt = 0.18 + Math.sin(time * 0.11) * 0.05;
	return rotateX(rotateY(v, yaw), tilt);
};

const intersectMoon = (uv: [number, number]): [number, number, number] | null => {
	const { width, height } = spektral.size.current;
	if (width <= 0 || height <= 0) {
		return null;
	}

	const aspect = width / height;
	const rayScale = 3 * calcLens();
	const sx = rayScale * (uv[0] - 0.5) * aspect;
	const sy = rayScale * (uv[1] - 0.5);
	const radial2 = sx * sx + sy * sy;
	if (radial2 >= 1) {
		return null;
	}

	const sz = Math.sqrt(1 - radial2);
	return [sx, sy, sz];
};

usePointer({
	onClick: (pointerState) => {
		const worldNormal = intersectMoon(pointerState.uv);
		if (!worldNormal) {
			return;
		}

		const moonNormal = worldToMoon(worldNormal, frameTime);
		const norm = Math.hypot(moonNormal[0], moonNormal[1], moonNormal[2]);
		if (norm <= 1e-6) {
			return;
		}

		impacts[impactCursor] = [
			moonNormal[0] / norm,
			moonNormal[1] / norm,
			moonNormal[2] / norm,
			frameTime
		];
		impactCursor = (impactCursor + 1) % MAX_IMPACTS;
	}
});

useFrame((frame) => {
	frameTime = frame.time;
	frame.setUniform('uLens', calcLens());
	for (let i = 0; i < MAX_IMPACTS; i++) {
		frame.setUniform(`uImpact${i}`, impacts[i] as [number, number, number, number]);
	}
});
</script>
