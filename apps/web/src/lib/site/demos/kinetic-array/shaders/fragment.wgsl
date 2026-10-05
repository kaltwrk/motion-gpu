#include <studio>
#include <kineticGeometry>
#include <kineticLighting>

struct Hit {
	t: f32,
	normal: vec3f,
	material: u32,
	pin: u32,
}

fn miss() -> Hit {
	return Hit(100., vec3f(0., 1., 0.), 0u, 0u);
}

fn closer(a: Hit, b: Hit) -> Hit {
	if (b.t < a.t) { return b; }
	return a;
}

fn base_normal(p: vec3f) -> vec3f {
	let e = .0002;
	let a = vec3f(1., -1., -1.);
	let b = vec3f(-1., -1., 1.);
	let c = vec3f(-1., 1., -1.);
	let d = vec3f(1., 1., 1.);
	return normalize(a * base_field(p + a * e).x + b * base_field(p + b * e).x + c * base_field(p + c * e).x + d * base_field(p + d * e).x);
}

fn box_interval(ro: vec3f, rd: vec3f, low: vec3f, high: vec3f) -> vec2f {
	let safe = select(vec3f(.000001), rd, abs(rd) > vec3f(.000001));
	let a = (low - ro) / safe;
	let b = (high - ro) / safe;
	let near = min(a, b);
	let far = max(a, b);
	return vec2f(max(near.x, max(near.y, near.z)), min(far.x, min(far.y, far.z)));
}

fn trace_base(ro: vec3f, rd: vec3f) -> Hit {
	let range = box_interval(ro, rd, vec3f(-1.37, 0., -1.09), vec3f(1.37, .299, 1.09));
	var t = max(range.x, 0.);
	for (var i = 0u; i < 80u; i++) {
		if (t > range.y) { break; }
		let p = ro + rd * t;
		let field = base_field(p);
		if (field.x < .00015) { return Hit(t, base_normal(p), u32(field.y), 0u); }
		t += max(field.x * .9, .0001);
	}
	return miss();
}

fn cylinder_hit(ro: vec3f, rd: vec3f, radius: f32, inner: f32, bottom: f32, top: f32, kind: u32, index: u32) -> Hit {
	var hit = miss();
	let a = dot(rd.xz, rd.xz);
	let b = dot(ro.xz, rd.xz);
	for (var wall = 0u; wall < 2u; wall++) {
		if (wall == 1u && inner == 0.) { break; }
		let r = select(radius, inner, wall == 1u);
		let h = b * b - a * (dot(ro.xz, ro.xz) - r * r);
		if (h >= 0. && a > .000001) {
			let roots = vec2f(-b - sqrt(h), -b + sqrt(h)) / a;
			for (var i = 0u; i < 2u; i++) {
				let t = roots[i];
				let p = ro + rd * t;
				if (t > 0. && t < hit.t && p.y >= bottom && p.y <= top) {
					hit = Hit(t, normalize(vec3f(p.x, 0., p.z)) * select(1., -1., wall == 1u), kind, index);
				}
			}
		}
	}
	if (abs(rd.y) > .000001) {
		for (var i = 0u; i < 2u; i++) {
			let y = select(bottom, top, i == 1u);
			let t = (y - ro.y) / rd.y;
			let p = ro + rd * t;
			let r2 = dot(p.xz, p.xz);
			if (t > 0. && t < hit.t && r2 <= radius * radius && r2 >= inner * inner) {
				hit = Hit(t, vec3f(0., select(-1., 1., i == 1u), 0.), kind, index);
			}
		}
	}
	return hit;
}

fn bevel_hit(ro: vec3f, rd: vec3f, bottom_radius: f32, top_radius: f32, bottom: f32, top: f32, index: u32) -> Hit {
	var hit = miss();
	let slope = (top_radius - bottom_radius) / (top - bottom);
	let origin_radius = bottom_radius + slope * (ro.y - bottom);
	let a = dot(rd.xz, rd.xz) - slope * slope * rd.y * rd.y;
	let b = dot(ro.xz, rd.xz) - origin_radius * slope * rd.y;
	let c = dot(ro.xz, ro.xz) - origin_radius * origin_radius;
	let h = b * b - a * c;
	if (h >= 0. && abs(a) > .000001) {
		let roots = vec2f(-b - sqrt(h), -b + sqrt(h)) / a;
		for (var i = 0u; i < 2u; i++) {
			let t = roots[i];
			let p = ro + rd * t;
			if (t > 0. && t < hit.t && p.y >= bottom && p.y <= top) {
				let radius = bottom_radius + slope * (p.y - bottom);
				hit = Hit(t, normalize(vec3f(p.x, -slope * radius, p.z)), 6u, index);
			}
		}
	}
	let t = (top - ro.y) / rd.y;
	if (t > 0. && t < hit.t && dot((ro + rd * t).xz, (ro + rd * t).xz) < top_radius * top_radius) {
		hit = Hit(t, vec3f(0., 1., 0.), 5u, index);
	}
	return hit;
}

fn intersect_pin(ro: vec3f, rd: vec3f, cell: vec2i) -> Hit {
	let center = pin_center(cell);
	let origin = ro - vec3f(center.x, 0., center.y);
	let index = pin_index(cell);
	let height = pin_height(index);
	let length = max(height - .029 - .310, .001);
	let first = .310 + length * .34;
	let second = .310 + length * .67;
	var hit = cylinder_hit(origin, rd, .0615, 0., height - .026, height - .004, 5u, index);
	hit = closer(hit, bevel_hit(origin, rd, .0615, .0575, height - .004, height, index));
	hit = closer(hit, bevel_hit(origin, rd, .0585, .0615, height - .029, height - .026, index));
	hit = closer(hit, cylinder_hit(origin, rd, .028, 0., .294, first, 7u, index));
	hit = closer(hit, cylinder_hit(origin, rd, .023, 0., first - .006, second, 7u, index));
	hit = closer(hit, cylinder_hit(origin, rd, .019, 0., second - .006, height - .025, 7u, index));
	hit = closer(hit, cylinder_hit(origin, rd, .040, .029, .294, .313, 8u, index));
	return hit;
}

// Traverse only the cells crossed by the ray. Every pin is intersected
// analytically, so different heights never introduce sphere-tracing stripes.
fn trace_array(ro: vec3f, rd: vec3f, opaque: Hit) -> Hit {
	let half_grid = vec2f(f32(GRID_COLUMNS), f32(GRID_ROWS)) * GRID_PITCH * .5;
	let range = box_interval(ro, rd, vec3f(-half_grid.x, .293, -half_grid.y), vec3f(half_grid.x, PIN_REST_HEIGHT + MAX_DISPLACEMENT + .001, half_grid.y));
	var t = max(range.x, 0.);
	let end = min(range.y, opaque.t);
	if (t > end) { return opaque; }
	let position = ro + rd * (t + .00001);
	var cell = vec2i(floor((position.xz + half_grid) / GRID_PITCH));
	cell = clamp(cell, vec2i(0), vec2i(i32(GRID_COLUMNS) - 1, i32(GRID_ROWS) - 1));
	let direction = vec2i(select(-1, 1, rd.x > 0.), select(-1, 1, rd.z > 0.));
	let safe = select(vec2f(.000001), rd.xz, abs(rd.xz) > vec2f(.000001));
	for (var step = 0u; step < GRID_COLUMNS + GRID_ROWS + 2u; step++) {
		if (t > end || any(cell < vec2i(0)) || cell.x >= i32(GRID_COLUMNS) || cell.y >= i32(GRID_ROWS)) { break; }
		let edge = (vec2f(cell) + select(vec2f(0.), vec2f(1.), direction > vec2i(0))) * GRID_PITCH - half_grid;
		let crossing = (edge - ro.xz) / safe;
		let next = min(crossing.x, crossing.y);
		let hit = intersect_pin(ro, rd, cell);
		if (hit.t >= t - .00005 && hit.t <= min(next + .00005, end)) { return hit; }
		if (crossing.x < crossing.y) { cell.x += direction.x; } else { cell.y += direction.y; }
		t = next;
	}
	return opaque;
}

fn hash(p: vec3f) -> f32 {
	return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}

fn contact_occlusion(p: vec3f, n: vec3f) -> f32 {
	let a = max(.015 - kinetic_field(p + n * .015), 0.) / .015;
	let b = max(.045 - kinetic_field(p + n * .045), 0.) / .045;
	let c = max(.11 - kinetic_field(p + n * .11), 0.) / .11;
	return clamp(1. - (a * .35 + b * .38 + c * .27) * .72, .28, 1.);
}

fn smith_lambda(v: vec3f, n: vec3f, radial: vec3f, tangent: vec3f) -> f32 {
	let nv = max(dot(n, v), .001);
	let slope = vec2f(dot(v, radial) * .32, dot(v, tangent) * .085) / nv;
	return (sqrt(1. + dot(slope, slope)) - 1.) * .5;
}

// Lathe tooling leaves a directional reflection even when individual grooves
// fall below a pixel. Integrate that anisotropic lobe over the shared softboxes.
fn turned_steel(p: vec3f, n: vec3f, view: vec3f, radial: vec3f, color: vec3f, visibility: vec3f) -> vec3f {
	let tangent = normalize(cross(n, radial));
	let nv = max(dot(n, view), .001);
	let view_lambda = smith_lambda(view, n, radial, tangent);
	var radiance = vec3f(0.);
	for (var light = 0u; light < 3u; light++) {
		let center = STUDIO_LIGHTS[light];
		let emitter_normal = normalize(vec3f(0., .18, 0.) - center);
		let axis_x = normalize(cross(vec3f(0., 1., 0.), emitter_normal));
		let axis_y = cross(emitter_normal, axis_x);
		let size = STUDIO_LIGHT_SIZE[light];
		for (var sample = 0u; sample < 4u; sample++) {
			let offset = vec2f(select(-.57735, .57735, (sample & 1u) == 1u), select(-.57735, .57735, (sample & 2u) == 2u));
			let delta = center + axis_x * size.x * offset.x + axis_y * size.y * offset.y - p;
			let l = normalize(delta);
			let nl = max(dot(n, l), 0.);
			let h = normalize(l + view);
			let stretched = vec3f(dot(h, radial) / .32, dot(h, tangent) / .085, max(dot(n, h), .001));
			let distribution = 1. / (STUDIO_PI * .32 * .085 * pow(dot(stretched, stretched), 2.));
			let masking = 1. / (1. + view_lambda + smith_lambda(l, n, radial, tangent));
			let specular = studio_fresnel(color, dot(view, h)) * distribution * masking / (4. * nv * max(nl, .001));
			let irradiance = STUDIO_RADIANCE[light] * max(dot(-l, emitter_normal), 0.) * (size.x * size.y) / dot(delta, delta);
			radiance += specular * irradiance * nl * visibility[light];
		}
	}
	return radiance;
}

fn shade(p: vec3f, rd: vec3f, hit: Hit) -> vec3f {
	let n = hit.normal;
	var shading_normal = n;
	var base = vec3f(.035, .041, .047);
	var metal = .78;
	var roughness = .39;
	let footprint = 2. * hit.t / (STUDIO_FOCAL_LENGTH * min(spektralFrame.resolution.x, spektralFrame.resolution.y));
	if (hit.material == 1u) {
		// Fine bead-blasting under the dark anodized finish, below pixel scale.
		let variation = hash(floor(p * 750.));
		base *= .94 + variation * .12;
		roughness = .40 + variation * .035;
	} else if (hit.material == 2u) {
		base = vec3f(.050, .059, .066);
		metal = .88;
		roughness = .35;
	} else if (hit.material == 3u) {
		base = vec3f(.008, .009, .010);
		metal = 0.;
		roughness = .65;
	} else if (hit.material == 4u) {
		base = vec3f(.12, .13, .14);
		metal = .96;
		roughness = .31;
	} else {
		let cell = vec2i(i32(hit.pin % GRID_COLUMNS), i32(hit.pin / GRID_COLUMNS));
		let center = pin_center(cell);
		let q = p.xz - center;
		let r = length(q);
		base = vec3f(.40, .435, .46);
		metal = 1.;
		roughness = .29;
		if (hit.material == 5u && n.y > .9) {
			let grain_filter = exp(-pow(footprint * 1250., 2.));
			let rings = sin(r * 1850. + f32(hit.pin % 7u) * .12);
			let radial = q / max(r, .0001);
			shading_normal = normalize(n + vec3f(radial.x, 0., radial.y) * rings * .012 * grain_filter);
			roughness += rings * .013 * grain_filter;
		} else if (hit.material == 6u) {
			base = vec3f(.56, .59, .62);
			roughness = .15;
		} else if (hit.material == 7u) {
			base = vec3f(.23, .255, .275);
			roughness = .26;
		} else if (hit.material == 8u) {
			base = vec3f(.065, .073, .080);
			roughness = .38;
		} else {
			base = vec3f(.27, .29, .31);
			roughness = .28;
		}
	}
	let wp = p * KINETIC_SCALE;
	let visibility = kinetic_visibility(p, n, hit.material, hit.pin);
	let ao = contact_occlusion(p, n);
	let fresnel = studio_fresnel(mix(vec3f(.045), base, metal), dot(shading_normal, -rd));
	let reflected = reflect(rd, shading_normal);
	var environment = studio_environment(wp, reflected, roughness);
	// Metal has almost no diffuse term. Visibility must also mask the reflected
	// softboxes, otherwise raised pins cannot shadow their polished neighbours.
	for (var i = 0u; i < 3u; i++) {
		environment -= STUDIO_RADIANCE[i] * studio_emitter(wp, reflected, roughness, i) * (1. - visibility[i]);
	}
	let diffuse = base * (1. - metal) * (1. - fresnel) / STUDIO_PI;
	var radiance = diffuse * studio_irradiance(wp, shading_normal, visibility) + max(environment, vec3f(0.)) * fresnel * (1. - .35 * roughness);
	if (hit.material == 5u && n.y > .9) {
		let center = pin_center(vec2i(i32(hit.pin % GRID_COLUMNS), i32(hit.pin / GRID_COLUMNS)));
		let q = p.xz - center;
		let radial = normalize(vec3f(q.x + .000001, 0., q.y));
		// Replace the isotropic emitter reflection, retaining the room bounce.
		var room = studio_environment(wp, reflected, roughness);
		for (var i = 0u; i < 3u; i++) {
			room -= STUDIO_RADIANCE[i] * studio_emitter(wp, reflected, roughness, i);
		}
		radiance = max(room, vec3f(0.)) * fresnel * .65 + turned_steel(wp, n, -rd, radial, base, visibility);
	}
	return radiance * ao;
}

fn render_array(uv: vec2f) -> vec3f {
	let ray = studio_camera(uv, spektralFrame.resolution);
	let origin = ray.origin / KINETIC_SCALE;
	let hit = trace_array(origin, ray.direction, trace_base(origin, ray.direction));
	if (hit.material > 0u) {
		return shade(origin + ray.direction * hit.t, ray.direction, hit);
	}
	let floor_t = -ray.origin.y / ray.direction.y;
	if (floor_t > 0.) {
		let p = ray.origin + ray.direction * floor_t;
		let clearance = max(base_field(p / KINETIC_SCALE).x * KINETIC_SCALE, 0.);
		return studio_floor(p, -ray.direction, floor_visibility(uv), 1. - .44 * exp(-clearance / .030));
	}
	return studio_background(ray.direction);
}

fn frag(uv: vec2f) -> vec4f {
	let offset = vec2f(.25) / spektralFrame.resolution;
	return vec4f((render_array(uv - offset) + render_array(uv + offset)) * .5, 1.);
}
