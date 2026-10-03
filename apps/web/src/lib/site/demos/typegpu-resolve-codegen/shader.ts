import tgpu, { d } from 'typegpu';

const resolution = tgpu['~unstable'].rawCodeSnippet('spektralFrame.resolution', d.vec2u, 'uniform');
const time = tgpu['~unstable'].rawCodeSnippet('spektralFrame.time', d.f32, 'uniform');

const frag = tgpu
	.fn(
		[d.vec2f],
		d.vec4f
	)((uv) => {
		'use gpu';

		const r = d.vec2f(resolution.$);
		const fitX = r.x / Math.max(r.y, 1);
		const px = (uv.x - 0.5) * fitX;
		const py = uv.y - 0.5;

		const t = time.$;
		const radius2 = px * px + py * py;
		const radius = Math.sqrt(radius2);

		const rot = t * 0.23 + radius * 1.15;
		const cr = Math.cos(rot);
		const sr = Math.sin(rot);
		const qx = px * cr - py * sr;
		const qy = px * sr + py * cr;

		const theta = Math.atan2(qy, qx);
		const petals = 0.5 + 0.5 * Math.cos(theta * 10 + t * 1.7 + Math.sin(radius * 12 - t * 2.0));

		const wx = qx + 0.14 * Math.sin(qy * 9 + t * 0.9);
		const wy = qy + 0.14 * Math.cos(qx * 9 - t * 1.1);
		const checkerWave = 0.5 + 0.5 * Math.sin(wx * 18) * Math.cos(wy * 18);
		const trail = 0.5 + 0.5 * Math.sin((wx + wy) * 14 - t * 2.5 + Math.sin(theta * 4));

		const ringPulse = 0.5 + 0.5 * Math.cos(radius * 42 - t * 4.4);
		const ringMask = Math.exp(-5.2 * radius);
		const rings = ringPulse * ringMask;

		const hue = 0.52 * petals + 0.33 * checkerWave + 0.24 * trail + 0.38 * rings + t * 0.035;
		const tau = 6.2831853;
		const pr = 0.5 + 0.5 * Math.cos(tau * (hue + 0.0));
		const pg = 0.5 + 0.5 * Math.cos(tau * (hue + 0.19));
		const pb = 0.5 + 0.5 * Math.cos(tau * (hue + 0.41));

		const vignette = Math.exp(-3.8 * radius2);
		const halo = Math.exp(-18 * (radius - 0.19) * (radius - 0.19));
		const sparkle = Math.exp(-56 * radius2) * (0.5 + 0.5 * Math.sin(t * 3.2 + theta * 6));

		const rr = (0.08 + 0.92 * pr) * (0.14 + 0.86 * vignette) + 0.28 * halo + 0.18 * sparkle;
		const gg = (0.08 + 0.92 * pg) * (0.14 + 0.86 * vignette) + 0.2 * halo + 0.12 * sparkle;
		const bb = (0.1 + 0.9 * pb) * (0.14 + 0.86 * vignette) + 0.36 * halo + 0.22 * sparkle;

		return d.vec4f(rr, gg, bb, 1);
	})
	.$name('frag');

export const fragment = tgpu.resolve([frag], { names: 'strict' });
