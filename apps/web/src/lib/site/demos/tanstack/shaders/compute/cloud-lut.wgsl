const CAMERA_SIN_PITCH: f32 = 0.001745328;
const CAMERA_COS_PITCH: f32 = 0.99998477;
const CAMERA_TAN_HALF_FOV: f32 = 0.243389326;
const CLOUD_LUT_WIDTH: u32 = 512u;
const CLOUD_LUT_HEIGHT: u32 = 256u;

fn makeViewDirection(
  uv: vec2<f32>,
  aspect: f32
) -> vec3<f32> {
  let screen = vec2<f32>(
    (uv.x - 0.5) * 2.0 * aspect,
    (0.5 - uv.y) * 2.0
  );
  let forward = vec3<f32>(0.0, CAMERA_SIN_PITCH, CAMERA_COS_PITCH);
  let right = vec3<f32>(1.0, 0.0, 0.0);
  let cameraUp = vec3<f32>(0.0, CAMERA_COS_PITCH, -CAMERA_SIN_PITCH);

  return normalize(
    forward +
    (right * screen.x + cameraUp * screen.y) * CAMERA_TAN_HALF_FOV
  );
}

fn cloudHash(cell: vec2<f32>) -> f32 {
  let seed = dot(cell, vec2<f32>(37.17, 119.41));

  return fract(sin(seed) * 21891.731);
}

fn cloudNoise(point: vec2<f32>) -> f32 {
  let cell = floor(point);
  let local = fract(point);
  let blend = local * local * (vec2<f32>(3.0) - 2.0 * local);
  let low = mix(
    cloudHash(cell),
    cloudHash(cell + vec2<f32>(1.0, 0.0)),
    blend.x
  );
  let high = mix(
    cloudHash(cell + vec2<f32>(0.0, 1.0)),
    cloudHash(cell + vec2<f32>(1.0, 1.0)),
    blend.x
  );

  return mix(low, high, blend.y);
}

fn cloudFbm(pointInput: vec2<f32>, octaveCount: i32) -> f32 {
  var point = pointInput;
  var amplitude = 0.54;
  var value = 0.0;
  var weight = 0.0;

  for (var octave = 0; octave < 5; octave = octave + 1) {
    if (octave >= octaveCount) {
      break;
    }

    value += cloudNoise(point) * amplitude;
    weight += amplitude;
    point = mat2x2<f32>(
      vec2<f32>(1.72, 0.43),
      vec2<f32>(-0.38, 1.81)
    ) * point + vec2<f32>(0.19, 0.31);
    amplitude *= 0.52;
  }

  return value / max(weight, 0.0001);
}

fn proceduralClouds(
  viewDirection: vec3<f32>,
  time: f32,
  coverage: f32,
  speed: f32
) -> vec2<f32> {
  let forward = max(viewDirection.z, 0.2);
  let angularPoint = vec2<f32>(
    viewDirection.x / forward,
    viewDirection.y / forward
  );
  let clock = time * speed * 0.018;
  let wind = vec2<f32>(clock, clock * 0.13);
  let point =
    angularPoint * vec2<f32>(5.6, 9.2) +
    vec2<f32>(5.5, -2.0) +
    wind;
  let warp = vec2<f32>(
    cloudFbm(point * 0.43 + vec2<f32>(1.7, 5.2), 3),
    cloudFbm(point * 0.43 + vec2<f32>(8.3, -2.6), 3)
  ) - vec2<f32>(0.5);
  let shapedPoint = point + warp * 0.9;
  let formations = cloudFbm(shapedPoint * 1.5, 5);
  let erosion = cloudFbm(
    shapedPoint * 3.8 + vec2<f32>(5.3, 1.7) - wind * 0.24,
    3
  );
  let covered = clamp(coverage, 0.0, 1.0);
  let threshold = mix(0.78, 0.4, covered);
  let altitudePresence = smoothstep(
    0.055,
    0.14,
    viewDirection.y
  );
  let formationSignal =
    formations - (1.0 - altitudePresence) * 0.52;
  let separatedMasses = smoothstep(
    threshold - 0.07,
    threshold + 0.065,
    formationSignal
  );
  let erodedShape =
    formationSignal -
    (1.0 - erosion) * mix(0.24, 0.2, covered);
  let density = smoothstep(
    threshold - 0.07,
    threshold + 0.2,
    erodedShape
  ) * separatedMasses;
  let core = smoothstep(
    threshold - 0.015,
    threshold + 0.12,
    formationSignal + erosion * 0.055
  );
  let horizonFade = smoothstep(0.002, 0.035, viewDirection.y);

  return vec2<f32>(
    density * horizonFade,
    core * horizonFade
  );
}


@compute @workgroup_size(8, 8)
fn compute(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= CLOUD_LUT_WIDTH || id.y >= CLOUD_LUT_HEIGHT) {
    return;
  }

  let sceneUv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(
    f32(CLOUD_LUT_WIDTH),
    f32(CLOUD_LUT_HEIGHT)
  );
  let resolution = max(spektralFrame.resolution, vec2f(1.0));
  let viewDirection = makeViewDirection(sceneUv, resolution.x / resolution.y);
  let cloud = proceduralClouds(
    viewDirection,
    spektralFrame.time,
    spektralUniforms.uCloudCoverage,
    spektralUniforms.uCloudSpeed
  );
  textureStore(cloudLut, vec2u(id.xy), vec4f(cloud, 0.0, 1.0));
}
