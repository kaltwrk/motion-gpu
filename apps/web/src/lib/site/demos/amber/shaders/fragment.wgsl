#include <studio>

const CRYSTAL_CENTER = vec3f(0.0, 0.760, 0.0);

fn rotate_y(p: vec3f, angle: f32) -> vec3f {
	let c = cos(angle);
	let s = sin(angle);
	return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn specimen_angle() -> f32 {
	return 0.32 + spektralUniforms.uRotation + spektralUniforms.uInspect.x * 0.20;
}

fn local_position(p: vec3f) -> vec3f {
	return rotate_y(p - CRYSTAL_CENTER, -specimen_angle());
}

fn world_direction(p: vec3f) -> vec3f {
	return rotate_y(p, specimen_angle());
}

struct CrystalHit {
	entry: f32,
	exit: f32,
	entry_normal: vec3f,
	exit_normal: vec3f,
}

// An asymmetrical glass nodule with two broad conchoidal fractures. The
// elliptical envelope keeps its silhouette organic, including in profile.
fn fracture_field(p: vec3f) -> f32 {
	var q = p;
	q.x -= 0.105 * sin(p.y * 2.7 + 0.35) + 0.025 * sin(p.y * 9.0 + p.z * 3.0);
	q.z += 0.038 * sin(p.y * 4.0 + p.x * 2.0);
	let radii = vec3f(0.68, 0.89, 0.49);
	let a = length(q / radii);
	let b = length(q / (radii * radii));
	var distance = a * (a - 1.0) / max(b, 0.001);
	distance = max(distance, 2.04 - length(p - vec3f(-0.13, 0.13, 2.34)));
	distance = max(distance, 1.48 - length(p - vec3f(1.91, -0.04, 0.29)));
	return max(distance, -p.y - 0.755);
}

fn fracture_normal(p: vec3f) -> vec3f {
	let e = 0.0008;
	return normalize(vec3f(
		fracture_field(p + vec3f(e, 0.0, 0.0)) - fracture_field(p - vec3f(e, 0.0, 0.0)),
		fracture_field(p + vec3f(0.0, e, 0.0)) - fracture_field(p - vec3f(0.0, e, 0.0)),
		fracture_field(p + vec3f(0.0, 0.0, e)) - fracture_field(p - vec3f(0.0, 0.0, e))
	));
}

fn surface_relief(p: vec3f) -> f32 {
	if (spektralUniforms.uReady < 0.5) { return 0.0; }
	// Smooth projection weights avoid displacement seams at chipped boundaries.
	var weights = pow(abs(p / vec3f(0.68, 0.89, 0.49)), vec3f(4.0));
	weights /= max(dot(weights, vec3f(1.0)), 0.001);
	let q = p * 1.7;
	let h = textureSampleLevel(uHeight, uHeightSampler, q.zy, 2.5).r * weights.x
		+ textureSampleLevel(uHeight, uHeightSampler, q.xz, 2.5).r * weights.y
		+ textureSampleLevel(uHeight, uHeightSampler, q.xy, 2.5).r * weights.z;
	return (h - 0.48) * 0.012;
}

fn outer_field(p: vec3f) -> f32 {
	return max(fracture_field(p) + surface_relief(p), -p.y - 0.755);
}

fn outer_normal(p: vec3f) -> vec3f {
	let e = 0.0008;
	let a = vec3f(1.0, -1.0, -1.0);
	let b = vec3f(-1.0, -1.0, 1.0);
	let c = vec3f(-1.0, 1.0, -1.0);
	let d = vec3f(1.0, 1.0, 1.0);
	return normalize(a * outer_field(p + a * e) + b * outer_field(p + b * e)
		+ c * outer_field(p + c * e) + d * outer_field(p + d * e));
}

fn trace_outer(ro: vec3f, rd: vec3f) -> CrystalHit {
	let projected = dot(ro, rd);
	let discriminant = projected * projected - dot(ro, ro) + 1.2 * 1.2;
	var hit = CrystalHit(0.0, -1000.0, vec3f(0.0, 1.0, 0.0), vec3f(0.0, 1.0, 0.0));
	if (discriminant < 0.0) { return hit; }
	let end = -projected + sqrt(discriminant);
	var travel = max(0.0, -projected - sqrt(discriminant));
	for (var i = 0u; i < 100u; i++) {
		let p = ro + rd * travel;
		let distance = outer_field(p);
		if (distance < 0.00025) {
			hit.entry = travel;
			hit.exit = end;
			hit.entry_normal = outer_normal(p);
			return hit;
		}
		travel += max(distance * 0.55, 0.00018);
		if (travel > end) { break; }
	}
	return hit;
}

fn exit_distance(p: vec3f, direction: vec3f) -> f32 {
	var travel = 0.015;
	for (var i = 0u; i < 72u; i++) {
		let depth = -fracture_field(p + direction * travel);
		if (depth < 0.0003) { break; }
		travel += max(depth * 0.72, 0.0003);
		if (travel > 2.0) { break; }
	}
	return travel;
}

fn studio_occluder_distance(p: vec3f) -> f32 {
	return fracture_field(local_position(p)) * 0.80;
}

struct MineralSample {
	color: vec3f,
	normal: vec3f,
	roughness: f32,
	height: f32,
	occlusion: f32,
}

// Project in object space so texture detail remains attached while dragging.
// Explicit LOD permits sampling after divergent ray/plane intersection tests.
fn mineral_sample(p: vec3f, geometric: vec3f, lod: f32, strength: f32) -> MineralSample {
	if (spektralUniforms.uReady < 0.5) {
		return MineralSample(vec3f(0.004), geometric, 0.11, 0.5, 1.0);
	}
	let signs = select(vec3f(-1.0), vec3f(1.0), geometric >= vec3f(0.0));
	var weight = pow(abs(geometric), vec3f(8.0));
	weight /= weight.x + weight.y + weight.z;
	let q = p * 1.7;
	let ux = vec2f(-signs.x * q.z, q.y);
	let uy = vec2f(q.x, -signs.y * q.z);
	let uz = vec2f(signs.z * q.x, q.y);
	let color = textureSampleLevel(uAlbedo, uAlbedoSampler, ux, lod).rgb * weight.x
		+ textureSampleLevel(uAlbedo, uAlbedoSampler, uy, lod).rgb * weight.y
		+ textureSampleLevel(uAlbedo, uAlbedoSampler, uz, lod).rgb * weight.z;
	let roughness = textureSampleLevel(uRoughness, uRoughnessSampler, ux, lod).r * weight.x
		+ textureSampleLevel(uRoughness, uRoughnessSampler, uy, lod).r * weight.y
		+ textureSampleLevel(uRoughness, uRoughnessSampler, uz, lod).r * weight.z;
	let height = textureSampleLevel(uHeight, uHeightSampler, ux, lod).r * weight.x
		+ textureSampleLevel(uHeight, uHeightSampler, uy, lod).r * weight.y
		+ textureSampleLevel(uHeight, uHeightSampler, uz, lod).r * weight.z;
	let ao = textureSampleLevel(uAO, uAOSampler, ux, lod).r * weight.x
		+ textureSampleLevel(uAO, uAOSampler, uy, lod).r * weight.y
		+ textureSampleLevel(uAO, uAOSampler, uz, lod).r * weight.z;
	let nx = textureSampleLevel(uNormal, uNormalSampler, ux, lod).xyz * 2.0 - 1.0;
	let ny = textureSampleLevel(uNormal, uNormalSampler, uy, lod).xyz * 2.0 - 1.0;
	let nz = textureSampleLevel(uNormal, uNormalSampler, uz, lod).xyz * 2.0 - 1.0;
	let gx = vec3f(0.0, nx.y, -nx.x * signs.x) / max(nx.z, 0.25);
	let gy = vec3f(ny.x, 0.0, -ny.y * signs.y) / max(ny.z, 0.25);
	let gz = vec3f(nz.x * signs.z, nz.y, 0.0) / max(nz.z, 0.25);
	let gradient = gx * weight.x + gy * weight.y + gz * weight.z;
	let tangent = gradient - geometric * dot(geometric, gradient);
	return MineralSample(color, normalize(geometric + tangent * strength), roughness, height, ao);
}

fn texture_footprint(travel: f32, normal: vec3f, direction: vec3f) -> f32 {
	let texels = f32(textureDimensions(uAlbedo, 0).x);
	let pixels = min(spektralFrame.resolution.x, spektralFrame.resolution.y);
	return max(0.0, log2(texels * 2.3 * travel / (STUDIO_FOCAL_LENGTH * pixels * max(abs(dot(normal, direction)), 0.2))));
}

// A shallow dielectric coat remains distinct from the rough mineral inside.
// Snell's law and a traced exit distance bound the buried-layer parallax;
// Beer absorption makes thick regions smoky and thin edges amber.
fn crystal_color(p: vec3f, ray_direction: vec3f, hit: CrystalHit, lod: f32) -> vec3f {
	let n = hit.entry_normal;
	let view = -ray_direction;
	let coat = mineral_sample(p, n, lod, 0.17);
	let outer_n = coat.normal;
	let roughness = clamp(0.065 + coat.roughness * 0.35, 0.065, 0.19);
	let inside = refract(ray_direction, outer_n, 1.0 / 1.48);
	let thickness = exit_distance(p, inside);
	let depth = mix(0.09, 0.255, spektralUniforms.uReveal);
	let layer_travel = min(depth / max(dot(-inside, n), 0.22), thickness);
	let below = p + inside * layer_travel;
	let layer_n = fracture_normal(below);
	let angular_blur = pow(1.0 - max(dot(layer_n, view), 0.0), 2.0) * 3.0;
	let mineral = mineral_sample(below, layer_n, lod + 0.15 + angular_blur + layer_travel * 0.8, 1.15);
	let wn = world_direction(mineral.normal);
	let world_p = world_direction(p) + CRYSTAL_CENTER;
	let lighting = studio_irradiance(world_p, wn, vec3f(1.0));
	let density = clamp(mineral.height * 0.70 + dot(mineral.color, vec3f(0.333)) * 38.0, 0.0, 1.0);
	let mineral_tint = mix(vec3f(0.13, 0.027, 0.006), vec3f(0.70, 0.265, 0.055), density);
	let facing = pow(max(dot(mineral.normal, view), 0.0), 2.5);
	let absorption = vec3f(1.7, 5.8, 12.0);
	let transmission = exp(-absorption * thickness);
	let attenuation = exp(-absorption * layer_travel * 0.7);
	let internal_light = mineral_tint * (lighting * 0.30 + vec3f(0.28)) * mineral.occlusion;
	let medium = vec3f(0.022, 0.003, 0.0015);
	var buried = mix(medium, internal_light, facing) * attenuation;
	// The transition into the thin glass shell follows actual remaining chord
	// length, rather than a screen-space rim or an emissive outline.
	let core_weight = smoothstep(0.0, 0.045, thickness - layer_travel);
	let local_exit_n = fracture_normal(p + inside * thickness);
	let exit_n = world_direction(local_exit_n);
	let through_direction = refract(inside, -local_exit_n, 1.48);
	var transmitted_environment = vec3f(0.30, 0.32, 0.36);
	if (dot(through_direction, through_direction) > 0.01) {
		transmitted_environment = studio_environment(world_p, world_direction(through_direction), 0.25);
	} else {
		transmitted_environment = studio_environment(world_p, world_direction(reflect(inside, -local_exit_n)), 0.22) * 0.55;
	}
	let edge_light = transmission * (transmitted_environment * 0.30 + studio_irradiance(world_p, exit_n, vec3f(1.0)) * 0.085);
	buried = mix(edge_light, buried + edge_light * 0.12, core_weight);
	let fresnel = studio_fresnel(vec3f(0.038), dot(outer_n, view));
	let reflection = studio_environment(world_p, world_direction(reflect(ray_direction, outer_n)), roughness);
	return reflection * fresnel + buried * (1.0 - fresnel);
}

fn render_amber(uv: vec2f) -> vec3f {
	let ray = studio_camera(uv, spektralFrame.resolution);
	let ro = local_position(ray.origin);
	let rd = rotate_y(ray.direction, -specimen_angle());
	let hit = trace_outer(ro, rd);
	if (hit.exit < max(hit.entry, 0.0)) {
		let travel = -ray.origin.y / ray.direction.y;
		if (travel <= 0.0) { return studio_background(ray.direction); }
		let p = ray.origin + ray.direction * travel;
		let clearance = max(studio_occluder_distance(p), 0.0);
		let contact = 1.0 - 0.50 * exp(-clearance / 0.045);
		return studio_floor(p, -ray.direction, studio_visibility(p, vec3f(0.0, 1.0, 0.0)), contact);
	}
	let p = ro + rd * hit.entry;
	let lod = texture_footprint(hit.entry, hit.entry_normal, rd);
	return crystal_color(p, rd, hit, lod);
}

fn frag(uv: vec2f) -> vec4f {
	let offset = vec2f(0.25) / spektralFrame.resolution;
	let color = 0.5 * (render_amber(uv - offset) + render_amber(uv + offset));
	return vec4f(max(color, vec3f(0.0)), 1.0);
}
