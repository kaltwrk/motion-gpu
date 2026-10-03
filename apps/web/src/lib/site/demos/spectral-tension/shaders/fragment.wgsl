fn frag(uv: vec2f) -> vec4f {
	let resolution = spektralFrame.resolution;
	let time = spektralFrame.time * 0.8;

	let q = uv;
	var p = -vec2f(1.0, 1.0) + 2.0 * q;
	p.x *= resolution.x / resolution.y;
	p *= 0.32;

	var color = vec4f(0.0);
	var ray = vec3f(0.0);
	var dist = 0.0;
	var field = 0.0;

	for (var step = 1.0; step <= 96.0; step += 1.0) {
		ray = 2.0 * vec3f(p * dist, dist + time * 0.7);

		field = 0.010 + abs(field) * 0.045;
		dist += field;

		let phase = vec4f(0.0, 1.2, 2.4, 3.6);
		let shimmer = 1.0 + 0.5 * sin(step * 0.16 + phase + dist * 0.12);
		color += shimmer / field;

		let c = cos(dist * 0.12 - ray.z * 0.18 + vec4f(0.0, 1.0, 2.0, 0.0));
		let rot = mat2x2f(vec2f(c.x, c.y), vec2f(c.z, c.w));
		ray = vec3f(rot * ray.xy, ray.z);

		let warp =
			dot(
				sin(vec3f(ray.xy * 1.15 + vec2f(1.2, -0.8), ray.z + time * 3.8)),
				vec3f(10.0, 7.0, 2.0)
			);

		let folds =
			sin(length(ray.xy) * 5.0 - ray.z * 0.35 + time * 1.4)
			+ cos(ray.x - ray.y + time * 0.9) * 0.7;

		field += warp + folds;
	}

	color = tanh((color * color) / vec4f(1e8));

	let tintA = vec3f(1.15, 0.72, 1.35);
	let tintB = vec3f(0.45, 0.95, 1.35);
	let mixWave = 0.5 + 0.5 * sin(ray.z * 0.08 + time * 0.7 + p.x * 2.0);

	var rgb = color.rgb;
	rgb *= mix(tintA, tintB, vec3f(mixWave));
	rgb.b *= 1.2 + 0.5 * sin(ray.z * 0.12 + 0.5);
	rgb.r *= 0.95 + 0.35 * sin(ray.z * 0.07 + 1.4);
	rgb *= 2.15;

	let vignette = 1.0 - dot(p * 0.55, p * 0.55);
	rgb *= clamp(vignette + 0.15, 0.0, 1.0);

	return vec4f(rgb, 1.0);
}
