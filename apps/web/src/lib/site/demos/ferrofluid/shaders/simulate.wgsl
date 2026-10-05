// Reduced ferrofluid surface model: magnetic pressure drives a damped heightfield.
// R: height, G: vertical velocity, B: magnetic field, A: initialized state.
// The previous height and its four neighbors are essential to every update.
// This is a surface-wave approximation, not a full magnetohydrodynamic solver.

fn surfaceState(pixel: vec2i, dimensions: vec2i) -> vec2f {
	let boundedPixel = clamp(pixel, vec2i(0), dimensions - vec2i(1));
	let state = textureLoad(previousState, boundedPixel, 0);
	return select(vec2f(0.0), state.rg, state.a > 0.5);
}

fn roundedSpike(offset: vec2f) -> f32 {
	// The small rounded tip avoids both a cusp and a cylindrical-looking cap.
	let radial = sqrt(dot(offset, offset) + 0.000049) - 0.007;
	return exp(-radial / 0.051) * (1.0 - smoothstep(0.16, 0.205, radial));
}

fn pressureLobe(offset: vec2f, center: vec2f) -> f32 {
	// A weak fixed field imperfection keeps the peaks from being identical.
	return roundedSpike(offset) * (1.0 + 0.055 * sin(dot(center, vec2f(15.8, 31.9))));
}

fn magneticPressure(position: vec2f, magnet: vec4f) -> vec2f {
	let spacing = 0.265;
	let rowHeight = spacing * 0.8660254;
	let latticeCell = vec2f(spacing, rowHeight * 2.0);
	let stagger = vec2f(spacing * 0.5, rowHeight);
	let local = position - magnet.xy;
	let offsetA = local - round(local / latticeCell) * latticeCell;
	let offsetB = local - stagger - round((local - stagger) / latticeCell) * latticeCell;
	let nearest = select(offsetB, offsetA, dot(offsetA, offsetA) < dot(offsetB, offsetB));

	// Summing adjacent lobes makes the valleys continuous across lattice cells.
	// A magnetic field stabilizes the hexagonal spacing; the surface itself lags
	// behind that forcing and transports disturbances through its neighbors.
	let nearestCenter = local - nearest;
	let neighborX = vec2f(spacing, 0.0);
	let neighborY = vec2f(spacing * 0.5, rowHeight);
	let neighborZ = vec2f(-spacing * 0.5, rowHeight);
	var lobes = pressureLobe(nearest, nearestCenter);
	lobes += pressureLobe(nearest - neighborX, nearestCenter + neighborX);
	lobes += pressureLobe(nearest + neighborX, nearestCenter - neighborX);
	lobes += pressureLobe(nearest - neighborY, nearestCenter + neighborY);
	lobes += pressureLobe(nearest + neighborY, nearestCenter - neighborY);
	lobes += pressureLobe(nearest - neighborZ, nearestCenter + neighborZ);
	lobes += pressureLobe(nearest + neighborZ, nearestCenter - neighborZ);

	let field = exp(-dot(local, local) / (0.30 + 0.045 * clamp(magnet.w, 0.0, 1.0)));
	let fieldStrength = min(pow(max(magnet.z, 0.0), 0.62), 1.1);
	let basinMask = 1.0 - smoothstep(0.88, 1.065, length(position));
	let pressure = fieldStrength * field * (0.62 * lobes + 0.018) * basinMask;
	return vec2f(pressure, field * fieldStrength);
}

@compute @workgroup_size(8, 8, 1)
fn compute(@builtin(global_invocation_id) globalId: vec3u) {
	// The allocated simulation texture defines this fixed world-space domain.
	// It is independent of the canvas resolution and its device-pixel ratio.
	let dimensions = vec2i(textureDimensions(previousState));
	let pixel = vec2i(globalId.xy);
	if (any(pixel >= dimensions)) {
		return;
	}
	let uv = (vec2f(pixel) + vec2f(0.5)) / vec2f(dimensions);
	let position = (uv - vec2f(0.5)) * 2.6;
	if (length(position) >= 1.07) {
		textureStore(nextState, pixel, vec4f(0.0, 0.0, 0.0, 1.0));
		return;
	}

	let center = surfaceState(pixel, dimensions);
	let adjacent = surfaceState(pixel + vec2i(1, 0), dimensions).x
		+ surfaceState(pixel - vec2i(1, 0), dimensions).x
		+ surfaceState(pixel + vec2i(0, 1), dimensions).x
		+ surfaceState(pixel - vec2i(0, 1), dimensions).x;
	let cellWidth = 2.6 / f32(dimensions.x);
	let laplacian = (adjacent - 4.0 * center.x) / (cellWidth * cellWidth);
	let magnetic = magneticPressure(position, spektralUniforms.uMagnet);
	let dt = clamp(spektralUniforms.uStep, 0.0, 1.0 / 60.0);

	// Semi-implicit integration: magnetic pressure versus surface restoration,
	// spatial tension and viscous damping. Two iterations at dt <= 1/60 keep
	// the 384-512 texel domain stable, including sudden cursor movement.
	let acceleration = 230.0 * (magnetic.x - center.x) + 0.00125 * laplacian;
	let wallDamping = 16.0 * smoothstep(0.86, 1.065, length(position));
	var velocity = (center.y + acceleration * dt) * exp(-(12.0 + wallDamping) * dt);
	var height = center.x + velocity * dt;
	if (height < -0.008) {
		height = -0.008;
		velocity = max(velocity, 0.0) * 0.2;
	}
	if (height > 0.72) {
		height = 0.72;
		velocity = min(velocity, 0.0) * 0.2;
	}
	textureStore(nextState, pixel, vec4f(height, velocity, magnetic.y, 1.0));
}
