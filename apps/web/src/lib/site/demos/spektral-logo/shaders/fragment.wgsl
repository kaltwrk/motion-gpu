#include <utils>
#include <transforms>
#include <logoSdf>
#include <scene>
#include <raymarch>
#include <lighting>

fn renderScene(uv: vec2f, jitter: vec2f) -> vec3f {
	let resolution = spektralFrame.resolution;
	let time = spektralFrame.time;
	let cycleDuration = 3.0;
	let phase = time / cycleDuration;
	let cycleIndex = floor(phase);
	let t = fract(phase);

	let eased = easeInOut(t, 3.0);
	let tt = (cycleIndex + eased) * PI;
	let objRot = rotY(tt);

	let rotInv = transpose(objRot);

	let fragCoord = uv * resolution + jitter;
	let centeredUv = (fragCoord - 0.5 * resolution) / resolution.y;

	let ro = vec3f(0.0, 0.0, 5.8);
	let rd = normalize(vec3f(centeredUv, -1.65));

	let bg = vec3f(0.006, 0.008, 0.013);
	var col = bg;

	let hit = rayMarch(ro, rd, rotInv);

	if (hit.hit) {
		let p = ro + rd * hit.dist;
		let n = getNormal(p, rotInv);
		col = shadeAcrylic(p, n, ro);
	}

	return col;
}

fn frag(uv: vec2f) -> vec4f {
	var col = vec3f(0.0);

	col += renderScene(uv, vec2f(-0.375, -0.125));
	col += renderScene(uv, vec2f( 0.125, -0.375));
	col += renderScene(uv, vec2f(-0.125,  0.375));
	col += renderScene(uv, vec2f( 0.375,  0.125));

	col *= 0.125;

	return vec4f(col, 1.0);
}
