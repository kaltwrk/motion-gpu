// Match Spektral's ACES Hill transform before adding display-space dithering.
fn studioAcesHillFit(color: vec3f) -> vec3f {
	let a = color * (color + vec3f(0.0245786)) - vec3f(0.000090537);
	let b = color * (vec3f(0.983729) * color + vec3f(0.4329510)) + vec3f(0.238081);
	return a / b;
}

fn studioAcesHill(colorInput: vec3f) -> vec3f {
	let inputMatrix = mat3x3f(
		vec3f(0.59719, 0.07600, 0.02840),
		vec3f(0.35458, 0.90834, 0.13383),
		vec3f(0.04823, 0.01566, 0.83777)
	);
	let outputMatrix = mat3x3f(
		vec3f(1.60475, -0.10208, -0.00327),
		vec3f(-0.53108, 1.10813, -0.07276),
		vec3f(-0.07367, -0.00605, 1.07602)
	);
	let fitted = studioAcesHillFit(inputMatrix * max(colorInput, vec3f(0.0)));
	return clamp(outputMatrix * fitted, vec3f(0.0), vec3f(1.0));
}

fn studioLinearToSrgb(linearColor: vec3f) -> vec3f {
	let lower = linearColor * 12.92;
	let higher = vec3f(1.055) * pow(linearColor, vec3f(1.0 / 2.4)) - vec3f(0.055);
	return select(lower, higher, linearColor > vec3f(0.0031308));
}

fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	let displayColor = studioLinearToSrgb(studioAcesHill(inputColor.rgb));
	// UV derivatives give one physical pixel, independently of canvas CSS size or DPR.
	let pixel = floor(uv / max(fwidth(uv), vec2f(0.0000001)));
	let noise = fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
	// Monochrome +/-0.625 of an 8-bit code value. No time input, so no crawling grain.
	let dither = (noise - 0.5) * (1.25 / 255.0);
	return vec4f(clamp(displayColor + vec3f(dither), vec3f(0.0), vec3f(1.0)), inputColor.a);
}
