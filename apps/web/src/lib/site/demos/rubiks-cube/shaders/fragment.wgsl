fn saturate(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn max3(v: vec3f) -> f32 {
  return max(v.x, max(v.y, v.z));
}

fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let qv = q.xyz;
  let uv = cross(qv, v);
  let uuv = cross(qv, uv);
  return v + ((uv * q.w) + uuv) * 2.0;
}

fn sd_box(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max3(q), 0.0);
}

fn sd_round_box(p: vec3f, half_size: f32, radius: f32) -> f32 {
  let inner = vec3f(max(0.001, half_size - radius));
  return sd_box(p, inner) - radius;
}

fn background(rd: vec3f) -> vec3f {
  return vec3f(0.02, 0.026, 0.036);
}

fn ray_hits_scene_sphere(ro: vec3f, rd: vec3f, radius: f32) -> bool {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - radius * radius;
  let h = b * b - c;
  if (h < 0.0) {
    return false;
  }

  let s = sqrt(h);
  let far_t = -b + s;
  return far_t > 0.0;
}

struct HitData {
  dist: f32,
  cube_index: u32,
  local_p: vec3f,
}

fn estimate_local_round_normal(local_p: vec3f, half_size: f32, radius: f32) -> vec3f {
  let e = 0.0016;
  let nx = sd_round_box(local_p + vec3f(e, 0.0, 0.0), half_size, radius)
    - sd_round_box(local_p - vec3f(e, 0.0, 0.0), half_size, radius);
  let ny = sd_round_box(local_p + vec3f(0.0, e, 0.0), half_size, radius)
    - sd_round_box(local_p - vec3f(0.0, e, 0.0), half_size, radius);
  let nz = sd_round_box(local_p + vec3f(0.0, 0.0, e), half_size, radius)
    - sd_round_box(local_p - vec3f(0.0, 0.0, e), half_size, radius);
  return normalize(vec3f(nx, ny, nz));
}

fn sample_scene(
  p_world: vec3f,
  half_size: f32,
  radius: f32
) -> HitData {
  var closest = HitData(1e9, 0u, vec3f(0.0));
  const cube_count: u32 = 27u;
  let bound_radius = half_size * 1.7321 + radius;

  for (var i = 0u; i < cube_count; i = i + 1u) {
    let world_pos = cubeWorldPositions[i].xyz;
    let delta = p_world - world_pos;

    let cheap = length(delta) - bound_radius;
    if (cheap > closest.dist) {
      continue;
    }

    let inv_world_quat = cubeInvWorldQuaternions[i];
    let local_p = quat_rotate(inv_world_quat, delta);
    let d = sd_round_box(local_p, half_size, radius);

    if (d < closest.dist) {
      closest = HitData(d, i, local_p);
    }
  }

  return closest;
}

fn frag(uv: vec2f) -> vec4f {
  let aspect = spektralFrame.resolution.x / max(spektralFrame.resolution.y, 1.0);
  let fit = select(vec2f(1.0, 1.0 / aspect), vec2f(aspect, 1.0), aspect > 1.0);
  let p = (uv * 2.0 - 1.0) * fit;

  let ro = vec3f(0.0, 0.0, 6.25);
  let rd = normalize(vec3f(p.x, p.y, -2.55));

  let bg = background(rd);
  if (!ray_hits_scene_sphere(ro, rd, spektralUniforms.uSceneBound)) {
    return vec4f(bg, 1.0);
  }

  let half_size = spektralUniforms.uCubeScale * 0.5;
  let radius = min(spektralUniforms.uRoundRadius, half_size - 0.01);
  let hit_eps = 0.0025;
  let max_steps = 120;
  let max_dist = 20.0;

  var t = 0.0;
  var prev_t = 0.0;
  var hit = false;
  var selected_hit = HitData(1e9, 0u, vec3f(0.0));

  for (var step = 0; step < max_steps; step = step + 1) {
    if (t > max_dist) {
      break;
    }

    let p_world = ro + rd * t;
    let s = sample_scene(p_world, half_size, radius);

    if (s.dist < hit_eps) {
      hit = true;
      selected_hit = s;
      break;
    }

    prev_t = t;
    t += clamp(s.dist, 0.002, 0.75);
  }

  if (!hit) {
    return vec4f(bg, 1.0);
  }

  var a = prev_t;
  var b = t;
  for (var i = 0; i < 4; i = i + 1) {
    let m = 0.5 * (a + b);
    let s = sample_scene(ro + rd * m, half_size, radius);
    if (s.dist < hit_eps) {
      b = m;
      selected_hit = s;
    } else {
      a = m;
    }
  }

  let local_t = b;
  let local_p = selected_hit.local_p;
  let local_n = estimate_local_round_normal(local_p, half_size, radius);
  let world_quat = cubeWorldQuaternions[selected_hit.cube_index];
  let normal = normalize(quat_rotate(world_quat, local_n));
  let view_dir = -rd;

  let light_key = normalize(vec3f(-0.46, 0.78, 0.5));
  let light_fill = normalize(vec3f(0.5, 0.18, -0.84));
  let light_back = normalize(vec3f(0.2, -0.82, 0.55));

  let key = max(dot(normal, light_key), 0.0);
  let fill = max(dot(normal, light_fill), 0.0);
  let back = max(dot(normal, light_back), 0.0);

  let fresnel = pow(
    1.0 - max(dot(normal, view_dir), 0.0),
    max(0.001, spektralUniforms.uRimPower)
  ) * spektralUniforms.uRimIntensity;


  let variation = cubeGridPositions[selected_hit.cube_index].xyz * 0.5 + 0.5;
  let body = spektralUniforms.uBodyColor + variation * 0.015;

  let specular = pow(max(dot(reflect(-light_key, normal), view_dir), 0.0), 92.0) * 0.32;

  var lit = body * (0.11 + key * 1.02 + fill * 0.3 + back * 0.17);
  lit += vec3f(specular);
  lit += spektralUniforms.uRimColor * (fresnel * 1.35);

  let fog = exp(-local_t * 0.07);
  let color = mix(bg, lit, fog);

  return vec4f(max(color, vec3f(0.0)), 1.0);
}
