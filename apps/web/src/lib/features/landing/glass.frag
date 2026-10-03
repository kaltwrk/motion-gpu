// Source: GlassPaneScene.svelte from origin/master; original landing glass optics.

		precision highp float;

		uniform float uTime;
		uniform vec2 uResolution;
		uniform vec2 uTextureSize;
		uniform sampler2D uTexture;
		uniform float uUseGradient;
		uniform vec3 uGradientBackground;
		uniform vec3 uGradientAccent;
		uniform float uRotation;
		uniform float uRefraction;
		uniform float uChromaticAberration;
		uniform float uPanelWidth;
		uniform float uWaveFrequency;
		uniform float uWaveAmplitude;
		varying vec2 vUv;

		const float PI = 3.141592653589793;

		vec2 rotate2(vec2 p, float angle) {
			float c = cos(angle);
			float s = sin(angle);
			return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
		}

		float smoothMinimum(float a, float b, float radius) {
			float blend = clamp(0.5 + 0.5 * (b - a) / radius, 0.0, 1.0);
			return mix(b, a, blend) - radius * blend * (1.0 - blend);
		}

		vec2 getCoverUV(vec2 uv, vec2 textureSize) {
			vec2 safeTexture = max(textureSize, vec2(1.0));
			vec2 s = uResolution / safeTexture;
			float scale = max(s.x, s.y);
			vec2 scaledSize = safeTexture * scale;
			vec2 offset = (uResolution - scaledSize) * 0.5;
			return (uv * uResolution - offset) / scaledSize;
		}

		vec2 transformUv(vec2 uv, float aspect, float rotation) {
			vec2 centered = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
			vec2 transformed = rotate2(centered, -rotation);
			return vec2(transformed.x / aspect + 0.5, transformed.y + 0.5);
		}

		vec4 panelOptics(vec2 uv, float panelWidth, float waveFrequency, float waveAmplitude) {
			float aspect = uResolution.x / max(uResolution.y, 1.0);
			float angle = 0.0;
			float cosA = cos(angle);
			float sinA = sin(angle);
			vec2 centered = uv - vec2(0.5);
			vec2 asp = vec2(centered.x * aspect, centered.y);
			float u = asp.x * cosA + asp.y * sinA;
			float v = -asp.x * sinA + asp.y * cosA;
			float frequency = 9.02 / max(panelWidth, 0.001);
			float cell = fract((u + sin(v * waveFrequency * PI * 2.0) * waveAmplitude) * frequency) - 0.5;
			float cellPos = cell * 2.0;
			float slope = sign(cellPos) * pow(max(abs(cellPos), 0.0001), 3.0);
			float refrU = -(slope * 3.37) * (0.5 / frequency);
			return vec4(cellPos, slope, refrU, frequency);
		}

		vec3 gradientField(vec2 uv) {
			float gradientDistance = length(vec2(uv.x - 0.5, 1.0 - uv.y) / vec2(1.0, 1.1));
			vec3 color = mix(
				uGradientBackground,
				uGradientAccent,
				smoothstep(0.27, 0.69, gradientDistance)
			);
			float vignetteDistance = length((uv - 0.5) / vec2(0.3, 0.5));
			float vignette = smoothstep(0.72, 1.0, vignetteDistance);
			return mix(color, uGradientBackground, vignette);
		}

		vec3 imageField(vec2 uv) {
			if (uUseGradient > 0.5) return gradientField(uv);
			return texture2D(uTexture, getCoverUV(uv, uTextureSize)).rgb;
		}

		vec3 refractedImage(vec2 uv, vec2 chroma) {
			float r = imageField(uv + chroma).r;
			float g = imageField(uv).g;
			float b = imageField(uv - chroma).b;
			return vec3(r, g, b);
		}

		void main() {
			float aspect = uResolution.x / max(uResolution.y, 1.0);
			float angle = 0.0;
			float cosA = cos(angle);
			float sinA = sin(angle);
			vec2 effectUv = transformUv(vUv, aspect, radians(uRotation));
			float animatedWave = uWaveAmplitude * (0.75 + 0.25 * sin(uTime * 0.22));
			vec4 optics = panelOptics(effectUv, uPanelWidth, uWaveFrequency, animatedWave);
			float slope = optics.y;
			float refrU = optics.z * uRefraction;
			vec2 refractedUv = vec2(
				vUv.x + (refrU * cosA) / aspect,
				vUv.y + refrU * sinA
			);
			float chromaU = refrU * 0.15 * uChromaticAberration;
			vec2 chroma = vec2((chromaU * cosA) / aspect, chromaU * sinA);
			vec3 color = refractedImage(refractedUv, chroma);
			float nz = sqrt(1.0 - min(slope * slope, 1.0));
			float halfLight = (-90.0 * PI / 180.0) * 0.5;
			float hx = sin(halfLight);
			float hy = cos(halfLight);
			float nDotH = max(slope * hx + nz * hy, 0.0);
			float shininess = exp2(8.0 - 0.11 * 7.0);
			float fresnel = pow(1.0 - nz, 5.0);
			float spec = pow(nDotH, shininess) * (0.04 + 0.96 * fresnel) * 2.0 * max(uRefraction, 0.0);
			vec3 finalColor = clamp(color + vec3(spec), vec3(0.0), vec3(1.0));
			if (uUseGradient > 0.5) {
				vec2 distanceToEdge = min(vUv, 1.0 - vUv);
				float edgeDistance = smoothMinimum(distanceToEdge.x, distanceToEdge.y, 0.08);
				float featherProgress = clamp(edgeDistance / 0.5, 0.0, 1.0);
				float edgeFeather = 1.0 - pow(1.0 - featherProgress, 3.0);
				finalColor = mix(uGradientBackground, finalColor, edgeFeather);
			}
			gl_FragColor = vec4(finalColor, 1.0);
		}
