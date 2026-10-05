import { projectToStudioPlane } from '../../demo-shared/camera';
import { GRID_COLUMNS, GRID_ROWS, GRID_PITCH, PIN_REST_HEIGHT } from './simulation';

export const KINETIC_SCALE = 0.84;

/** Limit interaction to the pin cells, excluding the surrounding case and studio floor. */
export function projectKineticPointer(
	uv: readonly [number, number],
	width: number,
	height: number
): [number, number] | null {
	if (width <= 0 || height <= 0 || !Number.isFinite(width + height + uv[0] + uv[1])) return null;
	const world = projectToStudioPlane(uv, width, height, PIN_REST_HEIGHT * KINETIC_SCALE);
	const point: [number, number] = [world[0] / KINETIC_SCALE, world[1] / KINETIC_SCALE];
	const halfWidth = GRID_COLUMNS * GRID_PITCH * 0.5;
	const halfDepth = GRID_ROWS * GRID_PITCH * 0.5;
	return Math.abs(point[0]) <= halfWidth && Math.abs(point[1]) <= halfDepth ? point : null;
}
