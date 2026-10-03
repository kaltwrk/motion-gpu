const PI: f32 = 3.141592653589793;

fn rotate2(p: vec2f, angle: f32) -> vec2f {
	let c = cos(angle);
	let s = sin(angle);
	return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn coverUv(uv: vec2f, resolution: vec2f, textureSize: vec2f) -> vec2f {
	let safeTexture = max(textureSize, vec2f(1.0));
	let scaleRatio = resolution / safeTexture;
	let scale = max(scaleRatio.x, scaleRatio.y);
	let scaledSize = safeTexture * scale;
	let offset = (resolution - scaledSize) * 0.5;
	return (uv * resolution - offset) / scaledSize;
}

fn transformUv(uv: vec2f, aspect: f32, rotation: f32) -> vec2f {
	let centered = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
	let transformed = rotate2(centered, -rotation);
	return vec2f(transformed.x / aspect + 0.5, transformed.y + 0.5);
}

fn panelOptics(
	uv: vec2f,
	resolution: vec2f,
	panelWidth: f32,
	waveFrequency: f32,
	waveAmplitude: f32
) -> vec4f {
	let aspect = resolution.x / max(resolution.y, 1.0);
	let angle = 0.0;
	let cosA = cos(angle);
	let sinA = sin(angle);
	let centered = uv - vec2f(0.5);
	let asp = vec2f(centered.x * aspect, centered.y);
	let u = asp.x * cosA + asp.y * sinA;
	let v = -asp.x * sinA + asp.y * cosA;
	let frequency = 9.02 / max(panelWidth, 0.001);
	let cell = fract((u + sin(v * waveFrequency * PI * 2.0) * waveAmplitude) * frequency) - 0.5;
	let cellPos = cell * 2.0;
	let slope = sign(cellPos) * pow(max(abs(cellPos), 0.0001), 3.0);
	let refrU = -(slope * 3.37) * (0.5 / frequency);
	return vec4f(cellPos, slope, refrU, frequency);
}

fn imageField(uv: vec2f, resolution: vec2f, textureSize: vec2f) -> vec3f {
	return textureSample(uImage, uImageSampler, coverUv(uv, resolution, textureSize)).rgb;
}

fn refractedImage(uv: vec2f, chroma: vec2f, resolution: vec2f, textureSize: vec2f) -> vec3f {
	let r = imageField(uv + chroma, resolution, textureSize).r;
	let g = imageField(uv, resolution, textureSize).g;
	let b = imageField(uv - chroma, resolution, textureSize).b;
	return vec3f(r, g, b);
}

fn frag(uv: vec2f) -> vec4f {
	let resolution = vec2f(spektralFrame.resolution);
	let textureSize = vec2f(textureDimensions(uImage));
	let aspect = resolution.x / max(resolution.y, 1.0);
	let angle = 0.0;
	let cosA = cos(angle);
	let sinA = sin(angle);
	let effectUv = transformUv(uv, aspect, radians(GLASS_ROTATION));
	let animatedWave = GLASS_WAVE_AMPLITUDE * (0.75 + 0.25 * sin(spektralFrame.time * GLASS_SPEED * 0.22));
	let optics = panelOptics(
		effectUv,
		resolution,
		GLASS_PANEL_WIDTH,
		GLASS_WAVE_FREQUENCY,
		animatedWave
	);
	let slope = optics.y;
	let refrU = optics.z * GLASS_REFRACTION;
	let refractedUv = vec2f(uv.x + (refrU * cosA) / aspect, uv.y + refrU * sinA);
	let chromaU = refrU * 0.15 * GLASS_CHROMATIC_ABERRATION;
	let chroma = vec2f((chromaU * cosA) / aspect, chromaU * sinA);
	let color = refractedImage(refractedUv, chroma, resolution, textureSize);
	let nz = sqrt(1.0 - min(slope * slope, 1.0));
	let halfLight = (-90.0 * PI / 180.0) * 0.5;
	let hx = sin(halfLight);
	let hy = cos(halfLight);
	let nDotH = max(slope * hx + nz * hy, 0.0);
	let shininess = exp2(8.0 - 0.11 * 7.0);
	let fresnel = pow(1.0 - nz, 5.0);
	let spec = pow(nDotH, shininess) * (0.04 + 0.96 * fresnel) * 2.0 * max(GLASS_REFRACTION, 0.0);
	let finalColor = clamp(color + vec3f(spec), vec3f(0.0), vec3f(1.0));
	return vec4f(finalColor, 1.0);
}
