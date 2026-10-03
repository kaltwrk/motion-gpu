fn rayMarch(ro: vec3f, rd: vec3f, rot: mat3x3f) -> RayHit {
	var dO = 0.0;
	for (var i = 0; i < MAX_STEPS; i += 1) {
		let p = ro + rd * dO;
		let dS = sceneMap(p, rot);
		if (dS < SURF_DIST) {
			return RayHit(dO, true);
		}
		dO += dS;
		if (dO > MAX_DIST) { break; }
	}
	return RayHit(dO, false);
}
