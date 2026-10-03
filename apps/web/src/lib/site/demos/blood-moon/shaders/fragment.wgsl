const IMPACT_LIFETIME: f32 = 8.0;
const CRATER_EPSILON: f32 = 0.0022;
const ATM_MAX_STEPS: i32 = 256;
const ATM_CLOSENESS: f32 = 0.00001;

fn hash31(p: vec3f) -> f32 {
	return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453123);
}

fn valueNoise3(p: vec3f) -> f32 {
	let i = floor(p);
	let f = fract(p);
	let u = f * f * (vec3f(3.0) - 2.0 * f);

	let n000 = hash31(i + vec3f(0.0, 0.0, 0.0));
	let n100 = hash31(i + vec3f(1.0, 0.0, 0.0));
	let n010 = hash31(i + vec3f(0.0, 1.0, 0.0));
	let n110 = hash31(i + vec3f(1.0, 1.0, 0.0));
	let n001 = hash31(i + vec3f(0.0, 0.0, 1.0));
	let n101 = hash31(i + vec3f(1.0, 0.0, 1.0));
	let n011 = hash31(i + vec3f(0.0, 1.0, 1.0));
	let n111 = hash31(i + vec3f(1.0, 1.0, 1.0));

	let nx00 = mix(n000, n100, u.x);
	let nx10 = mix(n010, n110, u.x);
	let nx01 = mix(n001, n101, u.x);
	let nx11 = mix(n011, n111, u.x);
	let nxy0 = mix(nx00, nx10, u.y);
	let nxy1 = mix(nx01, nx11, u.y);
	return mix(nxy0, nxy1, u.z);
}

fn fbm(p: vec3f) -> f32 {
	var total = 0.0;
	var amp = 0.55;
	var freq = 1.0;
	for (var i: i32 = 0; i < 5; i += 1) {
		total += amp * valueNoise3(p * freq);
		freq *= 2.03;
		amp *= 0.52;
	}
	return total;
}

fn atmNoise(x: vec3f) -> f32 {
	let p = floor(x);
	var f = fract(x);
	f = f * f * (vec3f(3.0) - 2.0 * f);

	let n = p.x + p.y * 157.0 + 113.0 * p.z;
	let v1 = fract(753.5453123 * sin(n + vec4f(0.0, 1.0, 157.0, 158.0)));
	let v2 = fract(753.5453123 * sin(n + vec4f(113.0, 114.0, 270.0, 271.0)));
	let v3 = mix(v1, v2, f.z);
	let v4 = mix(v3.xy, v3.zw, f.y);
	return mix(v4.x, v4.y, f.x);
}

fn atmRockyBasis() -> mat3x3f {
	return mat3x3f(
		vec3f(0.28862355854826727, 0.6997227302779844, 0.6535170557707412),
		vec3f(0.06997493955670424, 0.6653237235314099, -0.7432683571499161),
		vec3f(-0.9548821651308448, 0.26025457467376617, 0.14306504491456504)
	);
}

fn atmField(p: vec3f) -> f32 {
	let basis = atmRockyBasis();
	let p1 = basis * p;
	let p2 = basis * p1;
	let n1 = atmNoise(p1 * 5.0);
	let n2 = atmNoise(p2 * 10.0);
	let n3 = atmNoise(p1 * 20.0);
	let n4 = atmNoise(p1 * 40.0);
	let rocky = 0.1 * n1 * n1 + 0.05 * n2 * n2 + 0.02 * n3 * n3 + 0.01 * n4 * n4;
	let sphereDistance = length(p) - 1.0;
	return sphereDistance + select(0.0, rocky * 0.2, sphereDistance < 0.1);
}

fn atmFieldLores(p: vec3f) -> f32 {
	let basis = atmRockyBasis();
	let p1 = basis * p;
	let n1 = atmNoise(p1 * 5.0);
	let rocky = 0.1 * n1 * n1;
	return length(p) - 1.0 + rocky * 0.2;
}

fn rotateY(v: vec3f, angle: f32) -> vec3f {
	let c = cos(angle);
	let s = sin(angle);
	return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

fn rotateX(v: vec3f, angle: f32) -> vec3f {
	let c = cos(angle);
	let s = sin(angle);
	return vec3f(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

fn worldToMoon(v: vec3f, time: f32) -> vec3f {
	let yaw = time * 0.145;
	let tilt = 0.18 + sin(time * 0.11) * 0.05;
	return rotateX(rotateY(v, yaw), tilt);
}

fn moonToWorld(v: vec3f, time: f32) -> vec3f {
	let yaw = time * 0.145;
	let tilt = 0.18 + sin(time * 0.11) * 0.05;
	return rotateY(rotateX(v, -tilt), -yaw);
}

fn surfaceHeight(moonNormal: vec3f) -> f32 {
	let warp = vec3f(
		fbm(moonNormal * 4.3 + vec3f(1.2, 3.1, 5.7)),
		fbm(moonNormal * 4.3 + vec3f(6.8, 2.5, 1.9)),
		fbm(moonNormal * 4.3 + vec3f(3.4, 7.6, 2.2))
	) - vec3f(0.5);
	let warped = normalize(moonNormal + warp * 0.2);

	let erosion = pow(fbm(warped * 9.5), 2.2) * 0.022;
	let grit = (fbm(warped * 23.0 + vec3f(14.0, 3.0, 9.0)) - 0.5) * 0.012;

	return erosion + grit;
}

fn buildBasis(n: vec3f) -> mat3x3f {
	let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.88);
	let tangent = normalize(cross(axis, n));
	let bitangent = cross(n, tangent);
	return mat3x3f(tangent, bitangent, n);
}

fn moonNormalFromHeight(moonNormal: vec3f) -> vec3f {
	let basis = buildBasis(moonNormal);
	let tangent = basis[0];
	let bitangent = basis[1];
	let h = surfaceHeight(moonNormal);
	let hx = surfaceHeight(normalize(moonNormal + tangent * CRATER_EPSILON));
	let hy = surfaceHeight(normalize(moonNormal + bitangent * CRATER_EPSILON));
	let dhx = (hx - h) / CRATER_EPSILON;
	let dhy = (hy - h) / CRATER_EPSILON;
	return normalize(moonNormal - tangent * dhx - bitangent * dhy);
}

fn sphereIntersection(ro: vec3f, rd: vec3f, radius: f32) -> f32 {
	let b = dot(ro, rd);
	let c = dot(ro, ro) - radius * radius;
	let disc = b * b - c;
	if (disc < 0.0) {
		return -1.0;
	}
	let root = sqrt(disc);
	let near = -b - root;
	let far = -b + root;
	return select(far, near, near > 0.0);
}

fn impactBurst(moonNormal: vec3f, shadedNormal: vec3f, viewDir: vec3f, impact: vec4f, time: f32) -> vec4f {
	let born = impact.w;
	if (born < 0.0) {
		return vec4f(0.0);
	}

	let age = time - born;
	if (age < 0.0 || age > IMPACT_LIFETIME) {
		return vec4f(0.0);
	}

	let center = normalize(impact.xyz);
	let arc = acos(clamp(dot(moonNormal, center), -1.0, 1.0));

	let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(center.y) > 0.88);
	let tangent = normalize(cross(axis, center));
	let bitangent = cross(center, tangent);
	let local = vec2f(dot(moonNormal, tangent), dot(moonNormal, bitangent));
	let symLocal = abs(local);

	let ringRadius = age * 1.42;
	let ringWidth = mix(0.25, 0.75, clamp(age / IMPACT_LIFETIME, 0.0, 1.0));
	let ring = exp(-pow((arc - ringRadius) / max(ringWidth, 0.0001), 2.0) * 3.35);
	let core = exp(-arc * 22.0) * exp(-age * 1.6);

	let gridUv = symLocal * 48.0 + vec2f(age * 0.55);
	let cell = abs(fract(gridUv) - vec2f(0.5));
	let line = 1.0 - smoothstep(0.09, 0.22, min(cell.x, cell.y));
	let block = hash31(vec3f(floor(gridUv * 0.5), floor(age * 11.0)));
	let strobe = mix(0.42, 1.0, smoothstep(0.38, 0.86, block));

	let radialSector = 0.5 + 0.5 * cos(atan2(local.y, local.x) * 8.0);
	let spokes = pow(radialSector, 2.25);
	let scan = 0.58 + 0.42 * sin(age * 24.0 + (symLocal.x + symLocal.y) * 145.0);
	let digital = line * (0.35 + spokes * 0.95) * scan * strobe;

	let fresnel = pow(1.0 - max(dot(shadedNormal, viewDir), 0.0), 1.75);
	let decay = exp(-age * 0.36);
	let density = (ring * (1.52 + digital * 1.95) + core * 0.58) * decay;
	let energy = density * (1.0 + fresnel * 1.18);

	let digitalColor = mix(
		vec3f(0.28, 0.0, 0.0),
		vec3f(2.45, 0.018, 0.04),
		clamp(digital * 0.82 + core * 0.55, 0.0, 1.0)
	);

	return vec4f(digitalColor * density * (0.78 + fresnel * 0.58), energy);
}

fn skyColor(rd: vec3f) -> vec3f {
	let horizon = pow(max(0.0, 1.0 - abs(rd.y)), 1.65);

	var col = mix(vec3f(0.0045, 0.006, 0.009), vec3f(0.012, 0.016, 0.023), horizon);
	return col;
}

fn frag(uv: vec2f) -> vec4f {
	let time = spektralFrame.time;
	let resolution = spektralFrame.resolution;
	let fragCoord = uv * resolution;
	let rayScale = 3.0 * spektralUniforms.uLens;
	let src = vec3f(rayScale * (fragCoord - 0.5 * resolution) / resolution.y, 2.0);
	let dirAtm = vec3f(0.0, 0.0, -1.0);
	let rdSky = normalize(vec3f(src.xy, -2.0));

	let angleAtm = time * 0.2;
	let rotAtm = mat3x3f(
		vec3f(-sin(angleAtm), 0.0, cos(angleAtm)),
		vec3f(0.0, 1.0, 0.0),
		vec3f(cos(angleAtm), 0.0, sin(angleAtm))
	);

	var tAtm = 0.0;
	var atmos = 0.0;
	var locAtm = src;
	var valueAtm = 1.0;

	for (var i: i32 = 0; i < ATM_MAX_STEPS; i += 1) {
		locAtm = src + tAtm * dirAtm;
		if (locAtm.z < -1.0) {
			break;
		}

		valueAtm = atmField(rotAtm * locAtm);
		if (valueAtm <= ATM_CLOSENESS) {
			break;
		}

		if (valueAtm > 0.00001) {
			atmos += 0.03;
		}

		tAtm += valueAtm * 0.5;
	}

	let occlusionDir = normalize(vec3f(0.0, 5.0, 1.0));
	let shad1 = max(0.0, atmFieldLores(rotAtm * (locAtm + occlusionDir * 0.1))) / 0.1;
	let shad2 = max(0.0, atmFieldLores(rotAtm * (locAtm + occlusionDir * 0.15))) / 0.15;
	let shad3 = max(0.0, atmFieldLores(rotAtm * (locAtm + occlusionDir * 0.2))) / 0.2;
	var shad = clamp((shad1 + shad2 + shad3) * 0.333333, 0.0, 1.0);
	shad = mix(shad, 1.0, 0.3);

	var color = skyColor(rdSky);
	var atmosImpactEnergy = 0.0;

	let hitT = sphereIntersection(src, dirAtm, 1.0);
	if (hitT > 0.0) {
		let hitPosition = src + dirAtm * hitT;
		let worldNormal = normalize(hitPosition);
		let moonNormal = worldToMoon(worldNormal, time);
		let height = surfaceHeight(moonNormal);
		let moonShaded = moonNormalFromHeight(moonNormal);
		let shadedNormal = normalize(moonToWorld(moonShaded, time));
		let viewDir = normalize(src - hitPosition);

		let sunlightDir = normalize(vec3f(0.0, 2.1, -0.8));
		let bounceDir = normalize(vec3f(0.65, -0.18, 0.48));
		let diffuse = max(0.0, dot(shadedNormal, sunlightDir));
		let backscatter = pow(max(0.0, dot(shadedNormal, bounceDir)), 1.8);
		let spec = pow(max(0.0, dot(reflect(-sunlightDir, shadedNormal), viewDir)), 64.0) * 0.055;
		let rim = pow(1.0 - max(0.0, dot(shadedNormal, viewDir)), 3.1);

		let dustField = fbm(moonNormal * 4.7 + vec3f(12.0, 5.0, 9.0));
		let mineral = fbm(moonNormal * 13.0 + vec3f(1.0, 17.0, 8.0));
		let cavity = clamp(-height * 24.0, 0.0, 1.0);
		let ridges = clamp(height * 22.0, 0.0, 1.0);

		var albedo = mix(vec3f(0.009, 0.01, 0.012), vec3f(0.036, 0.04, 0.047), dustField);
		albedo = mix(albedo, vec3f(0.072, 0.078, 0.088), ridges * 0.23);
		albedo *= 0.68 + mineral * 0.2;

		let ambient = 0.012 + (1.0 - cavity) * 0.03;
		var moonColor = albedo * (ambient + diffuse * 0.57 + backscatter * 0.045);

		let impact0 = impactBurst(moonNormal, shadedNormal, viewDir, spektralUniforms.uImpact0, time);
		let impact1 = impactBurst(moonNormal, shadedNormal, viewDir, spektralUniforms.uImpact1, time);
		let impact2 = impactBurst(moonNormal, shadedNormal, viewDir, spektralUniforms.uImpact2, time);
		let impact3 = impactBurst(moonNormal, shadedNormal, viewDir, spektralUniforms.uImpact3, time);
		let impact4 = impactBurst(moonNormal, shadedNormal, viewDir, spektralUniforms.uImpact4, time);
		let impact5 = impactBurst(moonNormal, shadedNormal, viewDir, spektralUniforms.uImpact5, time);
		let impact6 = impactBurst(moonNormal, shadedNormal, viewDir, spektralUniforms.uImpact6, time);
		let impact7 = impactBurst(moonNormal, shadedNormal, viewDir, spektralUniforms.uImpact7, time);
		let blast = impact0 + impact1 + impact2 + impact3 + impact4 + impact5 + impact6 + impact7;
		let blastEnergy = clamp(blast.w, 0.0, 8.0);
		atmosImpactEnergy = blastEnergy;

		moonColor += blast.xyz * 0.24;
		moonColor += vec3f(spec);
		moonColor += rim * (vec3f(1.0, 1.0, 1.0) * 1.12 + vec3f(1.04, 0.04, 0.07) * blastEnergy * 0.42);

		let edgeDistance = abs(length(src.xy) - 0.98);
		let corona = exp(-edgeDistance * 13.0) * (0.04 + blastEnergy * 0.028);
		moonColor += vec3f(1.32, 0.028, 0.05) * corona;

		color = moonColor;
	}

	let p = 2.0 * (fragCoord / resolution.y - vec2f(0.5 / resolution.y * resolution.x, 0.5));
	let q = max(
		0.1,
		min(
			1.0,
			dot(
				vec3f(p, sqrt(max(1.0 - dot(p, p), 0.0))),
				vec3f(0.0, 2.0, 1.0)
			)
		)
	);
	let atmosLight = shad
		* max(0.0, dot(normalize(src), normalize(vec3f(0.0, 2.0, 1.0))))
		* pow(max(atmos, 0.0), 1.5);
	let atmosImpact = pow(clamp(atmosImpactEnergy * 0.18, 0.0, 8.0), 1.0);
	color += q * (atmosLight * vec3f(0.45, 0.5, 0.6) + atmosImpact * vec3f(1.45, 0.03, 0.055));

	let vignette = smoothstep(1.65, 0.2, length(src.xy));
	color *= 0.74 + 0.26 * vignette;
	color = pow(max(color, vec3f(0.0)), vec3f(0.83));

	return vec4f(color, 1.0);
}
