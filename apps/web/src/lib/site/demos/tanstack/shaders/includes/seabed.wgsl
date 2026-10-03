fn cheapWaterCaustics(position: vec2<f32>, time: f32) -> f32 {
  let drift = vec2<f32>(time * 0.055, -time * 0.038);
  let p = position * 3.7 + drift;
  let warp = vec2<f32>(
    valueNoise(p * 0.23),
    valueNoise(p * 0.23 + vec2<f32>(17.4, 5.8))
  ) - vec2<f32>(0.5);
  let q = p + warp * 2.4;
  let waveA = sin(q.x * 1.27 + sin(q.y * 0.93 + time * 0.31));
  let waveB = sin(q.y * 1.41 + sin(q.x * 1.08 - time * 0.27));
  let waveC = sin(dot(q, vec2<f32>(0.73, 0.91)) - time * 0.19);
  let cell = abs(waveA + waveB * 0.64 + waveC * 0.24);
  let ridge = 1.0 - smoothstep(0.1, 0.72, cell);

  return ridge * ridge * (0.7 + 0.3 * valueNoise(position * 0.52));
}

fn seabedNoise(position: vec2<f32>) -> f32 {
  var p = position;
  var amplitude = 0.54;
  var total = 0.0;
  var weight = 0.0;

  for (var octave = 0; octave < 4; octave = octave + 1) {
    total += valueNoise(p) * amplitude;
    weight += amplitude;
    p = vec2<f32>(
      p.x * 1.71 - p.y * 1.16,
      p.x * 1.16 + p.y * 1.71
    ) + vec2<f32>(7.3, 13.1);
    amplitude *= 0.48;
  }

  return total / max(weight, 0.0001);
}

fn seabedHeight(position: vec2<f32>, seabedLevel: f32) -> f32 {
  let macroShape = seabedNoise(position * 0.055);
  let duneWarp = seabedNoise(position * 0.14 + vec2<f32>(23.0, -9.0));
  let dunePhase =
    dot(position, vec2<f32>(0.29, 0.17)) + (duneWarp - 0.5) * 2.2;
  let broadDunes = sin(dunePhase) * 0.16;
  let ripplePhase =
    dot(position, vec2<f32>(1.76, -0.34)) + duneWarp * 2.6;
  let fineRipples = sin(ripplePhase) * 0.025;
  let naturalSeabed =
    seabedLevel +
    (macroShape - 0.5) * 0.9 +
    broadDunes +
    fineRipples;
  let shoreRadius = islandProfileRadius(position, ISLAND_RADIUS);
  let seabedRadius = islandSeabedProfileRadius(position);
  let distanceFromShore = max(shoreRadius - 1.0, 0.0);
  let distanceToSeabedEdge = max(1.0 - seabedRadius, 0.0);
  let slopeCoordinate =
    distanceFromShore /
    max(distanceFromShore + distanceToSeabedEdge, 0.0001);
  let slopeProgress = smoothstep(0.0, 1.0, slopeCoordinate);
  let shelfToFloor = pow(slopeProgress, ISLAND_SEABED_SLOPE_POWER);
  let bankVariation =
    (seabedNoise(position * 0.18 + vec2<f32>(31.0, -12.0)) - 0.5) *
    0.18 *
    sin(slopeProgress * PI);
  let islandFoundation =
    mix(-0.19, naturalSeabed, shelfToFloor) + bankVariation;

  return max(naturalSeabed, islandFoundation);
}

fn seabedNormal(position: vec2<f32>, seabedLevel: f32) -> vec3<f32> {
  let epsilon = 0.12;
  let heightLeft = seabedHeight(position - vec2<f32>(epsilon, 0.0), seabedLevel);
  let heightRight = seabedHeight(position + vec2<f32>(epsilon, 0.0), seabedLevel);
  let heightBack = seabedHeight(position - vec2<f32>(0.0, epsilon), seabedLevel);
  let heightFront = seabedHeight(position + vec2<f32>(0.0, epsilon), seabedLevel);

  return normalize(vec3<f32>(
    heightLeft - heightRight,
    2.0 * epsilon,
    heightBack - heightFront
  ));
}

fn intersectSeabed(
  rayOrigin: vec3<f32>,
  rayDirection: vec3<f32>,
  seabedLevel: f32
) -> f32 {
  let maximumDistance = 32.0;
  var lowerDistance = 0.0;
  var upperDistance = maximumDistance;
  var previousDistance = 0.0;
  var foundBracket = false;

  for (var step = 1; step <= 16; step = step + 1) {
    let candidateDistance = maximumDistance * f32(step) / 16.0;
    let candidatePosition = rayOrigin + rayDirection * candidateDistance;
    let candidateGap =
      candidatePosition.y - seabedHeight(candidatePosition.xz, seabedLevel);

    if (candidateGap <= 0.0) {
      lowerDistance = previousDistance;
      upperDistance = candidateDistance;
      foundBracket = true;
      break;
    }

    previousDistance = candidateDistance;
  }

  if (!foundBracket) {
    return maximumDistance;
  }

  for (var step = 0; step < 5; step = step + 1) {
    let middleDistance = 0.5 * (lowerDistance + upperDistance);
    let middlePosition = rayOrigin + rayDirection * middleDistance;
    let middleGap =
      middlePosition.y - seabedHeight(middlePosition.xz, seabedLevel);

    if (middleGap > 0.0) {
      lowerDistance = middleDistance;
    } else {
      upperDistance = middleDistance;
    }
  }

  return 0.5 * (lowerDistance + upperDistance);
}

