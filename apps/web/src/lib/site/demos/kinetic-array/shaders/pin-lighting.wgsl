@compute @workgroup_size(8, 8)
fn compute(@builtin(global_invocation_id) id: vec3u) {
	let dimensions = textureDimensions(lighting);
	if (any(id.xy >= dimensions)) { return; }
	let tile = id.xy / vec2u(PIN_LIGHTING_TILE_WIDTH, PIN_LIGHTING_TILE_HEIGHT);
	let index = tile.y * PIN_LIGHTING_COLUMNS + tile.x;
	let local = id.xy % vec2u(PIN_LIGHTING_TILE_WIDTH, PIN_LIGHTING_TILE_HEIGHT);
	if (index >= PIN_COUNT || (local.y < PIN_LIGHTING_TOP_SIZE && local.x >= PIN_LIGHTING_TOP_SIZE)) {
		textureStore(lighting, vec2i(id.xy), vec4f(1.));
		return;
	}
	let center = pin_center(vec2i(i32(index % GRID_COLUMNS), i32(index / GRID_COLUMNS)));
	let height = pin_height(index);
	var p: vec3f;
	var normal: vec3f;
	if (local.y < PIN_LIGHTING_TOP_SIZE) {
		var q = ((vec2f(local) + .5) / f32(PIN_LIGHTING_TOP_SIZE) * 2. - 1.) * PIN_LIGHTING_TOP_RADIUS;
		// Extend boundary values into square corners, so interpolation at the
		// circular edge never mixes in lighting evaluated in empty space.
		q *= min(1., PIN_LIGHTING_TOP_RADIUS / max(length(q), .000001));
		p = vec3f(center.x + q.x, height, center.y + q.y);
		normal = vec3f(0., 1., 0.);
	} else {
		let row = local.y - PIN_LIGHTING_TOP_SIZE;
		var chart = 0u;
		for (var candidate = 1u; candidate < 7u; candidate++) {
			if (row >= PIN_CHART_OFFSETS[candidate]) { chart = candidate; }
		}
		let bounds = pin_lighting_chart(height, chart);
		let v = (f32(row - PIN_CHART_OFFSETS[chart]) + .5) / f32(PIN_CHART_ROWS[chart]);
		let angle = (f32(local.x) + .5) / f32(PIN_LIGHTING_TILE_WIDTH) * 2. * STUDIO_PI;
		let radial = vec2f(cos(angle), sin(angle));
		let radius = mix(bounds.z, bounds.w, v);
		p = vec3f(center.x + radial.x * radius, mix(bounds.x, bounds.y, v), center.y + radial.y * radius);
		let slope = (bounds.w - bounds.z) / max(bounds.y - bounds.x, .000001);
		normal = normalize(vec3f(radial.x, -slope, radial.y));
	}
	textureStore(lighting, vec2i(id.xy), vec4f(studio_visibility(p * KINETIC_SCALE, normal), 1.));
}
