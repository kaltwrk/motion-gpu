const BASE_TINT: vec3f = vec3f(0.8, 0.8, 0.9);
const DISPERSION: vec3f = vec3f(2.451, 2.451, 2.451);
const LIGHT_VECTOR: vec3f = vec3f(0.57735026, 0.57735026, -0.57735026);
const SECTOR: f32 = PI / 12.0;

struct RayHit {
	position: vec3f,
	distance: f32,
	travel: f32,
}

fn wrap_angle(angle: f32, period: f32) -> f32 {
	return angle - period * floor((angle + 0.5 * period) / period);
}

fn rotate_x(p: vec3f, angle: f32) -> vec3f {
	let c = cos(angle);
	let s = sin(angle);
	return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

fn rotate_y(p: vec3f, angle: f32) -> vec3f {
	let c = cos(angle);
	let s = sin(angle);
	return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn fold_ring(p: vec3f, phase: f32) -> vec3f {
	let radius = length(p.xz);
	let azimuth = atan2(p.x, p.z) - phase;
	let local = wrap_angle(azimuth, SECTOR);
	return vec3f(radius * sin(local), p.y, radius * cos(local));
}

fn orient_gem(p: vec3f) -> vec3f {
	let orbit = spektralUniforms.uOrbit;
	let pitch = orbit.y;
	let yaw = orbit.x;
	return rotate_y(rotate_x(p, pitch), yaw);
}

fn gem_distance(p_world: vec3f) -> f32 {
	let p = orient_gem(p_world);

	let top_a = normalize(vec3f(0.0, 1.0, 1.4));
	let top_b = normalize(vec3f(0.0, 1.0, 1.0));
	let top_c = normalize(vec3f(0.0, 1.0, 0.5));
	let bottom_a = normalize(vec3f(0.0, -1.0, 1.0));
	let bottom_b = normalize(vec3f(0.0, -1.0, 1.6));

	let primary = fold_ring(p, SECTOR * 0.5);
	let secondary = fold_ring(p, 0.0);

	var d = p.y - 1.0;
	d = max(d, dot(primary, top_a) - 2.0);
	d = max(d, dot(primary, top_c) - 1.5);
	d = max(d, dot(primary, bottom_a) - 1.7);
	d = max(d, dot(secondary, top_b) - 1.85);
	d = max(d, dot(secondary, bottom_b) - 1.9);
	return d;
}

fn gem_normal(p: vec3f) -> vec3f {
	let e = EPSILON;
	let dx = gem_distance(p + vec3f(e, 0.0, 0.0)) - gem_distance(p - vec3f(e, 0.0, 0.0));
	let dy = gem_distance(p + vec3f(0.0, e, 0.0)) - gem_distance(p - vec3f(0.0, e, 0.0));
	let dz = gem_distance(p + vec3f(0.0, 0.0, e)) - gem_distance(p - vec3f(0.0, 0.0, e));
	return normalize(vec3f(dx, dy, dz));
}

fn sky_color(rd: vec3f) -> vec3f {
	let up = clamp(0.5 + 0.5 * rd.y, 0.0, 1.0);
	let horizon = exp(-9.0 * abs(rd.y));
	let high = mix(vec3f(0.03, 0.0, 0.0), vec3f(0.11, 0.11, 0.11), pow(up, 20.3));
	let low = mix(
		vec3f(0.08, 0.1, 0.15),
		vec3f(0.14, 0.1, 0.18),
		0.5 + 0.5 * sin(rd.x * 4.3 + rd.z * 3.1)
	);
	return vec3f(0.02, 0.026, 0.036) + mix(high, low, horizon * 7.0);
}

fn march(origin: vec3f, direction: vec3f, side: f32, start_travel: f32) -> RayHit {
	var travel = start_travel;
	var position = origin;
	var distance = MAX_DISTANCE;

	for (var i = 0; i < MAX_STEPS; i = i + 1) {
		distance = side * gem_distance(position);
		let step_size = max(distance, EPSILON);
		travel += step_size;

		if (distance < 0.0 || travel > MAX_DISTANCE) {
			break;
		}

		position += direction * step_size;
	}

	return RayHit(position, distance, travel);
}

fn sparkle(n: vec3f, rd: vec3f) -> f32 {
	let reflected = reflect(rd, n);
	let highlight = max(dot(reflected, LIGHT_VECTOR), 0.0);
	return pow(highlight, SPECULAR_SHARPNESS) * SPECULAR_GAIN;
}

fn refract_channel(
	surface_position: vec3f,
	incoming_ray: vec3f,
	surface_normal: vec3f,
	base_value: f32,
	channel_mask: vec3f,
	travel_seed: f32
) -> f32 {
	var position = surface_position;
	var ray = incoming_ray;
	var normal = surface_normal;
	var side = 1.0;
	var travel = travel_seed;
	var result = base_value * (1.0 - GEM_ALPHA);
	var throughput = GEM_ALPHA;
	let ior = dot(DISPERSION, channel_mask);

	for (var bounce = 1; bounce < MAX_BOUNCES; bounce = bounce + 1) {
		let eta = select(ior, 1.0 / ior, side > 0.0);
		let transmitted = refract(ray, normal, eta);
		let has_refraction = dot(transmitted, transmitted) > EPSILON;

		if (has_refraction) {
			ray = transmitted;
			side = -side;
		} else {
			ray = reflect(ray, normal);
			position += ray * EPSILON * 2.0;
		}

		let hit = march(position, ray, side, travel);
		position = hit.position;
		travel = hit.travel;

		if (hit.distance >= 0.0) {
			break;
		}

		normal = side * gem_normal(position);

		if (side > 0.0) {
			let diffuse = max(0.0, dot(normal, LIGHT_VECTOR));
			let local = (AMBIENT_LIGHT + diffuse) * dot(BASE_TINT, channel_mask) + sparkle(normal, ray);
			result += local * (1.0 - GEM_ALPHA) * throughput;
			throughput *= GEM_ALPHA;
		}
	}

	return result + dot(sky_color(ray), channel_mask) * throughput;
}

fn camera_basis(eye: vec3f, look_at: vec3f) -> mat3x3f {
	let forward = normalize(look_at - eye);
	let right = normalize(cross(vec3f(0.0, 1.0, 0.0), forward));
	let up = cross(forward, right);
	return mat3x3f(right, up, forward);
}

fn frag(uv: vec2f) -> vec4f {
	let resolution = spektralFrame.resolution;
	let screen = (2.0 * uv * resolution - resolution) / resolution.y;
	let ray_camera = normalize(vec3f(screen, 2.0));

	let eye = vec3f(8.0, 2.5, 8.0);
	let ray_world = camera_basis(eye, vec3f(0.0)) * ray_camera;

	let front_hit = march(eye, ray_world, 1.0, 0.0);
	if (front_hit.distance >= 0.0) {
		return vec4f(vec3f(0.02, 0.026, 0.036), 1.0);
	}

	let normal = gem_normal(front_hit.position);
	let diffuse = max(0.0, dot(normal, LIGHT_VECTOR));
	let specular = sparkle(normal, ray_world);
	var color = (AMBIENT_LIGHT + diffuse) * BASE_TINT + specular;

	color.r = refract_channel(front_hit.position, ray_world, normal, color.r, vec3f(1.0, 0.0, 0.0), front_hit.travel);
	color.g = refract_channel(front_hit.position, ray_world, normal, color.g, vec3f(0.0, 1.0, 0.0), front_hit.travel);
	color.b = refract_channel(front_hit.position, ray_world, normal, color.b, vec3f(0.0, 0.0, 1.0), front_hit.travel);

	let rim = pow(1.0 - max(dot(normal, -ray_world), 0.0), max(0.001, spektralUniforms.uEdgePower)) * spektralUniforms.uEdgeGain;
	color += spektralUniforms.uEdgeColor * rim;

	return vec4f(max(color, vec3f(0.0)), 1.0);
}
