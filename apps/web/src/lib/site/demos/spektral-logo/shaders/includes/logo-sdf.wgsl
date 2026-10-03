fn sdBox2(p: vec2f, b: vec2f) -> f32 {
	let d = abs(p) - b;
	return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

fn sdSegmentBox(p: vec2f, a: vec2f, b: vec2f, thickness: f32) -> f32 {
	let ab = b - a;
	let len = length(ab);
	let dir = ab / len;
	let n = vec2f(-dir.y, dir.x);
	let q = vec2f(dot(p - 0.5 * (a + b), dir), dot(p - 0.5 * (a + b), n));
	return sdBox2(q, vec2f(0.5 * len, 0.5 * thickness));
}

fn udSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
	let ab = b - a;
	let t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
	return length(p - (a + ab * t));
}

fn udQuarterArc(p: vec2f, c: vec2f, r: f32) -> f32 {
	let q = p - c;
	let eY = vec2f(0.0, r);
	let eX = vec2f(r, 0.0);
	let dArc = abs(length(q) - r);
	let dCap = min(length(q - eY), length(q - eX));
	let insideQuadrant =
		select(0.0, 1.0, q.x >= 0.0) * select(0.0, 1.0, q.y >= 0.0);
	return mix(dCap, dArc, insideQuadrant);
}

fn sdQuarterArcStroke(p: vec2f, c: vec2f, r: f32, w: f32) -> f32 {
	let q = p - c;
	let dArc = abs(length(q) - r) - w;
	let eY = vec2f(0.0, r);
	let eX = vec2f(r, 0.0);
	let dCap = min(length(q - eY), length(q - eX)) - w;
	let insideQuadrant =
		select(0.0, 1.0, q.x >= 0.0) * select(0.0, 1.0, q.y >= 0.0);
	return mix(dCap, dArc, insideQuadrant);
}

fn sdCornerFill(p: vec2f) -> f32 {
	let dH = sdBox2(
		p - vec2f(15.1719, 40.0),
		vec2f(15.1719, 4.0)
	);
	let dV = sdBox2(
		p - vec2f(40.0, 15.1719),
		vec2f(4.0, 15.1719)
	);
	let dD = sdSegmentBox(
		p,
		vec2f(11.7158, 11.7158),
		vec2f(37.1716, 37.1716),
		8.0
	);
	let dR = sdQuarterArcStroke(
		p,
		vec2f(30.3431, 30.3431),
		9.6569,
		4.0
	);
	var d = min(dH, dV);
	d = min(d, dD);
	d = min(d, dR);
	return d;
}

fn sdCorner(p: vec2f) -> f32 {
	let c = vec2f(30.3431, 30.3431);
	let d0 = vec2f(2.8284, -2.8284);
	let d1 = vec2f(-2.8284, 2.8284);
	let da = vec2f(11.7158, 11.7158);
	let hJoin = vec2f(30.3431, 36.0);
	let vJoin = vec2f(36.0, 30.3431);

	var boundary = udSegment(p, vec2f(0.0, 44.0), vec2f(30.3431, 44.0));
	boundary = min(boundary, udQuarterArc(p, c, 13.6569));
	boundary = min(boundary, udSegment(p, vec2f(44.0, 30.3431), vec2f(44.0, 0.0)));
	boundary = min(boundary, udSegment(p, vec2f(44.0, 0.0), vec2f(36.0, 0.0)));
	boundary = min(boundary, udSegment(p, vec2f(36.0, 0.0), vJoin));
	boundary = min(boundary, udSegment(p, vJoin, da + d0));
	boundary = min(boundary, udSegment(p, da + d0, da + d1));
	boundary = min(boundary, udSegment(p, da + d1, hJoin));
	boundary = min(boundary, udSegment(p, vec2f(0.0, 36.0), hJoin));
	boundary = min(boundary, udSegment(p, vec2f(0.0, 36.0), vec2f(0.0, 44.0)));

	let sign = select(1.0, -1.0, sdCornerFill(p) < 0.0);
	return boundary * sign;
}

fn sdLogo2D(p: vec2f) -> f32 {
	let q = p * 46.5 + vec2f(46.5);
	let qm = vec2f(93.0) - q;
	var d = sdCorner(q);
	d = min(d, sdCorner(vec2f(qm.x, q.y)));
	d = min(d, sdCorner(vec2f(q.x, qm.y)));
	d = min(d, sdCorner(qm));
	return d / 46.5;
}

fn sdExtrudeFlat(p: vec3f, h: f32) -> f32 {
	let d2 = sdLogo2D(p.xy);
	let dz = abs(p.z) - h;
	let base = max(d2, dz);
	let edgeInset = -d2;
	let faceInset = -dz;
	let cutterP = vec2f(edgeInset, faceInset) - vec2f(LOGO_INSET_BEVEL_RADIUS);
	let concaveCutter = length(cutterP) - (LOGO_INSET_BEVEL_RADIUS + LOGO_INSET_BEVEL_BITE);
	return max(base, -concaveCutter);
}
