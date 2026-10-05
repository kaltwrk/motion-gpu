#include <kineticLightingLayout>

fn pin_lighting_bilinear(index: u32, offset: vec2u, size: vec2u, uv: vec2f, wrap_angle: bool) -> vec3f {
	let coordinate = uv * vec2f(size) - .5;
	let lower = vec2i(floor(coordinate));
	let blend = fract(coordinate);
	let last = vec2i(size) - 1;
	var x0 = clamp(lower.x, 0, last.x);
	var x1 = clamp(lower.x + 1, 0, last.x);
	if (wrap_angle) {
		let width = i32(size.x);
		x0 = ((lower.x % width) + width) % width;
		x1 = (((lower.x + 1) % width) + width) % width;
	}
	let y0 = clamp(lower.y, 0, last.y);
	let y1 = clamp(lower.y + 1, 0, last.y);
	let origin = vec2i(pin_lighting_tile(index) + offset);
	let a = textureLoad(uPinLighting, origin + vec2i(x0, y0), 0).rgb;
	let b = textureLoad(uPinLighting, origin + vec2i(x1, y0), 0).rgb;
	let c = textureLoad(uPinLighting, origin + vec2i(x0, y1), 0).rgb;
	let d = textureLoad(uPinLighting, origin + vec2i(x1, y1), 0).rgb;
	return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

fn kinetic_visibility(p: vec3f, normal: vec3f, material: u32, pin: u32) -> vec3f {
	if (material == 2u && normal.y > .999 && abs(p.y - DECK_LIGHTING_Y) < .0004) {
		let uv = p.xz / (2. * vec2f(DECK_LIGHTING_HALF_X, DECK_LIGHTING_HALF_Z)) + .5;
		return textureSampleLevel(uDeckLighting, uDeckLightingSampler, uv, 0.).rgb;
	}
	if (material >= 5u && material <= 8u) {
		let center = pin_center(vec2i(i32(pin % GRID_COLUMNS), i32(pin / GRID_COLUMNS)));
		let q = p.xz - center;
		if (material == 5u && normal.y > .99) {
			let uv = q / (2. * PIN_LIGHTING_TOP_RADIUS) + .5;
			return pin_lighting_bilinear(pin, vec2u(0u), vec2u(PIN_LIGHTING_TOP_SIZE), uv, false);
		}
		var chart = 7u;
		if (material == 5u && abs(normal.y) < .001) {
			chart = 0u;
		} else if (material == 6u) {
			chart = select(2u, 1u, normal.y > 0.);
		} else if (material == 7u && abs(normal.y) < .001) {
			let radius = length(q);
			chart = select(select(5u, 4u, radius > .021), 3u, radius > .0255);
		} else if (material == 8u && abs(normal.y) < .001 && dot(normal.xz, q) > 0.) {
			chart = 6u;
		}
		if (chart < 7u) {
			let bounds = pin_lighting_chart(pin_height(pin), chart);
			let angle = fract(atan2(q.y, q.x) / (2. * STUDIO_PI) + 1.);
			let height = (p.y - bounds.x) / max(bounds.y - bounds.x, .000001);
			let offset = vec2u(0u, PIN_LIGHTING_TOP_SIZE + PIN_CHART_OFFSETS[chart]);
			return pin_lighting_bilinear(pin, offset, vec2u(PIN_LIGHTING_TILE_WIDTH, PIN_CHART_ROWS[chart]), vec2f(angle, height), true);
		}
	}
	// Base, screws, guide interiors and horizontal telescoping shoulders retain
	// exact visibility. Their small surface area does not justify a coarser chart.
	return studio_visibility(p * KINETIC_SCALE, normal);
}

fn floor_visibility(uv: vec2f) -> vec3f {
	let size = vec2f(floor_lighting_size(spektralFrame.resolution));
	let half_texel = .5 / size;
	let coordinate = clamp(uv, half_texel, 1. - half_texel) * size / f32(FLOOR_LIGHTING_CAPACITY);
	return textureSampleLevel(uFloorLighting, uFloorLightingSampler, coordinate, 0.).rgb;
}
