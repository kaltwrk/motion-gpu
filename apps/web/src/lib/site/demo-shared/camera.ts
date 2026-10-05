import type { MaterialDefines } from 'spektral';

type Vec3 = [number, number, number];

// One camera calibration drives the studio ray and pointer projection in every demo.
export const studioCamera = {
	position: [3.3, 2.7, 4.2] as Vec3,
	target: [0, 0.2, 0] as Vec3,
	focalLength: 3.7
};

export const studioCameraDefines = {
	STUDIO_CAMERA_POSITION: { type: 'vec3f', value: studioCamera.position },
	STUDIO_CAMERA_TARGET: { type: 'vec3f', value: studioCamera.target },
	STUDIO_FOCAL_LENGTH: studioCamera.focalLength,
	STUDIO_FLOOR_Y: 0
} satisfies MaterialDefines;

const normalize = (v: Vec3): Vec3 => {
	const length = Math.hypot(...v);
	return [v[0] / length, v[1] / length, v[2] / length];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0]
];
const forward = normalize([
	studioCamera.target[0] - studioCamera.position[0],
	studioCamera.target[1] - studioCamera.position[1],
	studioCamera.target[2] - studioCamera.position[2]
]);
const right = normalize(cross(forward, [0, 1, 0]));
const up = cross(right, forward);

/** Map Spektral's Y-up pointer UV to the same horizontal plane seen by the shader. */
export function projectToStudioPlane(
	uv: readonly [number, number],
	width: number,
	height: number,
	planeHeight: number
): [number, number] {
	const shorterSide = Math.max(1, Math.min(width, height));
	const x = ((uv[0] * 2 - 1) * width) / shorterSide;
	const y = ((uv[1] * 2 - 1) * height) / shorterSide;
	const ray = normalize([
		forward[0] * studioCamera.focalLength + right[0] * x + up[0] * y,
		forward[1] * studioCamera.focalLength + right[1] * x + up[1] * y,
		forward[2] * studioCamera.focalLength + right[2] * x + up[2] * y
	]);
	const distance = (planeHeight - studioCamera.position[1]) / Math.min(ray[1], -0.001);
	return [
		studioCamera.position[0] + ray[0] * distance,
		studioCamera.position[2] + ray[2] * distance
	];
}
