// Every pin owns a 16 x 32 tile. The first 12 rows hold its planar face;
// the remaining rows hold separate cylindrical and conical surface charts.
const PIN_CHART_ROWS = array<u32, 7>(2u, 2u, 2u, 4u, 4u, 4u, 2u);
const PIN_CHART_OFFSETS = array<u32, 7>(0u, 2u, 4u, 6u, 10u, 14u, 18u);

fn pin_lighting_tile(index: u32) -> vec2u {
	return vec2u(index % PIN_LIGHTING_COLUMNS, index / PIN_LIGHTING_COLUMNS)
		* vec2u(PIN_LIGHTING_TILE_WIDTH, PIN_LIGHTING_TILE_HEIGHT);
}

// Lower height, upper height, lower radius, upper radius. Hidden overlaps
// between telescoping sections are excluded from the visible side charts.
fn pin_lighting_chart(height: f32, chart: u32) -> vec4f {
	let length = max(height - .029 - .310, .001);
	let first = .310 + length * .34;
	let second = .310 + length * .67;
	switch chart {
		case 0u: { return vec4f(height - .026, height - .004, .0615, .0615); }
		case 1u: { return vec4f(height - .004, height, .0615, .0575); }
		case 2u: { return vec4f(height - .029, height - .026, .0585, .0615); }
		case 3u: { return vec4f(.313, first, .028, .028); }
		case 4u: { return vec4f(first, second, .023, .023); }
		case 5u: { return vec4f(second, height - .029, .019, .019); }
		default: { return vec4f(.294, .313, .040, .040); }
	}
}

fn floor_lighting_size(resolution: vec2f) -> vec2u {
	let capacity = f32(FLOOR_LIGHTING_CAPACITY);
	let scale = min(.5, min(min(capacity / resolution.x, capacity / resolution.y),
		sqrt(FLOOR_LIGHTING_BUDGET / (resolution.x * resolution.y))));
	return vec2u(max(vec2f(1.), floor(resolution * scale)));
}
