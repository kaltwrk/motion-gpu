// This dispatch reads the imported pin state, before integration writes it.
// It never writes a pin position, so neighboring reads have no race condition.
@compute @workgroup_size(64)
fn compute(@builtin(global_invocation_id) id: vec3u) {
	let index = id.x;
	if (index >= PIN_COUNT) {
		return;
	}
	let column = index % GRID_COLUMNS;
	let row = index / GRID_COLUMNS;
	var neighborSum = 0.0;
	var neighborCount = 0.0;
	if (column > 0u) {
		neighborSum += pinState[index - 1u].x;
		neighborCount += 1.0;
	}
	if (column + 1u < GRID_COLUMNS) {
		neighborSum += pinState[index + 1u].x;
		neighborCount += 1.0;
	}
	if (row > 0u) {
		neighborSum += pinState[index - GRID_COLUMNS].x;
		neighborCount += 1.0;
	}
	if (row + 1u < GRID_ROWS) {
		neighborSum += pinState[index + GRID_COLUMNS].x;
		neighborCount += 1.0;
	}

	let center = (vec2f(f32(GRID_COLUMNS), f32(GRID_ROWS)) - vec2f(1.0)) * 0.5;
	let position = (vec2f(f32(column), f32(row)) - center) * GRID_PITCH;
	let inputState = interaction[0];
	let offset = position - inputState.xy;
	let distanceSquared = dot(offset, offset);
	let footprint = exp(-distanceSquared / (2.0 * PRESS_RADIUS * PRESS_RADIUS));
	let pressure = footprint * clamp(inputState.z, 0.0, 1.0);
	let impulseFootprint = exp(-distanceSquared / (2.0 * IMPULSE_RADIUS * IMPULSE_RADIUS));
	let impulse = -IMPULSE_GAIN * impulseFootprint * clamp(inputState.w, 0.0, 1.0);
	let drivingForce = NEIGHBOR_STIFFNESS * neighborSum - PRESS_GAIN * pressure;
	let stiffness = REST_STIFFNESS + NEIGHBOR_STIFFNESS * neighborCount;
	pinForces[index] = vec4f(drivingForce, stiffness, impulse, pressure);
}
