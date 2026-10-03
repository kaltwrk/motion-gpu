struct RayHit {
	dist: f32,
	hit: bool,
};

fn saturate(v: f32) -> f32 {
	return clamp(v, 0.0, 1.0);
}

fn easeInOut(t: f32, power: f32) -> f32 {
	let tt = clamp(t, 0.0, 1.0);
	if (tt < 0.5) {
		return 0.5 * pow(2.0 * tt, power);
	}
	return 0.5 + 0.5 * (1.0 - pow(2.0 * (1.0 - tt), power));
}
