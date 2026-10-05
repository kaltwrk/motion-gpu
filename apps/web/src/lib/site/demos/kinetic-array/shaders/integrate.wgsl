// The graph schedules this dispatch after the force writer. Each invocation
// updates one independent record using a force evaluated from the old lattice.
@compute @workgroup_size(64)
fn compute(@builtin(global_invocation_id) id: vec3u) {
	let index = id.x;
	if (index >= PIN_COUNT) {
		return;
	}
	let dt = clamp(spektralUniforms.uStep, 0.0, MAX_SIMULATION_STEP);
	let state = pinState[index];
	let force = pinForces[index];
	let acceleration = force.x - force.y * state.x;
	// Symplectic Euler: update velocity before position, with exponential drag.
	// The highest lattice frequency satisfies dt² * (18 + 8 * 60) < 0.554,
	// comfortably below the stability limit of 4, including at 30 fps.
	var velocity = (state.y + force.z + acceleration * dt) * exp(-DAMPING * dt);
	var displacement = state.x + velocity * dt;
	// Mechanical travel limits remove outward velocity instead of adding energy.
	if (displacement < MIN_DISPLACEMENT) {
		displacement = MIN_DISPLACEMENT;
		velocity = max(velocity, 0.0);
	}
	if (displacement > MAX_DISPLACEMENT) {
		displacement = MAX_DISPLACEMENT;
		velocity = min(velocity, 0.0);
	}
	pinState[index] = vec4f(displacement, velocity, force.w, 0.0);
}
