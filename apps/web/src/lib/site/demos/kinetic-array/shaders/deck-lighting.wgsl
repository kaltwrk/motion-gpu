@compute @workgroup_size(8, 8)
fn compute(@builtin(global_invocation_id) id: vec3u) {
	let dimensions = textureDimensions(lighting);
	if (any(id.xy >= dimensions)) { return; }
	let uv = (vec2f(id.xy) + .5) / vec2f(dimensions);
	let xz = (uv * 2. - 1.) * vec2f(DECK_LIGHTING_HALF_X, DECK_LIGHTING_HALF_Z);
	let p = vec3f(xz.x, DECK_LIGHTING_Y, xz.y) * KINETIC_SCALE;
	textureStore(lighting, vec2i(id.xy), vec4f(studio_visibility(p, vec3f(0., 1., 0.)), 1.));
}
