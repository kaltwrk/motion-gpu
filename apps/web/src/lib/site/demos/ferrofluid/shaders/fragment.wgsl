#include <studio>

const FLUID_LEVEL: f32 = 0.135;
const FLUID_RADIUS: f32 = 1.075;
const DOMAIN: f32 = 2.6;

struct SurfaceHit {
	travel: f32,
	material: u32,
}

fn fluid_state(p: vec2f) -> vec4f {
	return textureSampleLevel(uFluid, uFluidSampler, p / DOMAIN + 0.5, 0.0);
}

fn fluid_height(p: vec2f) -> f32 {
	let meniscus = 0.012 * exp(-max(FLUID_RADIUS - length(p), 0.0) / 0.017);
	return FLUID_LEVEL + fluid_state(p).r + meniscus;
}

fn rounded_cylinder(p: vec3f, radius: f32, half_height: f32, bevel: f32) -> f32 {
	let q = vec2f(length(p.xz) - radius, abs(p.y) - half_height);
	return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - bevel;
}

fn tray_distance(p: vec3f) -> f32 {
	let shell = rounded_cylinder(p - vec3f(0.0, 0.080, 0.0), 1.145, 0.065, 0.015);
	let well = max(length(p.xz) - 1.076, 0.047 - p.y);
	let groove = length(vec2f(length(p.xz) - 1.162, p.y - 0.040)) - 0.0025;
	return max(max(shell, -well), -groove);
}

fn fluid_distance(p: vec3f) -> f32 {
	// The slope bound keeps marching conservative on the steep magnetic peaks.
	return max(max((p.y - fluid_height(p.xz)) * 0.16, length(p.xz) - FLUID_RADIUS), 0.049 - p.y);
}

fn object_distance(p: vec3f) -> vec2f {
	let tray = tray_distance(p);
	let liquid = fluid_distance(p);
	return select(vec2f(tray, 1.0), vec2f(liquid, 2.0), liquid < tray);
}

fn object_interval(ro: vec3f, rd: vec3f) -> vec2f {
	let inverse = 1.0 / rd;
	let near_corner = (vec3f(-1.18, 0.0, -1.18) - ro) * inverse;
	let far_corner = (vec3f(1.18, 0.96, 1.18) - ro) * inverse;
	let lo = min(near_corner, far_corner);
	let hi = max(near_corner, far_corner);
	return vec2f(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}

fn trace_object(ro: vec3f, rd: vec3f) -> SurfaceHit {
	let interval = object_interval(ro, rd);
	var travel = max(interval.x, 0.0);
	if (travel >= interval.y) { return SurfaceHit(100.0, 0u); }
	for (var step_index = 0u; step_index < 192u; step_index++) {
		let sample_position = ro + rd * travel;
		let distance = object_distance(sample_position);
		if (distance.x < 0.00045) {
			return SurfaceHit(travel, u32(distance.y));
		}
		travel += max(distance.x, 0.00035);
		if (travel > interval.y) { break; }
	}
	return SurfaceHit(100.0, 0u);
}

fn surface_normal(p: vec3f, material: u32) -> vec3f {
	if (material == 2u) {
		let epsilon = DOMAIN / 384.0;
		let dx = fluid_height(p.xz + vec2f(epsilon, 0.0)) - fluid_height(p.xz - vec2f(epsilon, 0.0));
		let dz = fluid_height(p.xz + vec2f(0.0, epsilon)) - fluid_height(p.xz - vec2f(0.0, epsilon));
		return normalize(vec3f(-dx, 2.0 * epsilon, -dz));
	}
	let e = 0.0005;
	return normalize(vec3f(
		tray_distance(p + vec3f(e, 0.0, 0.0)) - tray_distance(p - vec3f(e, 0.0, 0.0)),
		tray_distance(p + vec3f(0.0, e, 0.0)) - tray_distance(p - vec3f(0.0, e, 0.0)),
		tray_distance(p + vec3f(0.0, 0.0, e)) - tray_distance(p - vec3f(0.0, 0.0, e))
	));
}

fn studio_occluder_distance(p: vec3f) -> f32 {
	// Match the conservative slope bound used by primary rays. The old 0.42
	// height multiplier could march straight through a narrow magnetic spike.
	let liquid = max(fluid_distance(p), p.y - (FLUID_LEVEL + 0.732));
	return min(tray_distance(p), liquid);
}

fn visibility_at(p: vec3f, normal: vec3f) -> vec3f {
	return studio_visibility(p, normal);
}

fn liquid_occlusion(p: vec3f) -> f32 {
	var occlusion = 0.0;
	for (var i = 0u; i < 6u; i++) {
		let angle = f32(i) * STUDIO_PI / 3.0;
		let offset = vec2f(cos(angle), sin(angle)) * 0.11;
		let rise = max(fluid_height(p.xz + offset) - p.y, 0.0);
		occlusion += rise / (0.11 + rise);
	}
	return 1.0 - occlusion * 0.075;
}

fn render_scene(uv: vec2f) -> vec3f {
	let ray = studio_camera(uv, spektralFrame.resolution);
	let hit = trace_object(ray.origin, ray.direction);
	if (hit.material == 0u) {
		let travel = (STUDIO_FLOOR_Y - ray.origin.y) / ray.direction.y;
		if (travel <= 0.0) { return studio_background(ray.direction); }
		let p = ray.origin + ray.direction * travel;
		let radius = length(p.xz);
		let contact = 1.0 - 0.52 * exp(-max(radius - 1.10, 0.0) / 0.070);
		return studio_floor(p, -ray.direction, visibility_at(p, vec3f(0.0, 1.0, 0.0)), contact);
	}
	let p = ray.origin + ray.direction * hit.travel;
	let n = surface_normal(p, hit.material);
	let visibility = visibility_at(p, n);
	if (hit.material == 2u) {
		let occlusion = liquid_occlusion(p);
		return studio_surface(p, n, -ray.direction, vec3f(0.009, 0.012, 0.015), 0.12, 0.145, visibility, occlusion);
	}
	let top_face = smoothstep(0.45, 0.95, n.y);
	let roughness = mix(0.30, 0.24, top_face);
	let base_color = vec3f(0.055, 0.061, 0.070);
	let contact = 0.68 + 0.32 * smoothstep(0.0, 0.10, p.y);
	return studio_surface(p, n, -ray.direction, base_color, 0.68, roughness, visibility, contact);
}

fn frag(uv: vec2f) -> vec4f {
	// Fixed sub-pixel samples keep the fine liquid silhouettes stable in motion.
	let offset = vec2f(0.25, 0.25) / spektralFrame.resolution;
	let color = (render_scene(uv + offset) + render_scene(uv - offset)) * 0.5;
	return vec4f(max(color, vec3f(0.0)), 1.0);
}
