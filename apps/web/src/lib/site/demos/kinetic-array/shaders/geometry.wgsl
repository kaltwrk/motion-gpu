fn pin_center(cell: vec2i) -> vec2f {
	return (vec2f(cell) - vec2f(f32(GRID_COLUMNS - 1u), f32(GRID_ROWS - 1u)) * .5) * GRID_PITCH;
}

fn pin_index(cell: vec2i) -> u32 {
	return u32(cell.y) * GRID_COLUMNS + u32(cell.x);
}

fn pin_height(index: u32) -> f32 {
	return PIN_REST_HEIGHT + pinState[index].x;
}

fn rounded_box(p: vec3f, size: vec3f, radius: f32) -> f32 {
	let q = abs(p) - size + radius;
	return length(max(q, vec3f(0.))) + min(max(q.x, max(q.y, q.z)), 0.) - radius;
}

fn cylinder_distance(p: vec3f, radius: f32, half_height: f32) -> f32 {
	let q = vec2f(length(p.xz) - radius, abs(p.y) - half_height);
	return min(max(q.x, q.y), 0.) + length(max(q, vec2f(0.)));
}

fn segment_distance(p: vec3f, radius: f32, bottom: f32, top: f32) -> f32 {
	return cylinder_distance(p - vec3f(0., (bottom + top) * .5, 0.), radius, (top - bottom) * .5);
}

fn base_field(p: vec3f) -> vec2f {
	var hit = vec2f(rounded_box(p - vec3f(0., .151, 0.), vec3f(1.36, .112, 1.08), .035), 1.);
	let gasket = rounded_box(p - vec3f(0., .264, 0.), vec3f(1.321, .004, 1.041), .022);
	if (gasket < hit.x) { hit = vec2f(gasket, 3.); }
	let deck = rounded_box(p - vec3f(0., .279, 0.), vec3f(1.325, .015, 1.045), .012);
	if (deck < hit.x) { hit = vec2f(deck, 2.); }
	let foot = cylinder_distance(vec3f(abs(p.x) - 1.11, p.y - .024, abs(p.z) - .83), .075, .023);
	if (foot < hit.x) { hit = vec2f(foot, 3.); }
	let screw = vec3f(abs(p.x) - 1.273, p.y - .294, abs(p.z) - .988);
	let screw_radius = length(screw.xz);
	if (screw_radius < .024 && p.y > .282) {
		let socket = max(abs(screw.x) * .8660254 + abs(screw.z) * .5, abs(screw.z)) - .006;
		let head = max(cylinder_distance(screw, .0195, .002), -max(socket, abs(screw.y - .002) - .003));
		let well = cylinder_distance(screw, .021, .012);
		hit.x = max(hit.x, -well);
		if (head < hit.x) { hit = vec2f(head, 4.); }
	}
	return hit;
}

fn pin_field(p: vec3f, height: f32) -> f32 {
	let head = cylinder_distance(p - vec3f(0., height - .0145, 0.), .0585, .0115) - .003;
	let length = max(height - .029 - .310, .001);
	let first = .310 + length * .34;
	let second = .310 + length * .67;
	let stem_a = segment_distance(p, .028, .294, first);
	let stem_b = segment_distance(p, .023, first - .006, second);
	let stem_c = segment_distance(p, .019, second - .006, height - .025);
	let guide = segment_distance(p, .040, .294, .313);
	return min(head, min(guide, min(stem_a, min(stem_b, stem_c))));
}

// Evaluate the local group of actual mechanisms for contact and soft shadows.
// Traversal bounds must not enter this field: a bound is safe for skipping empty
// space, but would contribute a false solid-box penumbra to studio_shadow.
fn array_field(p: vec3f) -> f32 {
	let grid = p.xz / GRID_PITCH + vec2f(f32(GRID_COLUMNS - 1u), f32(GRID_ROWS - 1u)) * .5;
	let cell = clamp(vec2i(round(grid)), vec2i(0), vec2i(i32(GRID_COLUMNS) - 1, i32(GRID_ROWS) - 1));
	let center = pin_center(cell);
	var distance = pin_field(p - vec3f(center.x, 0., center.y), pin_height(pin_index(cell)));
	for (var z = -1; z <= 1; z++) {
		for (var x = -1; x <= 1; x++) {
			if (x == 0 && z == 0) { continue; }
			let c = cell + vec2i(x, z);
			if (any(c < vec2i(0)) || c.x >= i32(GRID_COLUMNS) || c.y >= i32(GRID_ROWS)) { continue; }
			let q = p - vec3f(pin_center(c).x, 0., pin_center(c).y);
			let height = pin_height(pin_index(c));
			// A conservative box bound rejects mechanisms that cannot be closest.
			// Only the exact surface distance contributes to shading or shadows.
			let bound = max(max(abs(q.x), abs(q.z)) - .0615, max(.294 - q.y, q.y - height));
			if (bound >= distance + .000001) { continue; }
			distance = min(distance, pin_field(q, height));
		}
	}
	return distance;
}

fn kinetic_field(p: vec3f) -> f32 {
	let bounds = rounded_box(p - vec3f(0., .610, 0.), vec3f(1.225, .32, .935), 0.);
	let base = base_field(p).x;
	if (base < bounds) { return base; }
	return min(base, array_field(p));
}

fn studio_occluder_distance(p: vec3f) -> f32 {
	return kinetic_field(p / KINETIC_SCALE) * KINETIC_SCALE;
}
