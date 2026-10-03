import { FragCanvas, defineMaterial } from 'spektral/react';

const material = defineMaterial({
	fragment: `
fn frag(uv: vec2f) -> vec4f {
	let r = spektralFrame.resolution;
	let p = vec2f(uv.x * r.x + 0.5, uv.y * r.y + 0.5);

	var h = vec3f(0.0);
	var c = vec3f(1.0);
	var A = 0.0;
	var l = 0.0;
	var a = 0.0;

	for (var i = 0.6; i > 0.1; i -= 0.1) {
		a = (spektralFrame.time + i) * 4.0;
		a -= sin(a);
		a -= sin(a);

		let t = cos(a / 4.0 + vec2f(0.0, 11.0));
		let R = mat2x2f(vec2f(t.x, t.y), vec2f(-t.y, t.x));

		var u = (p * 2.0 - r) / r.y / 0.5;
		let ur = transpose(R) * u;
		u -= R * clamp(ur, -vec2f(i), vec2f(i));

		l = max(length(u), 0.1);
		A = min((l - 0.1) * r.y / 5.0, 1.0);
		h = sin(i * 10.0 + a / 3.0 + vec3f(1.0, 3.0, 5.0)) / 5.0 + 0.8;
		c = mix(h, c, A) * mix(vec3f(1.0), h + A * u.y / l / 2.0, 0.1 / l);
	}

	return vec4f(tanh(c * c), 1.0);
}`
});

export default function App() {
	return <FragCanvas material={material} />;
}
