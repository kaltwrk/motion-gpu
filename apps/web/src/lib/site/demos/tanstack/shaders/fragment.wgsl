#include <common>
#include <stars>
#include <water>
#include <island>
#include <palm>
#include <seabed>
#include <atmosphere>

fn frag(uv: vec2f) -> vec4f {
  let resolution = max(spektralFrame.resolution, vec2f(1.0));
  let aspect = resolution.x / resolution.y;
  let sceneUv = vec2f(uv.x, 1.0 - uv.y);

  let p0 = vec4f(
    spektralFrame.time,
    spektralUniforms.uTimeOfDay,
    spektralUniforms.uHorizonHaze,
    spektralUniforms.uExposure
  );
  let p1 = vec4f(
    spektralUniforms.uWaveSpeed,
    spektralUniforms.uCloudCoverage,
    spektralUniforms.uCloudSpeed,
    spektralUniforms.uStarDensity
  );
  let p2 = vec4f(
    spektralUniforms.uStarSize,
    spektralUniforms.uStarBrightness,
    spektralUniforms.uSeabedLevel,
    0.0
  );

  let viewDirection = makeViewDirection(sceneUv, aspect);
  let sunDirection = makeSunDirection(p0.y);
  let moonDirection = makeMoonDirection(p0.y);
  let aerosolDensity = clamp(p0.z, 0.0, 4.0);

  let isWater = viewDirection.y < 0.0;
  var sampleDirection = viewDirection;
  var surfaceNormal = vec3<f32>(0.0, 1.0, 0.0);
  var waterHitPosition = vec3<f32>(0.0);
  var waterDistance = 0.0;
  var islandHitPosition = vec3<f32>(0.0);
  var islandNormal = vec3<f32>(0.0, 1.0, 0.0);
  var islandDistance = -1.0;
  var isIsland = false;
  let waterCamera = vec3<f32>(0.0, WATER_CAMERA_HEIGHT, 0.0);
  let palmHit = intersectPalm(waterCamera, viewDirection);
  var isPalm = palmHit.x > 0.0;
  var palmHitPosition = vec3<f32>(0.0);
  var palmNormal = vec3<f32>(0.0, 1.0, 0.0);
  let waterTime = p0.x * p1.x;
  let specularRoughness = mix(0.025, 0.09, WATER_ROUGHNESS);

  if (isWater) {
    let highPlaneDistance =
      WATER_CAMERA_HEIGHT / max(-viewDirection.y, 0.001);
    let lowPlaneDistance =
      (WATER_CAMERA_HEIGHT + WATER_DEPTH) / max(-viewDirection.y, 0.001);
    let highHitPosition = waterCamera + viewDirection * highPlaneDistance;
    let lowHitPosition = waterCamera + viewDirection * lowPlaneDistance;
    waterDistance = intersectWater(
      waterCamera,
      highHitPosition,
      lowHitPosition,
      waterTime,
      WATER_SCALE,
      WATER_DEPTH
    );
    waterHitPosition = waterCamera + viewDirection * waterDistance;
    surfaceNormal = waterSurfaceNormal(
      waterHitPosition.xz,
      waterDistance,
      waterTime,
      WATER_SCALE,
      WATER_DEPTH
    );
    islandDistance = intersectIsland(waterCamera, viewDirection, waterDistance);
    isIsland = islandDistance > 0.0;
    let opaqueSurfaceDistance = select(
      waterDistance,
      islandDistance,
      isIsland
    );
    isPalm = isPalm && palmHit.x < opaqueSurfaceDistance;

    if (isIsland) {
      islandHitPosition = waterCamera + viewDirection * islandDistance;
      islandNormal = islandSurfaceNormal(islandHitPosition.xz);
    } else {
      let reflected = reflect(viewDirection, surfaceNormal);
      sampleDirection = normalize(vec3<f32>(
        reflected.x,
        abs(reflected.y),
        reflected.z
      ));
    }
  }

  if (isPalm) {
    sampleDirection = viewDirection;
    palmHitPosition = waterCamera + viewDirection * palmHit.x;
    palmNormal = palmSurfaceNormal(palmHitPosition);
  }

  let nightAmount =
    1.0 - smoothstep(-0.12, 0.02, sunDirection.y);
  let moonVisibility = smoothstep(-0.01, 0.04, moonDirection.y);
  var solarAtmosphere = vec3<f32>(0.0);
  var lunarAtmosphere = vec3<f32>(0.0);

  if (nightAmount < 0.999) {
    solarAtmosphere = sampleSolarAtmosphere(sampleDirection);
  }

  if (nightAmount > 0.001 && moonVisibility > 0.001) {
    lunarAtmosphere =
      sampleLunarAtmosphere(sampleDirection) * moonVisibility;
  }

  let physicalAtmosphere = solarAtmosphere + lunarAtmosphere;
  let nightEnvironment = nightEnvironmentRadiance(
    sampleDirection,
    nightAmount
  );
  let nightStars = nightStarRadiance(
    sampleDirection,
    moonDirection,
    nightAmount,
    resolution,
    p0.x,
    p1.w,
    p2.x,
    p2.y
  );
  let atmosphereWithoutStars = physicalAtmosphere + nightEnvironment;
  let atmosphere = atmosphereWithoutStars + nightStars;
  let sunTransmittance = lightingState[0].rgb;
  let moonTransmittance = lightingState[1].rgb;

  var hdrColor = atmosphere;
  var reflection = atmosphere;

  if (!isWater) {
    let sunDisc = sunDiscRadiance(
      viewDirection,
      sunDirection,
      sunTransmittance
    );
    let moonDisc = moonDiscRadiance(
      viewDirection,
      moonDirection,
      moonTransmittance
    );

    if (p1.y > 0.001) {
      let cloud = textureSampleLevel(
        cloudLut,
        cloudLutSampler,
        sceneUv,
        0.0
      ).rg;

      hdrColor = shadeCloudLayer(
        atmosphereWithoutStars,
        atmosphereWithoutStars,
        sunTransmittance,
        moonTransmittance,
        viewDirection,
        sunDirection,
        moonDirection,
        moonVisibility,
        nightAmount,
        cloud
      );
      let discOpticalDepth =
        cloud.x * mix(18.0, 48.0, cloud.y);
      let discTransmittance = exp(-discOpticalDepth);
      hdrColor +=
        (sunDisc + moonDisc + nightStars) * discTransmittance;
    } else {
      hdrColor += sunDisc + moonDisc;
    }
  }

  if (isWater && !isIsland) {
    reflection = roughAtmosphereReflection(
      viewDirection,
      surfaceNormal,
      physicalAtmosphere,
      specularRoughness
    );
    reflection += nightEnvironment + nightStars;
    let viewFacing = clamp(dot(-viewDirection, surfaceNormal), 0.0, 1.0);
    let waterF0Base = (WATER_IOR - 1.0) / (WATER_IOR + 1.0);
    let waterF0 = waterF0Base * waterF0Base;
    let fresnel = fresnelSchlick(viewFacing, waterF0);
    let sunAboveHorizon = smoothstep(-0.01, 0.025, sunDirection.y);
    let sunStrength = max(
      sunTransmittance.r,
      max(
        sunTransmittance.g,
        sunTransmittance.b
      )
    );
    let sunTint = mix(
      vec3<f32>(1.0),
      sunTransmittance / max(sunStrength, 0.0001),
      step(0.0001, sunStrength)
    );

    let viewToCamera = -viewDirection;
    let reflectedView = reflect(viewDirection, surfaceNormal);
    let nDotLight = max(dot(surfaceNormal, sunDirection), 0.0);
    let sunBrdf = waterLightBrdf(
      sunDirection,
      viewToCamera,
      surfaceNormal,
      viewFacing,
      specularRoughness,
      waterF0
    );
    let reflectedSunDisc = smoothstep(
      SUN_DISC_COS_OUTER,
      SUN_DISC_COS_INNER,
      dot(reflectedView, sunDirection)
    );
    let sunSolidAngle = PI * SUN_RADIUS_RADIANS * SUN_RADIUS_RADIANS;
    let resolvedSun =
      sunTransmittance *
      SUN_INTENSITY *
      reflectedSunDisc *
      sunAboveHorizon *
      10.65;
    let microfacetSun =
      sunTransmittance *
      SUN_INTENSITY *
      sunSolidAngle *
      sunBrdf *
      nDotLight *
      sunAboveHorizon *
      14.0;
    let reflectedSun = resolvedSun + microfacetSun;
    let nDotMoon = max(dot(surfaceNormal, moonDirection), 0.0);
    let moonRoughness = max(specularRoughness * 1.6, 0.06);
    let moonBrdf = waterLightBrdf(
      moonDirection,
      viewToCamera,
      surfaceNormal,
      viewFacing,
      moonRoughness,
      waterF0
    );
    let moonSolidAngle =
      PI * MOON_ANGULAR_RADIUS * MOON_ANGULAR_RADIUS;
    let resolvedMoon = moonDiscRadiance(
      reflectedView,
      moonDirection,
      moonTransmittance
    ) * 0.78;
    let microfacetMoon =
      vec3<f32>(0.82, 0.9, 1.0) *
      moonTransmittance *
      moonSolidAngle *
      moonBrdf *
      nDotMoon *
      moonVisibility *
      24.0;
    let reflectedMoon = resolvedMoon + microfacetMoon;
    var refractedDirection = refract(
      viewDirection,
      surfaceNormal,
      1.0 / WATER_IOR
    );
    if (dot(refractedDirection, refractedDirection) < 0.0001) {
      refractedDirection = viewDirection;
    }

    let seabedDistance = intersectSeabed(
      waterHitPosition,
      refractedDirection,
      p2.z
    );
    let opticalDistance = min(seabedDistance, 18.0);
    let seabedPosition =
      waterHitPosition + refractedDirection * seabedDistance;
    let bedNormal = seabedNormal(seabedPosition.xz, p2.z);
    let sunIntoWater = refract(
      -sunDirection,
      surfaceNormal,
      1.0 / WATER_IOR
    );

    let dispersion = vec2<f32>(0.022, -0.014);
    let caustics = vec3<f32>(
      cheapWaterCaustics(seabedPosition.xz + dispersion, waterTime),
      cheapWaterCaustics(seabedPosition.xz, waterTime),
      cheapWaterCaustics(seabedPosition.xz - dispersion, waterTime)
    );
    let directSunlight = smoothstep(-0.035, 0.12, sunDirection.y);
    let ambientDaylight = smoothstep(-0.08, 0.92, sunDirection.y);
    let daylightLevel = mix(0.006, 1.0, ambientDaylight);
    let causticFade =
      directSunlight *
      sqrt(clamp(sunStrength, 0.0, 1.0)) *
      exp(-opticalDistance * 0.16);
    let coarseSediment = seabedNoise(seabedPosition.xz * 3.24);
    let fineSediment = valueNoise(seabedPosition.xz * 2.7);
    let bedSlope = 1.0 - clamp(bedNormal.y, 0.0, 1.0);
    let exposedMineral = smoothstep(
      0.58,
      0.86,
      coarseSediment + bedSlope * 1.8
    );
    let paleSand = vec3<f32>(0.55, 0.46, 0.33);
    let compactSand = vec3<f32>(0.29, 0.27, 0.22);
    let mineralColor = vec3<f32>(0.16, 0.19, 0.18);
    let sedimentColor = mix(
      compactSand,
      paleSand,
      smoothstep(0.2, 0.78, coarseSediment)
    );
    let sandColor = mix(
      sedimentColor * mix(0.64, 1.08, fineSediment),
      mineralColor,
      exposedMineral * 0.68
    );
    let bedDirectLight =
      max(dot(bedNormal, normalize(-sunIntoWater)), 0.0) * directSunlight;
    let bedLighting = daylightLevel * (0.34 + 0.66 * bedDirectLight);
    let illuminatedSeabed =
      sandColor * bedLighting *
      (vec3<f32>(1.0) + caustics * sunTint * causticFade * 0.82);

    let transmittance = exp(-WATER_ABSORPTION * opticalDistance);
    let baseWaterScatter =
      vec3<f32>(0.018, 0.22, 0.31) *
      (vec3<f32>(1.0) - transmittance) *
      (0.34 + 0.32 * directSunlight) *
      daylightLevel;
    let forwardAlignment = max(
      dot(refractedDirection, sunIntoWater),
      0.0
    );
    let forwardLobe =
      forwardAlignment * forwardAlignment * forwardAlignment;
    let lowSunWarmth =
      sunAboveHorizon *
      (1.0 - smoothstep(0.06, 0.3, sunDirection.y));
    let shallowWater = exp(-opticalDistance * 0.3);
    let brokenSurface = smoothstep(
      0.015,
      0.2,
      1.0 - clamp(surfaceNormal.y, 0.0, 1.0)
    );
    let warmScatterMask =
      lowSunWarmth *
      directSunlight *
      mix(0.2, 1.0, sqrt(clamp(sunStrength, 0.0, 1.0))) *
      (0.22 + 0.78 * forwardLobe) *
      (0.25 + 0.75 * max(shallowWater, brokenSurface));
    let warmSkyScatter =
      sunTint * vec3<f32>(0.3, 0.18, 0.1) * warmScatterMask * 0.12;
    let waterScatter = baseWaterScatter + warmSkyScatter;
    let transmission = illuminatedSeabed * transmittance + waterScatter;

    let geometricGrazing =
      1.0 - smoothstep(0.0, 0.035, -viewDirection.y);
    let horizonFresnel = max(fresnel, geometricGrazing);
    var waterColor =
      horizonFresnel * reflection +
      reflectedSun +
      reflectedMoon +
      (1.0 - horizonFresnel) * transmission;

    let bankRadius = islandSeabedProfileRadius(waterHitPosition.xz);
    let shoreRadius = islandProfileRadius(
      waterHitPosition.xz,
      ISLAND_RADIUS
    );
    let underwaterIsland =
      (1.0 - smoothstep(0.38, 1.0, bankRadius)) *
      smoothstep(0.82, 1.12, shoreRadius);
    let bankHeight = seabedHeight(waterHitPosition.xz, p2.z);
    let shoreWaterHeight = waterSurfaceHeight(
      waterHitPosition.xz,
      waterTime,
      WATER_SCALE,
      WATER_DEPTH,
      BRACKET_WAVE_ITERATIONS
    );
    let bankDepth = max(shoreWaterHeight - bankHeight, 0.0);
    let shallowBank = exp(-bankDepth * 0.62) * underwaterIsland;
    let shoreFoamNoise = valueNoise(
      waterHitPosition.xz * 2.35 +
      vec2<f32>(waterTime * 0.035, -waterTime * 0.02)
    );
    let shoreTerrainDepth =
      shoreWaterHeight - islandHeight(waterHitPosition.xz);
    let shoreRange =
      smoothstep(0.52, 0.7, shoreRadius) *
      (1.0 - smoothstep(1.02, 1.18, shoreRadius));
    let shoreFoamBand =
      (1.0 -
        smoothstep(
          0.018,
          0.11,
          abs(shoreTerrainDepth + (shoreFoamNoise - 0.5) * 0.045)
        )) *
      shoreRange;
    let brokenShoreFoam =
      shoreFoamBand * smoothstep(0.46, 0.72, shoreFoamNoise);
    let moonBankLight =
      moonVisibility *
      nightAmount *
      max(dot(bedNormal, moonDirection), 0.0);
    let bankLightLevel = clamp(
      daylightLevel + moonBankLight * 0.028,
      0.0,
      1.0
    );
    let submergedSediment = mix(
      vec3<f32>(0.19, 0.18, 0.15),
      vec3<f32>(0.32, 0.27, 0.2),
      valueNoise(waterHitPosition.xz * 1.65 + vec2<f32>(8.0, 21.0))
    );
    let submergedSand =
      submergedSediment *
      (0.012 + 0.988 * bankLightLevel) *
      (0.72 + caustics * 0.22 * bankLightLevel);
    let lagoonScatter =
      vec3<f32>(0.018, 0.16, 0.19) *
      (0.004 + 0.996 * bankLightLevel);
    let visibleBank =
      submergedSand * exp(-WATER_ABSORPTION * min(bankDepth, 7.0)) +
      lagoonScatter * (1.0 - exp(-bankDepth * 0.75)) +
      reflection * 0.22;

    waterColor = mix(
      waterColor,
      visibleBank + reflectedSun * 0.24,
      shallowBank * mix(0.035, 0.56, bankLightLevel)
    );
    let foamLightLevel = clamp(
      daylightLevel + moonBankLight * 0.075,
      0.0,
      1.0
    );
    waterColor +=
      vec3<f32>(0.18, 0.19, 0.17) *
      brokenShoreFoam *
      mix(0.006, 0.2, foamLightLevel);

    let horizonFogDensity =
      0.00035 * (10.4 + aerosolDensity);
    let horizonProximity =
      1.0 - smoothstep(0.005, 0.6, -viewDirection.y);
    let aerialPerspective = clamp(
      (1.0 - exp(-waterDistance * horizonFogDensity)) *
        horizonProximity,
      0.0,
      1.0
    );

    hdrColor = mix(waterColor, reflection, aerialPerspective);
  }

  if (isIsland) {
    let sunAmount = smoothstep(-0.035, 0.1, sunDirection.y);
    let moonAmount = moonVisibility * nightAmount;
    let islandSunStrength = max(
      sunTransmittance.r,
      max(sunTransmittance.g, sunTransmittance.b)
    );
    let islandSunTint = mix(
      vec3<f32>(1.0),
      sunTransmittance / max(islandSunStrength, 0.0001),
      step(0.0001, islandSunStrength)
    );
    let sunDiffuse = max(dot(islandNormal, sunDirection), 0.0) * sunAmount;
    let moonDiffuse = max(dot(islandNormal, moonDirection), 0.0) * moonAmount;
    let coarseSand = valueNoise(islandHitPosition.xz * 1.7);
    let fineSand = valueNoise(islandHitPosition.xz * 8.5 + vec2<f32>(7.0, 3.0));
    let mineralFlecks = smoothstep(
      0.7,
      0.91,
      valueNoise(islandHitPosition.xz * 19.0)
    );
    let drySand = mix(
      vec3<f32>(0.35, 0.31, 0.24),
      vec3<f32>(0.52, 0.44, 0.32),
      coarseSand * 0.62 + fineSand * 0.18
    );
    let compactSand = mix(
      vec3<f32>(0.19, 0.18, 0.16),
      vec3<f32>(0.31, 0.27, 0.21),
      coarseSand
    );
    let islandWaterHeight = waterSurfaceHeight(
      islandHitPosition.xz,
      waterTime,
      WATER_SCALE,
      WATER_DEPTH,
      BRACKET_WAVE_ITERATIONS
    );
    let heightAboveWater = islandHitPosition.y - islandWaterHeight;
    let wetSand =
      1.0 - smoothstep(0.015, 0.27, heightAboveWater) +
      (fineSand - 0.5) * 0.065;
    let slopeDarkening = mix(
      0.72,
      1.0,
      smoothstep(0.45, 0.94, islandNormal.y)
    );
    let tideDepositNoise = valueNoise(
      islandHitPosition.xz * 3.2 + vec2<f32>(19.0, -7.0)
    );
    let tideDeposit =
      exp(-abs(heightAboveWater - 0.075) * 28.0) *
      smoothstep(0.54, 0.76, tideDepositNoise);
    let trunkContactDistance = distance(
      islandHitPosition.xz,
      PALM_POSITION
    );
    let trunkContactOcclusion =
      1.0 - exp(-trunkContactDistance * trunkContactDistance * 9.5) * 0.42;
    let sandAlbedo =
      mix(drySand, compactSand, clamp(wetSand, 0.0, 1.0)) *
      mix(1.0, 0.68, mineralFlecks * 0.38) *
      mix(1.0, 0.72, tideDeposit * 0.55) *
      slopeDarkening *
      trunkContactOcclusion;
    let skyFacing = mix(
      0.52,
      1.0,
      smoothstep(0.18, 0.92, islandNormal.y)
    );
    let daytimeAmbient = vec3<f32>(0.14, 0.15, 0.16);
    let nightAmbient = vec3<f32>(0.016, 0.024, 0.044);
    let skyAmbient =
      sandAlbedo *
      mix(daytimeAmbient, nightAmbient, nightAmount) *
      skyFacing;
    var sunPalmShadow = 1.0;
    if (sunAmount > 0.001) {
      sunPalmShadow = palmShadow(
        islandHitPosition + islandNormal * 0.025,
        sunDirection
      );
    }
    var moonPalmShadow = 1.0;
    if (moonAmount > 0.001) {
      moonPalmShadow = palmShadow(
        islandHitPosition + islandNormal * 0.025,
        moonDirection
      );
    }
    let directSunlight =
      sandAlbedo * islandSunTint * sunDiffuse * sunPalmShadow * 0.82;
    let moonlight =
      sandAlbedo *
      vec3<f32>(0.2, 0.29, 0.48) *
      moonDiffuse *
      moonPalmShadow *
      0.34;
    let sunHalf = normalize(sunDirection - viewDirection);
    let sunWetSpecular =
      pow(max(dot(islandNormal, sunHalf), 0.0), 42.0) *
      clamp(wetSand, 0.0, 1.0) *
      sunAmount *
      0.16;
    let moonHalf = normalize(moonDirection - viewDirection);
    let moonWetSpecular =
      pow(max(dot(islandNormal, moonHalf), 0.0), 58.0) *
      clamp(wetSand, 0.0, 1.0) *
      moonAmount *
      0.055;
    let islandColor =
      skyAmbient +
      directSunlight +
      moonlight +
      islandSunTint * sunWetSpecular +
      vec3<f32>(0.58, 0.7, 1.0) * moonWetSpecular;
    let islandHaze = clamp(
      (1.0 - exp(-islandDistance * 0.0028 * (1.0 + aerosolDensity))) * 0.42,
      0.0,
      0.48
    );

    hdrColor = mix(islandColor, atmosphereWithoutStars, islandHaze);
  }

  if (isPalm) {
    let localPalmPosition = palmLocalPosition(palmHitPosition);
    let isLeaf = palmHit.y > 1.5;
    let sunAmount = smoothstep(-0.035, 0.1, sunDirection.y);
    let moonAmount = moonVisibility * nightAmount;
    let palmSunStrength = max(
      sunTransmittance.r,
      max(sunTransmittance.g, sunTransmittance.b)
    );
    let palmSunTint = mix(
      vec3<f32>(1.0),
      sunTransmittance / max(palmSunStrength, 0.0001),
      step(0.0001, palmSunStrength)
    );
    let barkAngle = atan2(localPalmPosition.z, localPalmPosition.x);
    let barkBands =
      0.5 +
      0.5 * sin(localPalmPosition.y * 11.8 + barkAngle * 2.3);
    let barkGrain = valueNoise(vec2<f32>(
      barkAngle * 2.1 + 8.0,
      localPalmPosition.y * 3.7
    ));
    let trunkAlbedo = mix(
      vec3<f32>(0.13, 0.055, 0.018),
      vec3<f32>(0.43, 0.19, 0.052),
      barkGrain * 0.5 + barkBands * 0.26
    );
    let leafAlbedo = vec3<f32>(0.15, 0.36, 0.045);
    let palmAlbedo = select(trunkAlbedo, leafAlbedo, isLeaf);
    let frontSun = max(dot(palmNormal, sunDirection), 0.0);
    let backSun = max(dot(-palmNormal, sunDirection), 0.0);
    let frontMoon = max(dot(palmNormal, moonDirection), 0.0);
    let backMoon = max(dot(-palmNormal, moonDirection), 0.0);
    let sunDiffuse = select(
      frontSun,
      frontSun + backSun * 0.28,
      isLeaf
    ) * sunAmount;
    let moonDiffuse = select(
      frontMoon,
      frontMoon + backMoon * 0.22,
      isLeaf
    ) * moonAmount;
    let skyFacing = select(
      0.42 + 0.58 * max(palmNormal.y, 0.0),
      0.68 + 0.32 * abs(palmNormal.y),
      isLeaf
    );
    let palmAmbient =
      palmAlbedo *
      mix(
        vec3<f32>(0.13, 0.145, 0.15),
        vec3<f32>(0.012, 0.02, 0.038),
        nightAmount
      ) *
      skyFacing;
    let palmSunlight =
      palmAlbedo * palmSunTint * sunDiffuse * 0.92;
    let palmMoonlight =
      palmAlbedo *
      vec3<f32>(0.22, 0.32, 0.52) *
      moonDiffuse *
      0.42;
    let leafBacklight = select(
      vec3<f32>(0.0),
      leafAlbedo *
        palmSunTint *
        backSun *
        sunAmount *
        0.18,
      isLeaf
    );
    let leafNightDimming = select(
      1.0,
      mix(1.0, 0.3, nightAmount),
      isLeaf
    );
    let palmColor =
      (palmAmbient + palmSunlight + palmMoonlight + leafBacklight) *
      leafNightDimming;
    let palmHaze = clamp(
      (1.0 - exp(-palmHit.x * 0.0028 * (1.0 + aerosolDensity))) * 0.42,
      0.0,
      0.48
    );

    hdrColor = mix(palmColor, atmosphereWithoutStars, palmHaze);
  }

  let mapped = acesToneMap(max(hdrColor * max(p0.w, 0.0), vec3<f32>(0.0)));
  let displayColor = pow(mapped, vec3<f32>(1.0 / 2.2));

  return vec4f(displayColor, 1.0);
}
