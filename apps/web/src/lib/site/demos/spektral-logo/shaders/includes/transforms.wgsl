fn rotY(a: f32) -> mat3x3f {
	let s = sin(a);
	let c = cos(a);
	return mat3x3f(
		vec3f(c, 0.0, -s),
		vec3f(0.0, 1.0, 0.0),
		vec3f(s, 0.0, c)
	);
}
