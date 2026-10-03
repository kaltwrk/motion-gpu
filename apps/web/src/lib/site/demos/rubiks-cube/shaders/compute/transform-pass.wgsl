const CUBE_COUNT: u32 = 27u;

fn quat_normalize(q: vec4f) -> vec4f {
  let m = max(length(q), 1e-6);
  return q / m;
}

fn quat_mul(a: vec4f, b: vec4f) -> vec4f {
  return quat_normalize(vec4f(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  ));
}

fn quat_conj(q: vec4f) -> vec4f {
  return vec4f(-q.x, -q.y, -q.z, q.w);
}

fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
  let qv = q.xyz;
  let uv = cross(qv, v);
  let uuv = cross(qv, uv);
  return v + ((uv * q.w) + uuv) * 2.0;
}

fn axis_coord(v: vec3f, axis: i32) -> f32 {
  if (axis == 0) { return v.x; }
  if (axis == 1) { return v.y; }
  return v.z;
}

@compute @workgroup_size(64)
fn compute(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= CUBE_COUNT) { return; }

  var gridPos = cubeBasePositions[i].xyz;
  var cubeQuat = cubeBaseQuaternions[i];

  if (spektralUniforms.uMoveActive > 0.5) {
    let axis = i32(round(spektralUniforms.uActiveAxis));
    let layer = i32(round(spektralUniforms.uActiveLayer));
    let coord = i32(round(axis_coord(gridPos, axis)));

    if (coord == layer) {
      let moveQuat = spektralUniforms.uMoveQuat;
      gridPos = quat_rotate(moveQuat, gridPos);
      cubeQuat = quat_mul(moveQuat, cubeQuat);
    }
  }

  let sceneQuat = spektralUniforms.uSceneQuat;
  let worldPos = quat_rotate(sceneQuat, gridPos * spektralUniforms.uSpacing);
  let worldQuat = quat_mul(sceneQuat, cubeQuat);
  let invWorldQuat = quat_conj(worldQuat);

  cubeGridPositions[i] = vec4f(gridPos, 1.0);
  cubeWorldPositions[i] = vec4f(worldPos, 1.0);
  cubeWorldQuaternions[i] = worldQuat;
  cubeInvWorldQuaternions[i] = invWorldQuat;
}
