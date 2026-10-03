fn sceneMap(p: vec3f, rotInv: mat3x3f) -> f32 {
	let lenP = length(p);
	if (lenP > 1.3) {
		return lenP - 1.1;
	}
	return sdExtrudeFlat(rotInv * p, LOGO_HALF_DEPTH);
}

fn getNormal(p: vec3f, rot: mat3x3f) -> vec3f {
	let e = 0.001;
	let k = vec2f(1.0, -1.0);
	return normalize(
		k.xyy * sceneMap(p + k.xyy * e, rot) +
		k.yyx * sceneMap(p + k.yyx * e, rot) +
		k.yxy * sceneMap(p + k.yxy * e, rot) +
		k.xxx * sceneMap(p + k.xxx * e, rot)
	);
}
