import { studioCamera } from '../../demo-shared/camera';

const normalize = (v: number[]) => {
	const length = Math.hypot(...v);
	return v.map((value) => value / length);
};
const cross = (a: number[], b: number[]) => [
	a[1]! * b[2]! - a[2]! * b[1]!,
	a[2]! * b[0]! - a[0]! * b[2]!,
	a[0]! * b[1]! - a[1]! * b[0]!
];
const forward = normalize(studioCamera.target.map((v, i) => v - studioCamera.position[i]!));
const right = normalize(cross(forward, [0, 1, 0]));
const up = cross(right, forward);

function signalLocalRay(
	uv: readonly [number, number],
	width: number,
	height: number,
	inspect: readonly [number, number]
) {
	const shorter = Math.max(1, Math.min(width, height));
	const sx = ((uv[0] * 2 - 1) * width) / shorter;
	const sy = ((uv[1] * 2 - 1) * height) / shorter;
	const direction = normalize(
		forward.map((v, i) => v * studioCamera.focalLength + right[i]! * sx + up[i]! * sy)
	);
	const angle = -(0.28 + inspect[0] * 0.1);
	const c = Math.cos(angle),
		s = Math.sin(angle);
	const rotate = (v: number[]) => [c * v[0]! + s * v[2]!, v[1]!, -s * v[0]! + c * v[2]!];
	const origin = rotate(studioCamera.position);
	const ray = rotate(direction);
	return { origin, ray };
}

/** Intersect the same curved glass used by the WGSL shader. Coordinates are Y-up. */
export function projectSignalScreen(
	uv: readonly [number, number],
	width: number,
	height: number,
	inspect: readonly [number, number],
	clip = true
): [number, number] | null {
	const { origin, ray } = signalLocalRay(uv, width, height, inspect);
	if (ray[2]! >= -0.001) return null;
	let travel = (0.475 - origin[2]!) / ray[2]!;
	for (let i = 0; i < 5; i++) {
		const x = origin[0]! + ray[0]! * travel;
		const y = origin[1]! + ray[1]! * travel - 1.055;
		const surface = 0.475 - 0.035 * ((x / 0.77) ** 2 + (y / 0.555) ** 2);
		travel = (surface - origin[2]!) / ray[2]!;
	}
	const x = origin[0]! + ray[0]! * travel;
	const y = origin[1]! + ray[1]! * travel - 1.055;
	const qx = Math.abs(x) - (0.77 - 0.075);
	const qy = Math.abs(y) - (0.555 - 0.075);
	const roundedDistance =
		Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.075;
	if (travel <= 0 || (clip && roundedDistance > 0)) return null;
	return [x / 1.54 + 0.5, y / 1.11 + 0.5];
}

/** Hit the physical power switch on the lower left of the faceplate. */
export function hitSignalPowerButton(
	uv: readonly [number, number],
	width: number,
	height: number,
	inspect: readonly [number, number]
): boolean {
	const { origin, ray } = signalLocalRay(uv, width, height, inspect);
	if (ray[2]! >= -0.001) return false;
	const travel = (0.642 - origin[2]!) / ray[2]!;
	const x = origin[0]! + ray[0]! * travel + 0.815;
	const y = origin[1]! + ray[1]! * travel - 0.303;
	const qx = Math.abs(x) - (0.039 - 0.008);
	const qy = Math.abs(y) - (0.026 - 0.008);
	return (
		travel > 0 &&
		Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= 0.008
	);
}
