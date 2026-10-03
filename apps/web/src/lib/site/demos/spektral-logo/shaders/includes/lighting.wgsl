fn shadeAcrylic(p: vec3f, n: vec3f, ro: vec3f) -> vec3f {
	let keyLight = normalize(vec3f(-0.78, 0.92, 1.25));
	let warmFill = normalize(vec3f(0.55, -0.35, 0.55));
	let lowerRim = normalize(vec3f(0.0, -0.9, 0.18));
	let viewDir = normalize(ro - p);

	let keyDiffuse = saturate(dot(n, keyLight));
	let fillDiffuse = saturate(dot(n, warmFill));
	let rimDiffuse = saturate(dot(n, lowerRim));

	let keyHalf = normalize(keyLight + viewDir);
	let fillHalf = normalize(warmFill + viewDir);
	let keySpec = pow(saturate(dot(n, keyHalf)), 72.0) * 72.8;
	let sharpKeySpec = pow(saturate(dot(n, keyHalf)), 360.0) * 7.5;
	let fillSpec = pow(saturate(dot(n, fillHalf)), 140.0) * 10.9;
	let fresnel = pow(1.0 - saturate(dot(n, viewDir)), 5.2);

	let acrylicOrange = vec3f(1.0, 0.21, 0.0);
	let innerOrange = vec3f(1.0, 0.62, 0.08);
	let hotHighlight = vec3f(1.0, 0.92, 0.52);
	let whiteGlint = vec3f(1.0, 0.98, 0.86);
	let bodyLight = 0.18 * 1.65 + fillDiffuse * 0.28 + rimDiffuse * 0.18;
	let subsurfaceGlow = (0.18 + fresnel * 1.45 + pow(keyDiffuse, 3.0) * 0.35) * innerOrange;
	let specular = hotHighlight * keySpec + whiteGlint * sharpKeySpec + hotHighlight * fillSpec;
	let edgeFire = innerOrange * fresnel * 0.85;

	return acrylicOrange * bodyLight + subsurfaceGlow * 0.12 + specular + edgeFire;
}
