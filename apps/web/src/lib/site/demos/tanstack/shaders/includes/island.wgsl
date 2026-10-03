fn islandProfileRadius(position: vec2<f32>, radius: vec2<f32>) -> f32 {
  let local = (position - ISLAND_CENTER) / ISLAND_RADIUS;
  var scaledLocal = (position - ISLAND_CENTER) / radius;
  scaledLocal.x += scaledLocal.y * 0.065;
  let broadWarp =
    (valueNoise(position * 0.19 + vec2<f32>(4.0, 11.0)) - 0.5) * 0.15;
  let shoreWarp =
    (valueNoise(position * 0.67 + vec2<f32>(17.0, -3.0)) - 0.5) * 0.055;
  let directionalWarp =
    sin(atan2(local.y, local.x) * 3.0 + 0.7) * 0.035 +
    sin(atan2(local.y, local.x) * 5.0 - 1.1) * 0.018;

  return length(scaledLocal) + broadWarp + shoreWarp + directionalWarp;
}

fn islandSeabedProfileRadius(position: vec2<f32>) -> f32 {
  let centered = position - ISLAND_CENTER - ISLAND_SEABED_OFFSET;
  let cosine = cos(ISLAND_SEABED_ROTATION);
  let sine = sin(ISLAND_SEABED_ROTATION);
  let rotated = vec2<f32>(
    cosine * centered.x + sine * centered.y,
    -sine * centered.x + cosine * centered.y
  );
  let broadWarp =
    (valueNoise(position * 0.12 + vec2<f32>(4.0, 11.0)) - 0.5) * 0.11;
  let edgeWarp =
    (valueNoise(position * 0.38 + vec2<f32>(17.0, -3.0)) - 0.5) * 0.045;

  return length(rotated / ISLAND_SEABED_RADIUS) + broadWarp + edgeWarp;
}

fn islandHeight(position: vec2<f32>) -> f32 {
  let profileRadius = islandProfileRadius(position, ISLAND_RADIUS);
  let mound = max(1.0 - profileRadius * profileRadius, 0.0);
  let duneLocalA =
    (position - ISLAND_CENTER - vec2<f32>(0.45, -0.2)) /
    vec2<f32>(2.65, 1.55);
  let duneLocalB =
    (position - ISLAND_CENTER - vec2<f32>(-1.7, 0.55)) /
    vec2<f32>(1.65, 1.05);
  let duneRidgeA = exp(-dot(duneLocalA, duneLocalA) * 1.35) * 0.23;
  let duneRidgeB = exp(-dot(duneLocalB, duneLocalB) * 1.7) * 0.1;
  let sandFlat = smoothstep(0.025, 0.58, mound) * 0.32;
  let broadDeposits =
    (valueNoise(position * 0.42 + vec2<f32>(9.0, 2.0)) - 0.5) *
    0.065 *
    mound;
  let windRipples =
    sin(dot(position, vec2<f32>(2.8, 0.72)) +
      valueNoise(position * 0.8) * 2.4) *
    0.012 *
    smoothstep(0.08, 0.7, mound);
  let granularRelief =
    (valueNoise(position * 5.6 + vec2<f32>(4.0, 11.0)) - 0.5) *
    0.018 *
    mound;

  return
    -0.19 +
    sandFlat +
    (duneRidgeA + duneRidgeB) * smoothstep(0.04, 0.42, mound) +
    broadDeposits +
    windRipples +
    granularRelief;
}

fn islandSurfaceNormal(position: vec2<f32>) -> vec3<f32> {
  let epsilon = 0.035;
  let heightLeft = islandHeight(position - vec2<f32>(epsilon, 0.0));
  let heightRight = islandHeight(position + vec2<f32>(epsilon, 0.0));
  let heightBack = islandHeight(position - vec2<f32>(0.0, epsilon));
  let heightFront = islandHeight(position + vec2<f32>(0.0, epsilon));

  return normalize(vec3<f32>(
    heightLeft - heightRight,
    2.0 * epsilon,
    heightBack - heightFront
  ));
}

fn intersectIsland(
  rayOrigin: vec3<f32>,
  rayDirection: vec3<f32>,
  maximumDistance: f32
) -> f32 {
  let startDistance = 38.0;
  let endDistance = min(maximumDistance, 58.0);

  if (endDistance <= startDistance) {
    return -1.0;
  }

  var previousDistance = startDistance;
  var previousPosition = rayOrigin + rayDirection * previousDistance;
  var previousGap = previousPosition.y - islandHeight(previousPosition.xz);
  var lowerDistance = startDistance;
  var upperDistance = endDistance;
  var foundBracket = false;

  for (var step = 1; step <= 24; step = step + 1) {
    let candidateDistance =
      mix(startDistance, endDistance, f32(step) / 24.0);
    let candidatePosition = rayOrigin + rayDirection * candidateDistance;
    let candidateGap =
      candidatePosition.y - islandHeight(candidatePosition.xz);

    if (previousGap > 0.0 && candidateGap <= 0.0) {
      lowerDistance = previousDistance;
      upperDistance = candidateDistance;
      foundBracket = true;
      break;
    }

    previousDistance = candidateDistance;
    previousGap = candidateGap;
  }

  if (!foundBracket) {
    return -1.0;
  }

  for (var step = 0; step < 6; step = step + 1) {
    let middleDistance = 0.5 * (lowerDistance + upperDistance);
    let middlePosition = rayOrigin + rayDirection * middleDistance;
    let middleGap = middlePosition.y - islandHeight(middlePosition.xz);

    if (middleGap > 0.0) {
      lowerDistance = middleDistance;
    } else {
      upperDistance = middleDistance;
    }
  }

  let hitDistance = 0.5 * (lowerDistance + upperDistance);
  let hitPosition = rayOrigin + rayDirection * hitDistance;
  let profileRadius = islandProfileRadius(hitPosition.xz, ISLAND_RADIUS);

  return select(hitDistance, -1.0, profileRadius > 1.0);
}

