// Shared studio, in metres relative to the display object.
// Keep the floor, camera, emitters and linear-light response consistent across
// demos. A scene supplies visibility and contact occlusion for its own geometry.
const STUDIO_PI: f32 = 3.14159265359;
const STUDIO_LIGHTS = array<vec3f, 3>(
	vec3f(-3.4, 4.8, 1.4),
	vec3f(2.3, 3.4, -3.0),
	vec3f(3.4, 2.7, 3.8)
);
const STUDIO_LIGHT_SIZE = array<vec2f, 3>(
	vec2f(2.4, 1.25), vec2f(0.45, 2.0), vec2f(2.4, 1.8)
);
const STUDIO_RADIANCE = array<vec3f, 3>(
	vec3f(10.0, 10.3, 10.7),
	vec3f(5.2, 6.1, 7.3),
	vec3f(2.7, 2.60, 2.45)
);

// A demo supplies studio_occluder_distance(p): a conservative signed distance
// to its object, excluding the receiving floor. The shared light geometry sets
// shadow softness, so objects in different demos sit in the same studio.
fn studio_shadow(p: vec3f, normal: vec3f, index: u32) -> f32 {
	let offset = p + normal * 0.0015;
	let to_light = STUDIO_LIGHTS[index] - offset;
	let light_distance = length(to_light);
	let direction = to_light / light_distance;
	let light_normal = normalize(vec3f(0.0, 0.18, 0.0) - STUDIO_LIGHTS[index]);
	let projected_area = 4.0 * STUDIO_LIGHT_SIZE[index].x * STUDIO_LIGHT_SIZE[index].y
		* abs(dot(light_normal, direction));
	// The equivalent-area disk preserves the projected area of a finite
	// softbox. Using the longest side made thin strips cast excessively wide cones.
	let angular_radius = sqrt(projected_area / STUDIO_PI) / light_distance;
	var travel = 0.003;
	var visibility = 1.0;
	var previous_travel = travel;
	var closest_interval = vec2f(travel);
	for (var step_index = 0u; step_index < 112u; step_index++) {
		let distance = studio_occluder_distance(offset + direction * travel);
		if (distance < 0.00015) { return 0.0; }
		let step_size = min(distance, 0.32);
		let angular_clearance = distance / max(travel * angular_radius, 0.0001);
		if (angular_clearance < visibility) {
			visibility = angular_clearance;
			closest_interval = vec2f(previous_travel, min(travel + step_size, light_distance));
		}
		previous_travel = travel;
		travel += step_size;
		if (travel >= light_distance || visibility < 0.001) { break; }
	}
	// Refine the angular clearance between the closest march samples. This
	// remains valid for conservative, piecewise planar fields: fitting a tangent
	// between their empty spheres can invent dark contours at plane boundaries.
	if (visibility < 1.0 && visibility > 0.001) {
		for (var refinement = 0u; refinement < 14u; refinement++) {
			let first = mix(closest_interval.x, closest_interval.y, 1.0 / 3.0);
			let second = mix(closest_interval.x, closest_interval.y, 2.0 / 3.0);
			let a = studio_occluder_distance(offset + direction * first) / max(first * angular_radius, 0.0001);
			let b = studio_occluder_distance(offset + direction * second) / max(second * angular_radius, 0.0001);
			visibility = min(visibility, min(a, b));
			if (a < b) { closest_interval.y = second; } else { closest_interval.x = first; }
		}
	}
	return smoothstep(0.0, 1.0, visibility);
}

fn studio_visibility(p: vec3f, normal: vec3f) -> vec3f {
	return vec3f(studio_shadow(p, normal, 0u), studio_shadow(p, normal, 1u), studio_shadow(p, normal, 2u));
}

struct StudioRay {
	origin: vec3f,
	direction: vec3f,
}

fn studio_camera(uv: vec2f, resolution: vec2f) -> StudioRay {
	let screen = (uv * 2.0 - 1.0) * resolution / min(resolution.x, resolution.y);
	let forward = normalize(STUDIO_CAMERA_TARGET - STUDIO_CAMERA_POSITION);
	let right = normalize(cross(forward, vec3f(0.0, 1.0, 0.0)));
	let up = cross(right, forward);
	return StudioRay(STUDIO_CAMERA_POSITION, normalize(forward * STUDIO_FOCAL_LENGTH + screen.x * right + screen.y * up));
}

fn studio_fresnel(f0: vec3f, cosine: f32) -> vec3f {
	return f0 + (vec3f(1.0) - f0) * pow(1.0 - clamp(cosine, 0.0, 1.0), 5.0);
}

// A roughness-filtered reflection of finite luminous rectangles. Unlike a
// highlight painted in screen space, this responds to position and normal.
fn studio_emitter(p: vec3f, direction: vec3f, roughness: f32, index: u32) -> f32 {
	let center = STUDIO_LIGHTS[index];
	let normal = normalize(vec3f(0.0, 0.18, 0.0) - center);
	let axis_x = normalize(cross(vec3f(0.0, 1.0, 0.0), normal));
	let axis_y = cross(normal, axis_x);
	let denominator = dot(direction, normal);
	if (denominator >= -0.0001) { return 0.0; }
	let travel = dot(center - p, normal) / denominator;
	if (travel <= 0.0) { return 0.0; }
	let local = p + direction * travel - center;
	let uv = vec2f(dot(local, axis_x), dot(local, axis_y));
	let size = STUDIO_LIGHT_SIZE[index];
	let blur = 0.025 + roughness * roughness * travel * 2.5;
	let coverage = (1.0 - smoothstep(size.x - blur, size.x + blur, abs(uv.x)))
		* (1.0 - smoothstep(size.y - blur, size.y + blur, abs(uv.y)));
	// Preserve the approximate integrated power as the lobe broadens.
	return coverage * (size.x * size.y) / ((size.x + blur * 0.35) * (size.y + blur * 0.35));
}

fn studio_environment(p: vec3f, direction: vec3f, roughness: f32) -> vec3f {
	let hemisphere = smoothstep(-0.1, 0.65, direction.y);
	var radiance = mix(vec3f(0.22, 0.24, 0.28), vec3f(0.58, 0.63, 0.72), hemisphere);
	for (var i = 0u; i < 3u; i++) {
		radiance += STUDIO_RADIANCE[i] * studio_emitter(p, direction, roughness, i);
	}
	return radiance;
}

fn studio_irradiance(p: vec3f, n: vec3f, visibility: vec3f) -> vec3f {
	var irradiance = vec3f(0.55, 0.59, 0.67) * (0.65 + 0.35 * n.y);
	for (var i = 0u; i < 3u; i++) {
		let delta = STUDIO_LIGHTS[i] - p;
		let distance_squared = dot(delta, delta);
		let direction = delta * inverseSqrt(distance_squared);
		let area = STUDIO_LIGHT_SIZE[i].x * STUDIO_LIGHT_SIZE[i].y * 4.0;
		let emitter_cosine = max(dot(-direction, normalize(-STUDIO_LIGHTS[i])), 0.0);
		irradiance += STUDIO_RADIANCE[i] * max(dot(n, direction), 0.0) * emitter_cosine * area / distance_squared * visibility[i];
	}
	return irradiance;
}

fn studio_surface(p: vec3f, n: vec3f, view: vec3f, base_color: vec3f, metalness: f32, roughness: f32, visibility: vec3f, occlusion: f32) -> vec3f {
	let f0 = mix(vec3f(0.045), base_color, metalness);
	let fresnel = studio_fresnel(f0, dot(n, view));
	let diffuse = base_color * (1.0 - metalness) * (1.0 - fresnel) / STUDIO_PI;
	let reflection = reflect(-view, n);
	let reflected = studio_environment(p, reflection, roughness);
	return (diffuse * studio_irradiance(p, n, visibility) + reflected * fresnel * (1.0 - 0.35 * roughness)) * occlusion;
}

fn studio_floor(p: vec3f, view: vec3f, visibility: vec3f, contact: f32) -> vec3f {
	// A quiet satin floor. No animated noise, grid, horizon line or vignette.
	let normal = vec3f(0.0, 1.0, 0.0);
	let color = vec3f(0.027, 0.030, 0.035);
	let diffuse = color * studio_irradiance(p, normal, visibility) / STUDIO_PI;
	// The rough charcoal floor reflects a broad, weak lobe. A polished grazing
	// reflection here would lift the whole backdrop to grey as the fill rises.
	let reflection = studio_environment(p, reflect(-view, normal), 0.72);
	let specular = reflection * studio_fresnel(vec3f(0.025), dot(normal, view)) * 0.14;
	return (diffuse + specular) * contact;
}

fn studio_background(direction: vec3f) -> vec3f {
	return mix(vec3f(0.018, 0.022, 0.029), vec3f(0.032, 0.041, 0.056), smoothstep(-0.1, 0.5, direction.y));
}
