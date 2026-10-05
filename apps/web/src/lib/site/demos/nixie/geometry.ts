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

/** Use the same studio ray and object rotation as the fragment shader. */
export function hitNixieControl(
	uv: readonly [number, number],
	width: number,
	height: number,
	inspect: readonly [number, number]
): 'brightness' | 'clock' | null {
	const shorter = Math.max(1, Math.min(width, height));
	const sx = ((uv[0] * 2 - 1) * width) / shorter;
	const sy = ((uv[1] * 2 - 1) * height) / shorter;
	const direction = normalize(
		forward.map((v, i) => v * studioCamera.focalLength + right[i]! * sx + up[i]! * sy)
	);
	const angle = -(0.38 + inspect[0]! * 0.12);
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const rotate = (v: number[]) => [c * v[0]! + s * v[2]!, v[1]!, -s * v[0]! + c * v[2]!];
	const ro = rotate(studioCamera.position);
	const rd = rotate(direction);
	const travel = (0.376 - ro[2]!) / rd[2]!;
	const x = ro[0]! + rd[0]! * travel;
	const y = ro[1]! + rd[1]! * travel;
	if (travel > 0 && Math.hypot(x - 1.24, y - 0.12) < 0.033) return 'brightness';
	const boxHit = (low: number[], high: number[]) => {
		const a = low.map((v, i) => (v - ro[i]!) / rd[i]!);
		const b = high.map((v, i) => (v - ro[i]!) / rd[i]!);
		const near = Math.max(...a.map((v, i) => Math.min(v, b[i]!)));
		const far = Math.min(...a.map((v, i) => Math.max(v, b[i]!)));
		return far >= Math.max(near, 0);
	};
	if (boxHit([-1.42, 0.035, -0.36], [1.42, 0.205, 0.36])) return 'clock';
	for (const center of [-1.075, -0.685, -0.195, 0.195, 0.685, 1.075]) {
		if (boxHit([center - 0.157, 0.21, -0.157], [center + 0.157, 1.21, 0.157])) return 'clock';
	}
	return null;
}
