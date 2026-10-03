fn sunDiscRadiance(
  viewDirection: vec3<f32>,
  sunDirection: vec3<f32>,
  sunTransmittance: vec3<f32>
) -> vec3<f32> {
  let mu = clamp(dot(viewDirection, sunDirection), -1.0, 1.0);
  let sunDisc = smoothstep(
    SUN_DISC_COS_OUTER,
    SUN_DISC_COS_INNER,
    mu
  );
  let radialSquared =
    (1.0 - mu) / max(1.0 - SUN_DISC_COS_RADIUS, 0.000001);
  let photosphereDepth = sqrt(
    max(1.0 - clamp(radialSquared, 0.0, 1.0), 0.0)
  );
  let limbDarkening = mix(0.38, 1.0, photosphereDepth);

  return
    sunTransmittance * sunDisc * limbDarkening * SUN_INTENSITY * 0.65;
}

fn moonDiscRadiance(
  viewDirection: vec3<f32>,
  moonDirection: vec3<f32>,
  moonTransmittance: vec3<f32>
) -> vec3<f32> {
  let mu = clamp(dot(viewDirection, moonDirection), -1.0, 1.0);
  let moonDisc = smoothstep(
    cos(MOON_ANGULAR_RADIUS * 1.08),
    cos(MOON_ANGULAR_RADIUS * 0.94),
    mu
  );
  let radialSquared =
    (1.0 - mu) /
    max(1.0 - cos(MOON_ANGULAR_RADIUS), 0.000001);
  let limb = sqrt(max(1.0 - clamp(radialSquared, 0.0, 1.0), 0.0));
  let tangent = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), moonDirection));
  let bitangent = cross(moonDirection, tangent);
  let moonUv = vec2<f32>(
    dot(viewDirection, tangent),
    dot(viewDirection, bitangent)
  ) / MOON_ANGULAR_RADIUS;
  let maria = smoothstep(
    0.38,
    0.72,
    valueNoise(moonUv * 2.15 + vec2<f32>(3.7, -1.9))
  );
  let highlands =
    valueNoise(moonUv * 8.5 + vec2<f32>(-5.2, 8.1)) - 0.5;
  let surface =
    mix(0.72, 1.0, limb) *
    (0.88 - maria * 0.16 + highlands * 0.07);
  let horizonVisibility = smoothstep(
    -MOON_ANGULAR_RADIUS,
    MOON_ANGULAR_RADIUS,
    moonDirection.y
  );

  return
    vec3<f32>(1.0, 0.94, 0.92) *
    moonTransmittance *
    moonDisc *
    surface *
    horizonVisibility *
    0.72;
}

fn cloudScatteringPhase(mu: f32) -> f32 {
  let directionality = 0.68;
  let directionalitySquared = directionality * directionality;
  let phaseBase = max(
    1.0 + directionalitySquared - 2.0 * directionality * mu,
    0.0001
  );

  return
    (1.0 - directionalitySquared) /
    (4.0 * PI * phaseBase * sqrt(phaseBase));
}

fn shadeCloudLayer(
  backgroundRadiance: vec3<f32>,
  skyRadiance: vec3<f32>,
  sunTransmittance: vec3<f32>,
  moonTransmittance: vec3<f32>,
  viewDirection: vec3<f32>,
  sunDirection: vec3<f32>,
  moonDirection: vec3<f32>,
  moonVisibility: f32,
  nightAmount: f32,
  cloud: vec2<f32>
) -> vec3<f32> {
  let density = clamp(cloud.x, 0.0, 1.0);
  let thickness = clamp(cloud.y, 0.0, 1.0);
  let opticalDepth = density * mix(0.35, 3.0, thickness);
  let cloudTransmittance = exp(-opticalDepth);
  let scatteringAmount = 1.0 - cloudTransmittance;

  let skyLuminance = dot(
    max(skyRadiance, vec3<f32>(0.0)),
    vec3<f32>(0.2126, 0.7152, 0.0722)
  );
  let diffuseSkySpectrum = mix(
    skyRadiance,
    vec3<f32>(skyLuminance),
    0.58
  );
  let ambientSelfShadow = mix(0.84, 0.18, thickness);
  let ambientScattering = diffuseSkySpectrum * ambientSelfShadow;

  let sunVisibility = smoothstep(
    -SUN_RADIUS_RADIANS,
    SUN_RADIUS_RADIANS,
    sunDirection.y
  );
  let scatteringAngle = clamp(
    dot(viewDirection, sunDirection),
    -1.0,
    1.0
  );
  let directPhase = cloudScatteringPhase(scatteringAngle);
  let directPenetration = exp(-opticalDepth * 0.45);
  let edgeLighting = density * (1.0 - thickness);
  let directScattering =
    sunTransmittance *
    SUN_INTENSITY *
    directPhase *
    directPenetration *
    sunVisibility *
    (0.72 + edgeLighting * 1.35);
  let moonScatteringAngle = clamp(
    dot(viewDirection, moonDirection),
    -1.0,
    1.0
  );
  let moonPhase = cloudScatteringPhase(moonScatteringAngle);
  let lunarScattering =
    moonTransmittance *
    MOONLIGHT_INTENSITY *
    moonPhase *
    directPenetration *
    moonVisibility *
    nightAmount *
    (0.55 + edgeLighting * 1.1);
  let sourceRadiance =
    ambientScattering + directScattering + lunarScattering;

  return
    backgroundRadiance * cloudTransmittance +
    sourceRadiance * scatteringAmount;
}

fn atmosphereLutUv(directionInput: vec3f) -> vec2f {
  let direction = normalize(directionInput);
  return vec2f(
    fract(atan2(direction.x, direction.z) / (2.0 * PI) + 0.5),
    clamp(asin(clamp(direction.y, -1.0, 1.0)) / PI + 0.5, 0.0, 1.0)
  );
}

fn sampleSolarAtmosphere(direction: vec3f) -> vec3f {
  return textureSampleLevel(
    solarAtmosphereLut,
    solarAtmosphereLutSampler,
    atmosphereLutUv(direction),
    0.0
  ).rgb;
}

fn sampleLunarAtmosphere(direction: vec3f) -> vec3f {
  return textureSampleLevel(
    lunarAtmosphereLut,
    lunarAtmosphereLutSampler,
    atmosphereLutUv(direction),
    0.0
  ).rgb;
}

fn roughAtmosphereReflection(
  viewDirection: vec3<f32>,
  surfaceNormal: vec3<f32>,
  centerRadiance: vec3<f32>,
  roughness: f32
) -> vec3<f32> {
  let samples = array<vec2<f32>, 2>(
    vec2<f32>(0.1667, 0.2),
    vec2<f32>(0.8333, 0.8)
  );
  var radiance = centerRadiance;
  var weightSum = 1.0;

  for (var sample = 0; sample < 2; sample = sample + 1) {
    let microfacetNormal = importanceSampleGGX(
      samples[sample],
      surfaceNormal,
      roughness
    );
    let sampleDirection = reflect(viewDirection, microfacetNormal);
    let sampleWeight =
      max(dot(surfaceNormal, sampleDirection), 0.0) *
      step(0.001, sampleDirection.y);

    if (sampleWeight > 0.0) {
      let sampleAtmosphere = sampleSolarAtmosphere(sampleDirection);
      radiance += sampleAtmosphere * sampleWeight;
      weightSum += sampleWeight;
    }
  }

  return radiance / max(weightSum, 0.0001);
}
