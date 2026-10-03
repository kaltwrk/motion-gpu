fn hash21(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn valueNoise(point: vec2f) -> f32 {
  let cell = floor(point);
  let local = fract(point);
  let blend = local * local * (vec2f(3.0) - 2.0 * local);
  let bottom = mix(
    hash21(cell),
    hash21(cell + vec2f(1.0, 0.0)),
    blend.x
  );
  let top = mix(
    hash21(cell + vec2f(0.0, 1.0)),
    hash21(cell + vec2f(1.0, 1.0)),
    blend.x
  );
  return mix(bottom, top, blend.y);
}

const WAVE_DIRECTIONS: array<vec2<f32>, 25> = array<vec2<f32>, 25>(
  vec2<f32>(0.0, 1.0),
  vec2<f32>(0.780573070, 0.625064552),
  vec2<f32>(0.975817084, -0.218588680),
  vec2<f32>(0.439324200, -0.898328602),
  vec2<f32>(-0.426605135, -0.904437959),
  vec2<f32>(-0.972635686, -0.232335597),
  vec2<f32>(-0.789314985, 0.613988519),
  vec2<f32>(-0.014598114, 0.999893427),
  vec2<f32>(0.771675766, 0.636016071),
  vec2<f32>(0.978704095, -0.205276161),
  vec2<f32>(0.451084435, -0.892481267),
  vec2<f32>(-0.415134281, -0.909760177),
  vec2<f32>(-0.969739318, -0.244142681),
  vec2<f32>(-0.796425641, 0.604736447),
  vec2<f32>(-0.025288319, 0.999680221),
  vec2<f32>(0.764831305, 0.644230604),
  vec2<f32>(0.980843008, -0.194799960),
  vec2<f32>(0.460601211, -0.887607217),
  vec2<f32>(-0.405383229, -0.914146841),
  vec2<f32>(-0.967073500, -0.254497349),
  vec2<f32>(-0.802846074, 0.596186340),
  vec2<f32>(-0.035975631, 0.999352694),
  vec2<f32>(0.757899344, 0.652371526),
  vec2<f32>(0.982869744, -0.184301466),
  vec2<f32>(0.470065325, -0.882631600)
);

fn fresnelSchlick(cosTheta: f32, f0: f32) -> f32 {
  let oneMinusCosine = 1.0 - clamp(cosTheta, 0.0, 1.0);
  let oneMinusCosineSquared = oneMinusCosine * oneMinusCosine;
  let oneMinusCosineFifth =
    oneMinusCosineSquared * oneMinusCosineSquared * oneMinusCosine;

  return f0 + (1.0 - f0) * oneMinusCosineFifth;
}

fn distributionGGX(nDotH: f32, roughness: f32) -> f32 {
  let alpha = max(roughness * roughness, 0.001);
  let alphaSquared = alpha * alpha;
  let denominator =
    nDotH * nDotH * (alphaSquared - 1.0) + 1.0;

  return alphaSquared / max(PI * denominator * denominator, 0.0001);
}

fn importanceSampleGGX(
  xi: vec2<f32>,
  normal: vec3<f32>,
  roughness: f32
) -> vec3<f32> {
  let alpha = max(roughness * roughness, 0.001);
  let alphaSquared = alpha * alpha;
  let phi = 2.0 * PI * xi.x;
  let cosTheta = sqrt(
    (1.0 - xi.y) /
    max(1.0 + (alphaSquared - 1.0) * xi.y, 0.0001)
  );
  let sinTheta = sqrt(max(1.0 - cosTheta * cosTheta, 0.0));
  let tangentSample = vec3<f32>(
    cos(phi) * sinTheta,
    sin(phi) * sinTheta,
    cosTheta
  );
  let helper = select(
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(1.0, 0.0, 0.0),
    abs(normal.y) > 0.999
  );
  let tangent = normalize(cross(helper, normal));
  let bitangent = cross(normal, tangent);

  return normalize(
    tangent * tangentSample.x +
    bitangent * tangentSample.y +
    normal * tangentSample.z
  );
}

fn geometrySchlickGGX(nDotDirection: f32, roughness: f32) -> f32 {
  let k = roughness * roughness * 0.5;
  return nDotDirection /
    max(nDotDirection * (1.0 - k) + k, 0.0001);
}

fn geometrySmithGGX(
  nDotView: f32,
  nDotLight: f32,
  roughness: f32
) -> f32 {
  return
    geometrySchlickGGX(nDotView, roughness) *
    geometrySchlickGGX(nDotLight, roughness);
}

fn waterLightBrdf(
  lightDirection: vec3<f32>,
  viewToCamera: vec3<f32>,
  surfaceNormal: vec3<f32>,
  viewFacing: f32,
  roughness: f32,
  f0: f32
) -> f32 {
  let halfVector = normalize(viewToCamera + lightDirection);
  let nDotLight = max(dot(surfaceNormal, lightDirection), 0.0);
  let nDotHalf = max(dot(surfaceNormal, halfVector), 0.0);
  let viewDotHalf = max(dot(viewToCamera, halfVector), 0.0);
  let distribution = distributionGGX(nDotHalf, roughness);
  let geometry = geometrySmithGGX(viewFacing, nDotLight, roughness);
  let fresnel = fresnelSchlick(viewDotHalf, f0);

  return
    distribution * geometry * fresnel /
    max(4.0 * viewFacing * nDotLight, 0.0001);
}

fn acesToneMap(color: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;

  return clamp(
    color * (a * color + vec3<f32>(b)) /
      (color * (c * color + vec3<f32>(d)) + vec3<f32>(e)),
    vec3<f32>(0.0),
    vec3<f32>(1.0)
  );
}

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

fn makeSunDirection(timeOfDay: f32) -> vec3<f32> {
  let dayTime = clamp(timeOfDay, 0.0, 24.0);
  let solarPhase = (dayTime - 6.0) / 24.0 * 2.0 * PI;
  let hourAngle = (dayTime - 12.0) / 12.0 * PI;
  let elevationRadians = sin(solarPhase) * MAX_SUN_ELEVATION * DEG_TO_RAD;
  let azimuthRadians = sin(hourAngle) * MAX_SUN_AZIMUTH * DEG_TO_RAD;
  let horizontal = cos(elevationRadians);

  return vec3<f32>(
    sin(azimuthRadians) * horizontal,
    sin(elevationRadians),
    cos(azimuthRadians) * horizontal
  );
}

fn makeMoonDirection(timeOfDay: f32) -> vec3<f32> {
  let dayTime = clamp(timeOfDay, 0.0, 24.0);
  let lunarPhase = (dayTime - 18.0) / 24.0 * 2.0 * PI;
  let hourAngle = (dayTime - 12.0) / 12.0 * PI;
  let elevationRadians =
    sin(lunarPhase) * MAX_MOON_ELEVATION * DEG_TO_RAD;
  let azimuthRadians =
    -sin(hourAngle) * MAX_SUN_AZIMUTH * DEG_TO_RAD;
  let horizontal = cos(elevationRadians);

  return vec3<f32>(
    sin(azimuthRadians) * horizontal,
    sin(elevationRadians),
    cos(azimuthRadians) * horizontal
  );
}

