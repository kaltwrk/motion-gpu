#include <studio>

const SCREEN_CENTER = vec2f(0.0, 1.055);
const SCREEN_HALF = vec2f(0.77, 0.555);

fn rotate_y(p: vec3f, angle: f32) -> vec3f {
	let c = cos(angle);
	let s = sin(angle);
	return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn monitor_angle() -> f32 { return 0.28 + spektralUniforms.uInspect.x * 0.10; }
fn local_position(p: vec3f) -> vec3f { return rotate_y(p, -monitor_angle()); }
fn world_direction(p: vec3f) -> vec3f { return rotate_y(p, monitor_angle()); }

fn rounded_box(p: vec3f, half_size: vec3f, radius: f32) -> f32 {
	let q = abs(p) - half_size + radius;
	return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - radius;
}

fn rounded_rectangle(p: vec2f, half_size: vec2f, radius: f32) -> f32 {
	let q = abs(p) - half_size + radius;
	return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

fn cylinder_z(p: vec3f, radius: f32, half_depth: f32) -> f32 {
	let q = vec2f(length(p.xy) - radius, abs(p.z) - half_depth);
	return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0)));
}

fn cylinder_y(p: vec3f, radius: f32, half_height: f32) -> f32 {
	let q = vec2f(length(p.xz) - radius, abs(p.y) - half_height);
	return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0)));
}

fn glass_front(p: vec2f) -> f32 {
	let q = (p - SCREEN_CENTER) / SCREEN_HALF;
	return 0.475 - 0.035 * dot(q, q);
}

fn glass_distance(p: vec3f) -> f32 {
	let footprint = rounded_rectangle(p.xy - SCREEN_CENTER, SCREEN_HALF, 0.075);
	return max(footprint, max((p.z - glass_front(p.xy)) * 0.93, 0.37 - p.z));
}

fn chassis_distance(p: vec3f) -> f32 {
	return rounded_box(p - vec3f(0.0, 0.990, -0.39), vec3f(0.985, 0.825, 0.91), 0.032);
}

fn feet_distance(p: vec3f) -> f32 {
	let q = vec3f(abs(p.x) - 0.74, p.y - 0.090, abs(p.z + 0.37) - 0.66);
	return cylinder_y(q, 0.090, 0.087) - 0.003;
}

fn bezel_distance(p: vec3f) -> f32 {
	let block = rounded_box(p - vec3f(0.0, 0.990, 0.505), vec3f(0.998, 0.833, 0.104), 0.043);
	let taper = clamp((p.z - 0.39) / 0.22, 0.0, 1.0);
	let aperture = rounded_rectangle(p.xy - SCREEN_CENTER, SCREEN_HALF + vec2f(0.012 + taper * 0.046), 0.080);
	var distance = max(block, -aperture);
	let screw = vec3f(abs(p.x) - 0.918, abs(p.y - 0.990) - 0.743, p.z - 0.609);
	distance = max(distance, -cylinder_z(screw, 0.027, 0.014));
	let knob_x = select(0.495, 0.735, p.x > 0.615);
	let socket = cylinder_z(p - vec3f(knob_x, 0.310, 0.610), 0.067, 0.023);
	return max(distance, -socket);
}

// The broad-body shadow excludes small grooves and screws. Its silhouette and
// the four feet are identical to the visible shell, keeping contact stable.
fn studio_occluder_distance(p: vec3f) -> f32 {
	let q = local_position(p);
	return min(min(chassis_distance(q), bezel_distance(q)), feet_distance(q));
}

// Material IDs: 1 powdercoat, 2 bezel, 3 glass, 4 rubber, 5 hardware,
// 6 encoder, 7 status lens. Recesses are actual geometry rather than black decals.
fn monitor_distance(p: vec3f) -> vec2f {
	var body = chassis_distance(p);
	let opening = max(rounded_rectangle(p.xy - SCREEN_CENTER, SCREEN_HALF + 0.070, 0.080), 0.285 - p.z);
	body = max(body, -opening);
	// Folded rear side panels have one recessed bank of ventilation slots.
	let row = clamp(round((p.y - 0.66) / 0.052), 0.0, 11.0);
	let vent = rounded_box(vec3f(abs(p.x) - 0.974, p.y - (0.66 + row * 0.052), p.z + 0.79), vec3f(0.032, 0.012, 0.265), 0.006);
	body = max(body, -vent);
	var result = vec2f(body, 1.0);
	let bezel = bezel_distance(p);
	if (bezel < result.x) { result = vec2f(bezel, 2.0); }
	let glass = glass_distance(p);
	if (glass < result.x) { result = vec2f(glass, 3.0); }
	let feet = feet_distance(p);
	if (feet < result.x) { result = vec2f(feet, 4.0); }
	// Four captive, countersunk faceplate screws.
	let screw_center = vec3f(abs(p.x) - 0.918, abs(p.y - 0.990) - 0.743, p.z - 0.600);
	var screw = cylinder_z(screw_center, 0.021, 0.004);
	let slot = max(abs(screw_center.x) - 0.0035, abs(screw_center.y) - 0.014);
	screw = max(screw, -max(slot, 0.600 - p.z));
	if (screw < result.x) { result = vec2f(screw, 5.0); }
	// Machined encoder wheels sit in dark recessed sockets in the lower fascia.
	let knob_index = select(0.0, 1.0, p.x > 0.615);
	let knob_center = vec3f(0.495 + knob_index * 0.24, 0.310, 0.630);
	let knob_p = p - knob_center;
	let angle = atan2(knob_p.y, knob_p.x);
	let flutes = cos(angle * 48.0) * 0.0011;
	let wheel = cylinder_z(knob_p, 0.056 + flutes, 0.043) - 0.002;
	let shaft = cylinder_z(p - vec3f(knob_center.xy, 0.562), 0.026, 0.06);
	let knob = min(wheel, shaft);
	if (knob < result.x) { result = vec2f(knob, 6.0); }
	let power = rounded_box(p - vec3f(-0.815, 0.303, 0.624), vec3f(0.039, 0.026, 0.018), 0.008);
	if (power < result.x) { result = vec2f(power, 4.0); }
	let lamp = cylinder_z(p - vec3f(-0.697, 0.302, 0.612), 0.009, 0.006);
	if (lamp < result.x) { result = vec2f(lamp, 7.0); }
	return result;
}

struct MonitorHit { travel: f32, material: f32 }

fn trace_monitor(ro: vec3f, rd: vec3f) -> MonitorHit {
	let a = (vec3f(-1.01, 0.0, -1.32) - ro) / rd;
	let b = (vec3f(1.01, 1.825, 0.69) - ro) / rd;
	let lo = min(a, b);
	let hi = max(a, b);
	var travel = max(0.0, max(lo.x, max(lo.y, lo.z)));
	let end = min(hi.x, min(hi.y, hi.z));
	if (travel > end) { return MonitorHit(100.0, 0.0); }
	for (var i = 0u; i < 140u; i++) {
		let result = monitor_distance(ro + rd * travel);
		if (result.x < 0.0003) { return MonitorHit(travel, result.y); }
		travel += max(result.x * 0.85, 0.0002);
		if (travel > end) { break; }
	}
	return MonitorHit(100.0, 0.0);
}

fn surface_normal(p: vec3f, material: f32) -> vec3f {
	if (material == 3.0) {
		let q = p.xy - SCREEN_CENTER;
		return normalize(vec3f(0.07 * q / (SCREEN_HALF * SCREEN_HALF), 1.0));
	}
	let e = 0.0004;
	let a = vec3f(1.0, -1.0, -1.0);
	let b = vec3f(-1.0, -1.0, 1.0);
	let c = vec3f(-1.0, 1.0, -1.0);
	let d = vec3f(1.0, 1.0, 1.0);
	return normalize(a * monitor_distance(p + a * e).x + b * monitor_distance(p + b * e).x
		+ c * monitor_distance(p + c * e).x + d * monitor_distance(p + d * e).x);
}

fn material_noise(p: vec3f) -> f32 {
	return fract(sin(dot(p, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
}

// Deflection and beam energy are independent: the frozen image collapses with
// the raster, then only the concentrated beam and its phosphor afterglow remain.
fn tube_emission(uv: vec2f, pixel_span: f32) -> vec3f {
	let raster = spektralUniforms.uRaster;
	let extent = max(raster.xy, vec2f(0.0005));
	let centered = uv - 0.5;
	let pixel = vec2f(pixel_span / 1.54, pixel_span / 1.11);
	var image_uv = centered / extent + 0.5;
	let boot = spektralUniforms.uBoot;
	// One damped settling movement, confined to the image inside the glass.
	image_uv.x += boot * 0.004 * sin(image_uv.y * 4.0 + (1.0 - boot) * 24.0);
	image_uv.y += boot * 0.003 * sin((1.0 - boot) * 18.0);
	let video_uv = vec2f(image_uv.x, 1.0 - image_uv.y);
	var video = textureSampleLevel(uVideo, uVideoSampler, video_uv, 0.0).rgb;
	if (boot > 0.001) {
		let convergence = vec2f(boot * 0.0011, 0.0);
		video.r = textureSampleLevel(uVideo, uVideoSampler, video_uv + convergence, 0.0).r;
		video.b = textureSampleLevel(uVideo, uVideoSampler, video_uv - convergence, 0.0).b;
	}
	let coverage = vec2f(1.0) - smoothstep(extent * 0.5 - pixel, extent * 0.5 + pixel, abs(centered));
	let scan_visibility = 1.0 - smoothstep(0.6, 1.5, pixel_span * 576.0 / 1.11);
	let scan = 1.0 - scan_visibility * 0.018 * (0.5 + 0.5 * cos(uv.y * 576.0 * 6.2831853));
	let image_light = video * 1.35 * scan * coverage.x * coverage.y * raster.z;
	// A subpixel electron beam is widened to its raster footprint, preventing
	// a vanishing/dotted line when the screen is seen at an oblique angle.
	let beam_width = max(extent.x * 0.50, pixel.x * 0.85);
	let line_height = max(0.0012, pixel.y * 0.65);
	let dot_height = max(line_height, extent.x * 0.50 * 1.54 / 1.11);
	let beam_height = mix(line_height, dot_height, 1.0 - smoothstep(0.014, 0.055, extent.x));
	let line_end = exp(-pow(abs(centered.x) / beam_width, 6.0));
	let line_core = line_end * exp(-0.5 * pow(centered.y / beam_height, 2.0));
	let halo_x = exp(-pow(abs(centered.x) / max(extent.x * 0.53, 0.012), 4.0));
	let halo_y = exp(-0.5 * pow(centered.y / 0.008, 2.0));
	let concentrated = 1.0 - smoothstep(0.012, 0.10, extent.y);
	let beam = (vec3f(5.5, 5.9, 6.2) * line_core + vec3f(0.12, 0.18, 0.22) * halo_x * halo_y)
		* raster.w * concentrated;
	return (image_light + beam) * spektralUniforms.uReady;
}

fn screen_color(p: vec3f, n: vec3f, view: vec3f, travel: f32) -> vec3f {
	// The luminous phosphor lies behind the curved glass, so off-axis viewing
	// shifts the image inside its physical aperture without shifting reflections.
	let refracted = refract(-view, n, 1.0 / 1.52);
	let phosphor = p + refracted * (0.014 / max(-refracted.z, 0.2));
	let screen_uv = (phosphor.xy - SCREEN_CENTER) / (SCREEN_HALF * 2.0) + 0.5;
	let edge = rounded_rectangle(phosphor.xy - SCREEN_CENTER, SCREEN_HALF - 0.011, 0.073);
	let image_mask = 1.0 - smoothstep(-0.004, 0.0, edge);
	let pixel_span = 2.0 * travel / (STUDIO_FOCAL_LENGTH * min(spektralFrame.resolution.x, spektralFrame.resolution.y));
	let phosphor_light = tube_emission(screen_uv, pixel_span) * image_mask;
	let world_p = world_direction(p);
	let world_n = world_direction(n);
	let world_view = world_direction(view);
	let reflection = studio_environment(world_p, reflect(-world_view, world_n), 0.045);
	// An anti-reflective coating keeps the laboratory image readable while the
	// Fresnel response still exposes the thickness and curvature of the glass.
	let fresnel = studio_fresnel(vec3f(0.026), dot(n, view));
	let ambient = vec3f(0.003, 0.0045, 0.0044);
	return phosphor_light * (1.0 - fresnel) + reflection * fresnel * 0.75 + ambient;
}

fn shade_monitor(p: vec3f, n: vec3f, view: vec3f, material: f32, travel: f32) -> vec3f {
	if (material == 3.0) { return screen_color(p, n, view, travel); }
	let world_p = world_direction(p);
	let world_n = world_direction(n);
	let world_view = world_direction(view);
	let visibility = studio_visibility(world_p, world_n);
	var base = vec3f(0.062, 0.068, 0.074);
	var metalness = 0.0;
	var roughness = 0.48;
	var occlusion = 1.0;
	let grain = material_noise(floor(p * 1500.0));
	if (material == 1.0) {
		base *= 0.97 + 0.06 * grain;
		roughness += (grain - 0.5) * 0.025;
		let footprint = 2.0 * travel / (STUDIO_FOCAL_LENGTH * min(spektralFrame.resolution.x, spektralFrame.resolution.y));
		let seam = 1.0 - smoothstep(0.004 - footprint, 0.004 + footprint, abs(p.z - 0.285));
		base = mix(base, vec3f(0.010, 0.012, 0.014), seam);
		// The dark backing behind real vent cuts absorbs light in their cavity.
		if (abs(p.x) > 0.941 && abs(p.x) < 0.966 && p.z < -0.40 && p.y < 1.28) { base *= 0.23; occlusion *= 0.65; }
	} else if (material == 2.0) {
		base = vec3f(0.024, 0.027, 0.030);
		roughness = 0.34;
		let aperture = rounded_rectangle(p.xy - SCREEN_CENTER, SCREEN_HALF + 0.040, 0.08);
		occlusion = 0.52 + 0.48 * smoothstep(-0.008, 0.065, aperture);
		// Screen light is reflected softly into the inner lip, with its color
		// derived from the same video frame rather than a fixed orange accent.
	} else if (material == 4.0) {
		base = vec3f(0.011, 0.012, 0.013);
		roughness = 0.70;
	} else if (material == 5.0) {
		base = vec3f(0.16, 0.18, 0.20);
		metalness = 0.88;
		roughness = 0.29;
	} else if (material == 6.0) {
		base = vec3f(0.028, 0.031, 0.034);
		metalness = 0.35;
		roughness = 0.31;
		let knob_x = select(0.495, 0.735, p.x > 0.615);
		let line = 1.0 - smoothstep(0.0015, 0.0025, abs(p.x - knob_x));
		let tick = line * smoothstep(0.341, 0.345, p.y) * (1.0 - smoothstep(0.355, 0.359, p.y));
		base = mix(base, vec3f(0.55), tick * smoothstep(0.669, 0.674, p.z));
	} else if (material == 7.0) {
		return mix(vec3f(0.0015, 0.004, 0.002), vec3f(0.018, 0.20, 0.05), spektralUniforms.uPower);
	}
	if (material == 2.0 && n.z > 0.97 && p.z > 0.596) {
		let label_uv = vec2f((p.x + 1.025) / 2.05, 1.0 - (p.y - 0.12) / 1.66);
		let label = textureSampleLevel(uLabels, uLabelsSampler, label_uv, 0.0).r;
		base = mix(base, vec3f(0.42, 0.45, 0.47), label);
	}
	var color = studio_surface(world_p, world_n, world_view, base, metalness, roughness, visibility, occlusion);
	if (material == 2.0) {
		let video_uv = vec2f(p.x / 1.54 + 0.5, 1.0 - (p.y - 1.055) / 1.11 - 0.5);
		let aperture_distance = abs(rounded_rectangle(p.xy - SCREEN_CENTER, SCREEN_HALF, 0.075));
		let emission = textureSampleLevel(uVideo, uVideoSampler, clamp(video_uv, vec2f(0.02), vec2f(0.98)), 0.0).rgb;
		let image_energy = spektralUniforms.uRaster.z * spektralUniforms.uRaster.x * spektralUniforms.uRaster.y;
		color += emission * base * exp(-aperture_distance * 24.0) * 0.30 * spektralUniforms.uReady * image_energy;
	}
	return color;
}

fn render_signal(uv: vec2f) -> vec3f {
	let ray = studio_camera(uv, spektralFrame.resolution);
	let ro = local_position(ray.origin);
	let rd = local_position(ray.direction);
	let hit = trace_monitor(ro, rd);
	if (hit.material == 0.0) {
		let travel = -ray.origin.y / ray.direction.y;
		if (travel <= 0.0) { return studio_background(ray.direction); }
		let p = ray.origin + ray.direction * travel;
		let clearance = max(studio_occluder_distance(p), 0.0);
		let contact = 1.0 - 0.48 * exp(-clearance / 0.045);
		return studio_floor(p, -ray.direction, studio_visibility(p, vec3f(0.0, 1.0, 0.0)), contact);
	}
	let p = ro + rd * hit.travel;
	return shade_monitor(p, surface_normal(p, hit.material), -rd, hit.material, hit.travel);
}

fn frag(uv: vec2f) -> vec4f {
	let offset = vec2f(0.25) / spektralFrame.resolution;
	return vec4f(0.5 * (render_signal(uv - offset) + render_signal(uv + offset)), 1.0);
}
