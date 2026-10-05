@compute @workgroup_size(8, 8)
fn compute(@builtin(global_invocation_id) id: vec3u) {
	let dimensions = floor_lighting_size(spektralFrame.resolution);
	if (any(id.xy >= dimensions)) { return; }
	let uv = (vec2f(id.xy) + .5) / vec2f(dimensions);
	let ray = studio_camera(uv, spektralFrame.resolution);
	var visibility = vec3f(1.);
	if (ray.direction.y < -.000001) {
		let p = ray.origin + ray.direction * (-ray.origin.y / ray.direction.y);
		visibility = studio_visibility(p, vec3f(0., 1., 0.));
	}
	textureStore(lighting, vec2i(id.xy), vec4f(visibility, 1.));
}
