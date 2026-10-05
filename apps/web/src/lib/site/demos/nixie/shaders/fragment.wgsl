#include <studio>

const TUBE_X = array<f32, 6>(-1.075, -0.685, -0.195, 0.195, 0.685, 1.075);
const CATHODE_ORDER = array<u32, 10>(1u, 6u, 2u, 7u, 5u, 0u, 4u, 9u, 8u, 3u);
const CATHODE_DEPTH = array<f32, 10>(0., -.055, -.033, .044, .011, -.011, -.044, -.022, .033, .022);
const CATHODE_RADIANCE = vec3f(20., 3.6, .10);
fn rotate_y(p: vec3f, a: f32) -> vec3f {
	return vec3f(cos(a)*p.x + sin(a)*p.z, p.y, -sin(a)*p.x + cos(a)*p.z);
}

fn angle() -> f32 {
	return 0.38 + spektralUniforms.uInspect.x * 0.12;
}

fn local(p: vec3f) -> vec3f {
	return rotate_y(p, -angle());
}

fn world(p: vec3f) -> vec3f {
	return rotate_y(p, angle());
}

fn box(p: vec3f, b: vec3f, r: f32) -> f32 {
	let q = abs(p) - b + r;
	return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn cylinder(p: vec3f, r: f32, h: f32) -> f32 {
	let q = vec2f(length(p.xz)-r, abs(p.y)-h);
	return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0)));
}

fn nearest_tube(x: f32) -> u32 {
	var id = 0u;
	var best = 10.0;
	for (var i = 0u; i<6u; i++) {
		let d = abs(x-TUBE_X[i]);
		if (d<best) {
			best = d;
			id = i;
		}
	}
	return id;
}

fn foot(p: vec3f) -> f32 {
	return cylinder(vec3f(abs(p.x)-1.15, p.y-0.027, abs(p.z)-0.245), .068, .025);
}

// The same circular pin layout drives the glass feedthroughs and socket holes.
fn nearest_pin(p: vec2f) -> vec2f {
	let pitch = 6.2831853 / 12.;
	let pin_angle = round((atan2(p.y, p.x) - .13) / pitch) * pitch + .13;
	return vec2f(cos(pin_angle), sin(pin_angle)) * .086;
}

fn base_distance(p: vec3f) -> vec2f {
	var result = vec2f(box(p-vec3f(0., .12, 0.), vec3f(1.42, .085, .36), .026), 1.);
	let feet = foot(p);
	if (feet<result.x) {
		result = vec2f(feet, 2.);
	}
	let q = p-vec3f(TUBE_X[nearest_tube(p.x)], .214, 0.);
	let pin_center = nearest_pin(q.xz);
	let pin_hole = cylinder(q-vec3f(pin_center.x, 0., pin_center.y), .0033, .015);
	let socket = max(cylinder(q, .143, .007)-.002, -pin_hole);
	if (socket<result.x) {
		result = vec2f(socket, 2.);
	}
	let ring = abs(length(q.xz)-.143)-.004;
	let trim = max(ring, abs(q.y+.003)-.008);
	if (trim<result.x) {
		result = vec2f(trim, 3.);
	}
	// Both neon separators have small two-contact bakelite sockets above the wood.
	let separator = vec3f(abs(p.x)-.445, p.y-.221, p.z-.012);
	let contact_hole = cylinder(vec3f(abs(separator.x)-.009, separator.y, separator.z), .0026, .020);
	let separator_socket = max(cylinder(separator, .039, .014)-.002, -contact_hole);
	if (separator_socket<result.x) {
		result = vec2f(separator_socket, 2.);
	}
	let separator_trim = max(abs(length(separator.xz)-.039)-.0018, abs(separator.y+.009)-.003);
	if (separator_trim<result.x) {
		result = vec2f(separator_trim, 3.);
	}
	let button = cylinder((p-vec3f(1.24, .12, .365)).xzy, .026, .011)-.001;
	if (button<result.x) {
		result = vec2f(button, 3.);
	}
	return result;
}

fn studio_occluder_distance(p: vec3f) -> f32 {
	let q = local(p);
	let body = min(box(q-vec3f(0., .12, 0.), vec3f(1.42, .085, .36), .026), foot(q));
	let tx = TUBE_X[nearest_tube(q.x)];
	// Glass is transmissive; the internal metal stack supplies the tube's shadow.
	let stack = box(q-vec3f(tx, .72, -.028), vec3f(.10, .275, .046), .009);
	let separator = cylinder(vec3f(abs(q.x)-.445, q.y-.221, q.z-.012), .040, .016);
	return min(min(body, stack), separator);
}

fn normal_base(p: vec3f) -> vec3f {
	let e = .00035;
	let a = vec3f(1., -1., -1.);
	let b = vec3f(-1., -1., 1.);
	let c = vec3f(-1., 1., -1.);
	let d = vec3f(1., 1., 1.);
	return normalize(a*base_distance(p+a*e).x+b*base_distance(p+b*e).x+c*base_distance(p+c*e).x+d*base_distance(p+d*e).x);
}

fn trace_base(ro: vec3f, rd: vec3f) -> vec2f {
	let a = (vec3f(-1.45, 0., -.39)-ro)/rd;
	let b = (vec3f(1.45, .242, .39)-ro)/rd;
	let lo = min(a, b);
	let hi = max(a, b);
	var t = max(0., max(lo.x, max(lo.y, lo.z)));
	let end = min(hi.x, min(hi.y, hi.z));
	if (t>end) {
		return vec2f(100., 0.);
	}
	for (var i = 0u; i<90u; i++) {
		let d = base_distance(ro+rd*t);
		if (d.x<.0003) {
			return vec2f(t, d.y);
		}
		t+=max(d.x*.85, .0002);
		if (t>end) {
			break;
		}
	}
	return vec2f(100., 0.);
}

fn hash3(p: vec3f) -> f32 {
	return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7)))*43758.5453);
}

fn noise(p: vec3f) -> f32 {
	let i = floor(p);
	let f = fract(p);
	let u = f*f*(3.-2.*f);
	return mix(mix(mix(hash3(i), hash3(i+vec3f(1, 0, 0)), u.x), mix(hash3(i+vec3f(0, 1, 0)), hash3(i+vec3f(1, 1, 0)), u.x), u.y), mix(mix(hash3(i+vec3f(0, 0, 1)), hash3(i+vec3f(1, 0, 1)), u.x), mix(hash3(i+vec3f(0, 1, 1)), hash3(i+vec3f(1, 1, 1)), u.x), u.y), u.z);
}

fn tube_light(p: vec3f, n: vec3f) -> vec3f {
	var light = vec3f(0.);
	for (var i = 0u; i<6u; i++) {
		let d = vec3f(TUBE_X[i], .65, .025)-p;
		light+=vec3f(.22, .042, .0022)*max(dot(normalize(d), n), 0.)/(dot(d, d)+.035);
	}
	return light*spektralUniforms.uBrightness*spektralUniforms.uReady;
}

fn shade_base(p: vec3f, n: vec3f, v: vec3f, id: f32) -> vec3f {
	var base = vec3f(.038, .019, .010);
	var metal = 0.;
	var rough = .36;
	var shaded_normal = n;
	if (id==1.) {
		let warp = noise(p*vec3f(1.5, 9., 5.))*.13+noise(p*vec3f(3., 4., 14.))*.035;
		let grain = noise(vec3f(p.x*1.8, (p.z+warp)*115., p.y*56.));
		let fine = noise(p*vec3f(7., 210., 250.));
		base = mix(vec3f(.038, .017, .006), vec3f(.105, .054, .023), grain*.7+fine*.3);
		rough = .36+fine*.09;
		if (spektralUniforms.uWoodReady>.5) {
			// Unwrap the rounded top/front cross-section continuously. The grain
			// follows the same piece of timber over its softened edge.
			let edge_angle = atan2(abs(n.z), max(n.y, .00001));
			let across = sign(p.z) * (min(abs(p.z), .334) + .026*edge_angle + max(.179-p.y, 0.));
			let wood_uv = vec2f(p.x*.31+.48, across*.46+.54);
			let tangent = normalize(vec3f(1., 0., 0.)-n*n.x+vec3f(0., 0., .00001));
			let bitangent = normalize(cross(tangent, n));
			let albedo = textureSampleLevel(uWoodAlbedo, uWoodAlbedoSampler, wood_uv, 1.2).rgb;
			base = mix(albedo, vec3f(dot(albedo, vec3f(.2126, .7152, .0722))), .10)*vec3f(.29, .255, .22);
			rough = .29+textureSampleLevel(uWoodRoughness, uWoodRoughnessSampler, wood_uv, 1.).r*.27;
			let map_n = textureSampleLevel(uWoodNormal, uWoodNormalSampler, wood_uv, 0.).xyz*2.-1.;
			shaded_normal = normalize(n+tangent*map_n.x*.09+bitangent*map_n.y*.09);
		}
	}
	else if (id==2.) {
		base = vec3f(.010, .009, .008);
		rough = .35;
	}
	else {
		base = vec3f(.15, .135, .11);
		metal = .9;
		rough = .28;
	}
	let wp = world(p);
	let wn = world(shaded_normal);
	let lit = studio_surface(wp, wn, world(v), base, metal, rough, studio_visibility(wp, wn), 1.);
	var radiance = lit+tube_light(p, n)*base*.85;
	if (id==1.&&n.y>.45) {
		// The satin finish is smoother than the pores of the underlying timber.
		let coat = studio_fresnel(vec3f(.025), dot(n, v));
		radiance = radiance*(1.-coat)+studio_environment(wp, reflect(world(-v), world(n)), .27)*coat*.32;
		radiance+=wood_reflection(p, v, normalize(mix(n, shaded_normal, .3)));
	}
	return radiance;
}

fn ellipsoid(ro: vec3f, rd: vec3f, center: vec3f, radii: vec3f) -> vec2f {
	let o = (ro-center)/radii;
	let d = rd/radii;
	let a = dot(d, d);
	let b = dot(o, d);
	let c = dot(o, o)-1.;
	let h = b*b-a*c;
	if (h<0.) {
		return vec2f(100., -100.);
	}
	return vec2f(-b-sqrt(h), -b+sqrt(h))/a;
}

// Cylindrical glass envelope, rounded shoulders, and a small evacuation tip.
fn glass_interval(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
	var range = vec2f(100., -100.);
	let bottom_y = select(.258, .291, r<.155);
	let bottom_radius = select(.028, .017, r<.155)*r/.156;
	let a = dot(rd.xz, rd.xz);
	let b = dot(ro.xz, rd.xz);
	let c = dot(ro.xz, ro.xz)-r*r;
	let h = b*b-a*c;
	if (h>=0.) {
		let roots = vec2f(-b-sqrt(h), -b+sqrt(h))/a;
		for (var i = 0u; i<2u; i++) {
			let y = ro.y+roots[i]*rd.y;
			if (y>=bottom_y&&y<=1.045) {
				range = vec2f(min(range.x, roots[i]), max(range.y, roots[i]));
			}
		}
	}
	let top = ellipsoid(ro, rd, vec3f(0., 1.045, 0.), vec3f(r, .105*r/.156, r));
	let bottom = ellipsoid(ro, rd, vec3f(0., bottom_y, 0.), vec3f(r, bottom_radius, r));
	for (var i = 0u; i<2u; i++) {
		if (top.x<top.y&&ro.y+rd.y*top[i]>=1.045) {
			range = vec2f(min(range.x, top[i]), max(range.y, top[i]));
		}
		if (bottom.x<bottom.y&&ro.y+rd.y*bottom[i]<=bottom_y) {
			range = vec2f(min(range.x, bottom[i]), max(range.y, bottom[i]));
		}
	}
	let tip = ellipsoid(ro, rd, vec3f(0., 1.154, 0.), vec3f(.022, .042, .022)*r/.156);
	if (tip.x<tip.y) {
		range = vec2f(min(range.x, tip.x), max(range.y, tip.y));
	}
	return range;
}

fn glass_normal(p: vec3f, r: f32) -> vec3f {
	let bottom_y = select(.258, .291, r<.155);
	let bottom_radius = select(.028, .017, r<.155)*r/.156;
	if (p.y>1.137&&length(p.xz)<.023) {
		return normalize((p-vec3f(0., 1.154, 0.))/vec3f(.022*.022, .042*.042, .022*.022));
	}
	if (p.y>1.045) {
		return normalize((p-vec3f(0., 1.045, 0.))/vec3f(r*r, .105*.105*r*r/(.156*.156), r*r));
	}
	if (p.y<bottom_y) {
		return normalize((p-vec3f(0., bottom_y, 0.))/vec3f(r*r, bottom_radius*bottom_radius, r*r));
	}
	return normalize(vec3f(p.x, 0., p.z));
}

fn glyph_distance(p: vec2f, digit: u32) -> f32 {
	let uv = p/vec2f(.30, .68)+.5;
	if (any(uv<vec2f(0.))||any(uv>vec2f(1.))) {
		return .04;
	}
	let tile = vec2f(f32(digit%5u), f32(digit/5u));
	return textureSampleLevel(uCathodes, uCathodesSampler, (tile+vec2f(uv.x, 1.-uv.y))/vec2f(5., 2.), 0.).r*.04;
}

fn wood_reflection(p: vec3f, view: vec3f, n: vec3f) -> vec3f {
	let direction = reflect(-view, n);
	if (direction.z>=-.001||direction.y<=0.) {
		return vec3f(0.);
	}
	let t = (.035-p.z)/direction.z;
	if (t<=0.) {
		return vec3f(0.);
	}
	let reflected = p+direction*t;
	var light = vec3f(0.);
	for (var id = 0u; id<6u; id++) {
		var digit = 0u;
		if (id<4u) {
			digit = u32(spektralUniforms.uDigitsA[id]);
		}
		else {
			digit = u32(spektralUniforms.uDigitsB[id-4u]);
		}
		let d = glyph_distance(reflected.xy-vec2f(TUBE_X[id], .72), digit);
		let lobe = pow(1.-smoothstep(.002, .039, d), 2.)/(1.+t*.8);
		light+=vec3f(1.8, .28, .008)*lobe;
	}
	let f = studio_fresnel(vec3f(.045), dot(n, view));
	return light*f*spektralUniforms.uBrightness*spektralUniforms.uReady;
}

fn stroke(d: f32, r: f32, aa: f32) -> f32 {
	return 1.-smoothstep(r-aa, r+aa, d);
}

fn mesh_distance(p: vec2f) -> f32 {
	let r = .013;
	let period = vec2f(1.7320508, 3.)*r;
	let a = p-period*floor(p/period)-period*.5;
	let b = p+period*.5-period*floor((p+period*.5)/period)-period*.5;
	let q = select(a, b, dot(b, b)<dot(a, a));
	let hex = max(abs(q.x), dot(abs(q), vec2f(.5, .8660254)));
	return abs(hex-r*.8660254);
}

// The atlas gradient locates the nearest glowing section of a cathode. Its
// light catches the sides of metal wires instead of tinting the whole cage.
fn cathode_illumination(p: vec3f, n: vec3f, view: vec3f, digit: u32) -> vec3f {
	let uv = p.xy-vec2f(0., .72);
	let d = glyph_distance(uv, digit);
	let e = .001;
	let gradient = vec2f(glyph_distance(uv+vec2f(e, 0.), digit)-glyph_distance(uv-vec2f(e, 0.), digit), glyph_distance(uv+vec2f(0., e), digit)-glyph_distance(uv-vec2f(0., e), digit));
	let valid = (1.-smoothstep(.025, .039, d))*smoothstep(.00001, .00015, length(gradient));
	let nearest = uv-gradient/max(length(gradient), .00001)*d;
	let delta = vec3f(nearest+vec2f(0., .72), CATHODE_DEPTH[digit])-p;
	let l = normalize(delta+vec3f(0., 0., .000001));
	let h = normalize(l+view);
	let diffuse = max(dot(n, l), 0.);
	let specular = pow(max(dot(n, h), 0.), 32.)*diffuse*5.;
	return CATHODE_RADIANCE*(.00024/(dot(delta, delta)+.00024))*(diffuse*.16+specular)*valid;
}

fn shade_mesh(p: vec3f, rd: vec3f, id: u32, side: bool, active_digit: u32, previous: u32, fade: f32) -> vec3f {
	let uv = select(p.xy, p.zy, side);
	let d = mesh_distance(uv);
	let e = .00015;
	let gradient = vec2f(mesh_distance(uv+vec2f(e, 0.))-mesh_distance(uv-vec2f(e, 0.)), mesh_distance(uv+vec2f(0., e))-mesh_distance(uv-vec2f(0., e)));
	let radial = clamp(d/.0009, 0., .98);
	let normal = vec3f(gradient/max(length(gradient), .000001)*radial, sqrt(1.-radial*radial));
	let n = select(normal, normal.zyx, side);
	let wp = world(p+vec3f(TUBE_X[id], 0., 0.));
	let metal = studio_surface(wp, world(n), world(-rd), vec3f(.22, .235, .24), .93, .34, vec3f(.8), .31);
	let warm = mix(cathode_illumination(p, n, -rd, previous), cathode_illumination(p, n, -rd, active_digit), fade);
	return metal+warm*spektralUniforms.uBrightness*spektralUniforms.uReady;
}

// Trace only the hardware in the intersected bulb. It stays out of the global
// scene march, and its nearest depth correctly occludes every cathode layer.
fn inner_field(p: vec3f, with_mica: bool) -> vec2f {
	var hit = vec2f(box(p-vec3f(0., .733, -.094), vec3f(.105, .302, .0018), .001), 3.);
	let rod = cylinder(vec3f(abs(p.x)-.109, p.y-.722, p.z+.065), .0038, .315);
	if (rod<hit.x) {
		hit = vec2f(rod, 1.);
	}
	let y = select(.368, 1.037, p.y>.70);
	var wafer = cylinder(p-vec3f(0., y, -.006), .127, .0022);
	let perforation = cylinder(vec3f(abs(p.x)-.073, p.y-y, p.z-.023), .012, .01);
	wafer = max(wafer, -perforation);
	let center_hole = box(p-vec3f(0., y, .030), vec3f(.037, .01, .009), .004);
	wafer = max(wafer, -center_hole);
	let pin_center = nearest_pin(p.xz);
	let pin_hole = cylinder(p-vec3f(pin_center.x, y, pin_center.y), .0034, .009);
	wafer = max(wafer, -pin_hole);
	if (with_mica && wafer<hit.x) {
		hit = vec2f(wafer, 2.);
	}
	let pin = cylinder(p-vec3f(pin_center.x, .295, pin_center.y), .0019, .077);
	if (pin<hit.x) {
		hit = vec2f(pin, 1.);
	}
	let bridge = box(p-vec3f(0., .425, -.008), vec3f(.108, .0026, .025), .001);
	if (bridge<hit.x) {
		hit = vec2f(bridge, 1.);
	}
	return hit;
}

fn inner_distance(p: vec3f) -> f32 {
	return inner_field(p, true).x;
}

fn trace_inner(ro: vec3f, rd: vec3f, with_mica: bool) -> vec2f {
	let a = (vec3f(-.133, .222, -.103)-ro)/rd;
	let b = (vec3f(.133, 1.045, .128)-ro)/rd;
	let lo = min(a, b);
	let hi = max(a, b);
	var t = max(.0001, max(lo.x, max(lo.y, lo.z)));
	let end = min(hi.x, min(hi.y, hi.z));
	if (t>end) {
		return vec2f(100., 0.);
	}
	for (var i = 0u; i<80u; i++) {
		let d = inner_field(ro+rd*t, with_mica);
		if (d.x<.00015) {
			return vec2f(t, d.y);
		}
		t+=max(d.x*.90, .0001);
		if (t>end) {
			break;
		}
	}
	return vec2f(100., 0.);
}

fn inner_normal(p: vec3f) -> vec3f {
	let e = .00012;
	return normalize(vec3f(inner_distance(p+vec3f(e, 0., 0.))-inner_distance(p-vec3f(e, 0., 0.)), inner_distance(p+vec3f(0., e, 0.))-inner_distance(p-vec3f(0., e, 0.)), inner_distance(p+vec3f(0., 0., e))-inner_distance(p-vec3f(0., 0., e))));
}

fn shade_inner(p: vec3f, rd: vec3f, id: u32, kind: f32) -> vec3f {
	let n = inner_normal(p);
	let wp = world(p+vec3f(TUBE_X[id], 0., 0.));
	var base = vec3f(.26, .275, .27);
	var metal = .85;
	var rough = .29;
	if (kind==2.) {
		base = mix(vec3f(.050, .044, .028), vec3f(.095, .088, .058), noise(p*260.));
		metal = 0.;
		rough = .48;
	}
	if (kind==3.) {
		base = vec3f(.019, .021, .018);
		metal = .35;
		rough = .43;
	}
	let cavity = max(.008-inner_distance(p+n*.008), 0.)/.008;
	let occlusion = 1.-clamp(cavity, 0., 1.)*.55;
	let ambient = studio_surface(wp, world(n), world(-rd), base, metal, rough, vec3f(.65), .72*occlusion);
	let d = vec3f(0., .73, .035)-p;
	let warm = vec3f(.023, .004, .0002)*max(dot(normalize(d), n), 0.)/(dot(d, d)+.04);
	return ambient+warm*base*spektralUniforms.uBrightness;
}

fn tube_contents(ro: vec3f, rd: vec3f, under: vec3f, id: u32, aa: f32) -> vec3f {
	var color = under;
	var hardware = trace_inner(ro, rd, true);
	var mica_t = 100.;
	var mica_light = vec3f(0.);
	var mica_transmission = vec3f(1.);
	var mica_applied = false;
	if (hardware.y == 2.) {
		mica_t = hardware.x;
		let p = ro + rd * mica_t;
		let incidence = max(abs(dot(inner_normal(p), rd)), .15);
		// A thin mica wafer passes tinted light, while its grazing edge stays visible.
		mica_transmission = exp(-vec3f(.20, .25, .38) / incidence);
		mica_light = shade_inner(p, rd, id, 2.) * (1. - mica_transmission);
		hardware = trace_inner(ro, rd, false);
	}
	if (hardware.y>0.) {
		color = shade_inner(ro+rd*hardware.x, rd, id, hardware.y);
	}
	var active_digit = 0u;
	var previous = 0u;
	var fade = 1.;
	if (id<4u) {
		active_digit = u32(spektralUniforms.uDigitsA[id]);
		previous = u32(spektralUniforms.uPreviousA[id]);
		fade = spektralUniforms.uDigitMixA[id];
	}
	else {
		active_digit = u32(spektralUniforms.uDigitsB[id-4u]);
		previous = u32(spektralUniforms.uPreviousB[id-4u]);
		fade = spektralUniforms.uDigitMixB[id-4u];
	}
	for (var layer = 0u; layer<10u; layer++) {
		let digit = CATHODE_ORDER[layer];
		let z = -.055+f32(layer)*.011;
		let t = (z-ro.z)/rd.z;
		if (t<0.||t>hardware.x) {
			continue;
		}
		if (!mica_applied && t < mica_t) {
			color = color * mica_transmission + mica_light;
			mica_applied = true;
		}
		let p = (ro+rd*t).xy-vec2f(0., .72);
		let d = glyph_distance(p, digit);
		let wire = stroke(d, .0016, aa);
		var energy = 0.;
		if (digit==active_digit) {
			energy+=fade;
		}
		if (digit==previous) {
			energy+=1.-fade;
		}
		energy*=spektralUniforms.uBrightness*spektralUniforms.uReady;
		// Cold metal stays inside a thin orange gas sheath; other cathodes occlude it.
		let distance_active = glyph_distance(p, active_digit);
		let reflected_glow = exp(-distance_active/.018) * (1.-smoothstep(.025, .039, distance_active)) * spektralUniforms.uBrightness;
		var cold_metal = vec3f(.075, .075, .064);
		if (wire>.002) {
			let e = .0008;
			let gradient = vec2f(glyph_distance(p+vec2f(e, 0.), digit)-d, glyph_distance(p+vec2f(0., e), digit)-d);
			let radial = clamp(d/.002, 0., .93);
			let wire_n = normalize(vec3f(gradient/max(length(gradient), .00001)*radial, sqrt(1.-radial*radial)));
			let wire_p = vec3f(p+vec2f(TUBE_X[id], .72), z);
			cold_metal = studio_surface(world(wire_p), world(wire_n), world(-rd), vec3f(.24, .255, .25), .90, .32, vec3f(1.), .44);
		}
		cold_metal+=vec3f(.26, .060, .004)*reflected_glow;
		color = mix(color, cold_metal+vec3f(.10, .023, .002)*energy, wire*.94);
		let sheath = exp(-pow(max(d-.0014, 0.)/max(.0038, aa*.90), 2.));
		let core = mix(.40, 1., smoothstep(.0007, .0024, d));
		let halo = exp(-pow(d/.014, 2.));
		color+=(CATHODE_RADIANCE*sheath*core+vec3f(.48, .068, .0015)*halo)*energy;
	}
	// A fine hexagonal anode cage sits in front of the layered electrodes.
	let mesh_t = (.080-ro.z)/rd.z;
	let mp = ro+rd*mesh_t;
	if (mesh_t>0.&&mesh_t<hardware.x&&abs(mp.x)<.121&&mp.y>.421&&mp.y<1.035) {
		if (!mica_applied && mesh_t < mica_t) {
			color = color * mica_transmission + mica_light;
			mica_applied = true;
		}
		let d = mesh_distance(mp.xy);
		let resolved = stroke(d, .0009, aa*.7);
		let fine = mix(resolved, .10, smoothstep(.002, .006, aa));
		if (fine>.002) {
			color = mix(color, shade_mesh(mp, rd, id, false, active_digit, previous, fade), fine*.94);
		}
	}
	// Side return of the same cage gives it depth when seen obliquely.
	if (rd.x<-.001) {
		let t = (.123-ro.x)/rd.x;
		let p = ro+rd*t;
		if (t>0.&&t<hardware.x&&p.z>-.085&&p.z<.080&&p.y>.421&&p.y<1.035) {
			if (!mica_applied && t < mica_t) {
				color = color * mica_transmission + mica_light;
				mica_applied = true;
			}
			let amount = stroke(mesh_distance(p.zy), .0008, aa);
			if (amount>.002) {
				color = mix(color, shade_mesh(p, rd, id, true, active_digit, previous, fade), amount*.94);
			}
		}
	}
	if (!mica_applied) {
		color = color * mica_transmission + mica_light;
	}
	return color;
}

// Clear glass sees the actual dark floor/backdrop and the shared softboxes.
// The diffuse environment used for opaque materials would wash out the bulb.
fn glass_environment(p: vec3f, direction: vec3f, roughness: f32) -> vec3f {
	var radiance = studio_background(direction);
	if (direction.y<-.001) {
		let floor_p = p-direction*(p.y/direction.y);
		radiance = studio_floor(floor_p, -direction, vec3f(1.), 1.);
	}
	// A small indirect room contribution uses the same hemispherical studio
	// fill as the opaque surfaces; it keeps grazing glass legible in the dark.
	radiance+=studio_irradiance(p, direction, vec3f(0.))*.15;
	for (var i = 0u; i<3u; i++) {
		radiance+=STUDIO_RADIANCE[i]*studio_emitter(p, direction, roughness, i);
	}
	return radiance;
}

fn glass_cathode_reflection(ro: vec3f, rd: vec3f, id: u32, aa: f32) -> vec3f {
	let rear = glass_interval(ro, rd, .146);
	if (rear.y<=.001 || rear.y>2.) {
		return vec3f(0.);
	}
	let p = ro+rd*rear.y;
	let n = glass_normal(p, .146);
	let direction = reflect(rd, n);
	let origin = p+direction*.0003;
	let hardware = trace_inner(origin, direction, false);
	var active_digit = 0u;
	var previous = 0u;
	var fade = 1.;
	if (id<4u) {
		active_digit = u32(spektralUniforms.uDigitsA[id]);
		previous = u32(spektralUniforms.uPreviousA[id]);
		fade = spektralUniforms.uDigitMixA[id];
	} else {
		active_digit = u32(spektralUniforms.uDigitsB[id-4u]);
		previous = u32(spektralUniforms.uPreviousB[id-4u]);
		fade = spektralUniforms.uDigitMixB[id-4u];
	}
	var reflected = vec3f(0.);
	for (var i = 0u; i<2u; i++) {
		let digit = select(previous, active_digit, i==1u);
		let energy = select(1.-fade, fade, i==1u);
		let t = (CATHODE_DEPTH[digit]-origin.z)/direction.z;
		if (energy>.001 && t>0. && t<hardware.x) {
			let q = (origin+direction*t).xy-vec2f(0., .72);
			let d = glyph_distance(q, digit);
			let sheath = exp(-pow(max(d-.0014, 0.)/max(.0045, aa), 2.));
			reflected+=CATHODE_RADIANCE*sheath*energy;
		}
	}
	return reflected*studio_fresnel(vec3f(.035), dot(n, rd))*spektralUniforms.uBrightness*spektralUniforms.uReady;
}

fn render_tube(ro: vec3f, rd: vec3f, under: vec3f, id: u32, opaque_t: f32) -> vec3f {
	let o = ro-vec3f(TUBE_X[id], 0., 0.);
	let range = glass_interval(o, rd, .156);
	if (range.y<range.x||range.y<0.||range.x>opaque_t) {
		return under;
	}
	let p = o+rd*range.x;
	let base_normal = glass_normal(p, .156);
	let glass_ripple = vec3f(noise(p*vec3f(34., 25., 28.))-.5, noise(p*vec3f(28., 31., 35.)+17.)-.5, 0.);
	let n = normalize(base_normal+glass_ripple*.007);
	let wp = world(p+vec3f(TUBE_X[id], 0., 0.));
	let wn = world(n);
	let glass_ray = refract(rd, n, 1./1.47);
	let inner_start = p+glass_ray*.0001;
	let inner = glass_interval(inner_start, glass_ray, .146);
	var air_origin = inner_start;
	var air_direction = glass_ray;
	if (inner.y>inner.x&&inner.x>0.) {
		air_origin = inner_start+glass_ray*inner.x;
		air_direction = refract(glass_ray, glass_normal(air_origin, .146), 1.47);
		if (dot(air_direction, air_direction)<.1) {
			air_direction = rd;
		}
	}
	let footprint = 2.*range.x/(STUDIO_FOCAL_LENGTH*min(spektralFrame.resolution.x, spektralFrame.resolution.y));
	var transmitted = under;
	if (p.y<.37) {
		let through_origin = air_origin+vec3f(TUBE_X[id], 0., 0.);
		let through = trace_base(through_origin, air_direction);
		if (through.y>0.) {
			let surface = through_origin+air_direction*through.x;
			let refracted_base = shade_base(surface, normal_base(surface), -air_direction, through.y);
			let stem_weight = .58 * (1. - smoothstep(.29, .37, p.y));
			transmitted = mix(under, refracted_base, stem_weight);
		}
	}
	// Resolve the rear-wall ghost before compositing the front electrodes, so
	// neither their metal nor the rear shield can acquire a see-through glow.
	transmitted+=glass_cathode_reflection(air_origin, air_direction, id, footprint*.65);
	var contents = tube_contents(air_origin, air_direction, transmitted, id, footprint*.48);
	let fresnel = studio_fresnel(vec3f(.035), dot(n, -rd));
	let reflection = glass_environment(wp, reflect(world(rd), wn), .065);
	// Both boundaries of the thin front wall contribute; keep reflection and
	// transmission complementary rather than adding an unoccluded rear haze.
	let wall_reflection = fresnel+(1.-fresnel)*fresnel*.55;
	let wall_distance = select(.008, inner.x, inner.x>0.&&inner.x<.05);
	let absorption = exp(-vec3f(.70, .25, .48)*wall_distance);
	contents = contents*absorption*(1.-wall_reflection)+reflection*wall_reflection;
	// The thick fused-glass foot has two visible rims above its black socket.
	let foot_band = exp(-pow((p.y-.247)/.007, 2.))*.12+exp(-pow((p.y-.270)/.004, 2.))*.07;
	contents+=vec3f(.72, .80, .86)*foot_band*.22;
	let stamp_uv = vec2f((atan2(p.x, p.z)-.45)/1.05+.5, .5-(p.y-.318)/.13);
	if (all(stamp_uv>vec2f(0.))&&all(stamp_uv<vec2f(1.))) {
		let ink = textureSampleLevel(uStamp, uStampSampler, stamp_uv, 0.).r;
		contents = mix(contents, vec3f(.085, .082, .073), ink*.46*spektralUniforms.uReady);
	}
	return contents;
}

fn render_separator(ro: vec3f, rd: vec3f, under: vec3f, x: f32, opaque_t: f32) -> vec3f {
	let hit = ellipsoid(ro, rd, vec3f(x, .373, .012), vec3f(.026, .062, .026));
	var color = under;
	let pin_t = (.012-ro.z)/rd.z;
	let pin = ro+rd*pin_t-vec3f(x, 0., 0.);
	let aa = pin_t/(STUDIO_FOCAL_LENGTH*min(spektralFrame.resolution.x, spektralFrame.resolution.y));
	if (pin_t>0.&&pin_t<opaque_t&&pin.y>.236&&pin.y<.356) {
		let pins = stroke(abs(abs(pin.x)-.009), .0018, aa);
		color = mix(color, vec3f(.18, .154, .108), pins);
	}
	if (hit.x<hit.y&&hit.x>0.&&hit.x<opaque_t) {
		let p = ro+rd*hit.x;
		let n = normalize((p-vec3f(x, .373, .012))/vec3f(.026*.026, .062*.062, .026*.026));
		let t = (.012-ro.z)/rd.z;
		let q = ro+rd*t-vec3f(x, .373, 0.);
		let glow = exp(-pow(q.x/.012, 4.)-pow(q.y/.031, 4.));
		color = mix(color, vec3f(.075, .08, .07), .10)+vec3f(6.5, 1.2, .035)*glow*spektralUniforms.uBrightness;
		let fresnel = studio_fresnel(vec3f(.035), dot(n, -rd));
		color = color*(1.-fresnel)+glass_environment(world(p), reflect(world(rd), world(n)), .04)*fresnel;
	}
	return color;
}

fn render_nixie(uv: vec2f) -> vec3f {
	let ray = studio_camera(uv, spektralFrame.resolution);
	let ro = local(ray.origin);
	let rd = local(ray.direction);
	let hit = trace_base(ro, rd);
	var color = vec3f(0.);
	var opaque_t = hit.x;
	if (hit.y>0.) {
		let p = ro+rd*hit.x;
		color = shade_base(p, normal_base(p), -rd, hit.y);
	}
	else {
		let t = -ray.origin.y/ray.direction.y;
		opaque_t = t;
		if (t>0.) {
			let p = ray.origin+ray.direction*t;
			let clearance = max(studio_occluder_distance(p), 0.);
			color = studio_floor(p, -ray.direction, studio_visibility(p, vec3f(0., 1., 0.)), 1.-.42*exp(-clearance/.032));
			color+=tube_light(local(p), vec3f(0., 1., 0.))*vec3f(.018, .014, .012);
		}
		else {
			color = studio_background(ray.direction);
			opaque_t = 100.;
		}
	}
	for (var i = 0u; i<6u; i++) {
		color = render_tube(ro, rd, color, i, opaque_t);
	}
	color = render_separator(ro, rd, color, -.445, opaque_t);
	color = render_separator(ro, rd, color, .445, opaque_t);
	return color;
}

fn frag(uv: vec2f) -> vec4f {
	let offset = vec2f(.25)/spektralFrame.resolution;
	return vec4f((render_nixie(uv-offset)+render_nixie(uv+offset))*.5, 1.);
}
