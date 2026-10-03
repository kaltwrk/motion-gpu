fn waveDx(
  position: vec2<f32>,
  direction: vec2<f32>,
  frequency: f32,
  timeShift: f32
) -> vec2<f32> {
  let phase = dot(direction, position) * frequency + timeShift;
  let wave = exp(sin(phase) - 1.0);
  let derivative = wave * cos(phase);

  return vec2<f32>(wave, -derivative);
}

fn waterWaveHeight(
  positionInput: vec2<f32>,
  time: f32,
  iterationCount: i32
) -> f32 {
  var position = positionInput;
  let wavePhaseShift = length(position) * 0.1;
  var frequency = 1.0;
  var timeMultiplier = 2.0;
  var weight = 1.0;
  var valueSum = 0.0;
  var weightSum = 0.0;

  for (
    var octave = 0;
    octave < INTERSECTION_WAVE_ITERATIONS;
    octave = octave + 1
  ) {
    if (octave >= iterationCount) {
      break;
    }

    let direction = WAVE_DIRECTIONS[octave];
    let wave = waveDx(
      position,
      direction,
      frequency,
      time * timeMultiplier + wavePhaseShift
    );
    position += direction * wave.y * weight * 0.408;
    valueSum += wave.x * weight;
    weightSum += weight;
    weight *= 0.8;
    frequency *= 1.189;
    timeMultiplier *= 1.07;
  }

  return valueSum / max(weightSum, 0.0001);
}

fn waterWaveHeightAndGradient(
  positionInput: vec2<f32>,
  time: f32,
  iterationCount: i32
) -> vec3<f32> {
  var position = positionInput;
  let wavePhaseShift = length(position) * 0.1;
  var frequency = 1.0;
  var timeMultiplier = 2.0;
  var weight = 1.0;
  var valueSum = 0.0;
  var gradientSum = vec2<f32>(0.0);
  var weightSum = 0.0;

  for (
    var octave = 0;
    octave < MAX_NORMAL_WAVE_ITERATIONS;
    octave = octave + 1
  ) {
    if (octave >= iterationCount) {
      break;
    }

    let direction = WAVE_DIRECTIONS[octave];
    let wave = waveDx(
      position,
      direction,
      frequency,
      time * timeMultiplier + wavePhaseShift
    );
    position += direction * wave.y * weight * 0.408;
    valueSum += wave.x * weight;
    gradientSum += direction * frequency * (-wave.y) * weight;
    weightSum += weight;
    weight *= 0.8;
    frequency *= 1.189;
    timeMultiplier *= 1.07;
  }

  let inverseWeight = 1.0 / max(weightSum, 0.0001);

  return vec3<f32>(valueSum, gradientSum) * inverseWeight;
}

fn waterSurfaceHeight(
  position: vec2<f32>,
  time: f32,
  scale: f32,
  depth: f32,
  waveIterationCount: i32
) -> f32 {
  let waveHeight = waterWaveHeight(
    position / max(scale, 0.05),
    time,
    waveIterationCount
  );

  return waveHeight * depth - depth;
}

fn waterSurfaceGap(
  position: vec3<f32>,
  time: f32,
  scale: f32,
  depth: f32,
  waveIterationCount: i32
) -> f32 {
  return
    position.y -
    waterSurfaceHeight(
      position.xz,
      time,
      scale,
      depth,
      waveIterationCount
    ) -
    0.01;
}

fn intersectWater(
  camera: vec3<f32>,
  start: vec3<f32>,
  end: vec3<f32>,
  time: f32,
  scale: f32,
  depth: f32
) -> f32 {
  let direction = normalize(end - start);
  let maximumDistance = distance(start, end);
  let startDistance = distance(start, camera);
  let startGap = waterSurfaceGap(
    start,
    time,
    scale,
    depth,
    INTERSECTION_WAVE_ITERATIONS
  );

  if (startGap <= 0.0) {
    return startDistance;
  }

  var lowerDistance = 0.0;
  var upperDistance = maximumDistance;
  var previousDistance = 0.0;
  var foundBracket = false;

  for (var step = 1; step <= WATER_BRACKET_STEPS; step = step + 1) {
    let candidateDistance =
      maximumDistance * f32(step) / f32(WATER_BRACKET_STEPS);
    let candidatePosition = start + direction * candidateDistance;
    let candidateGap = waterSurfaceGap(
      candidatePosition,
      time,
      scale,
      depth,
      BRACKET_WAVE_ITERATIONS
    );

    if (candidateGap <= 0.0) {
      lowerDistance = previousDistance;
      upperDistance = candidateDistance;
      foundBracket = true;
      break;
    }

    previousDistance = candidateDistance;
  }

  if (!foundBracket) {
    return startDistance;
  }

  for (
    var step = 0;
    step < WATER_REFINEMENT_STEPS;
    step = step + 1
  ) {
    let middleDistance = 0.5 * (lowerDistance + upperDistance);
    let middlePosition = start + direction * middleDistance;
    let middleGap = waterSurfaceGap(
      middlePosition,
      time,
      scale,
      depth,
      INTERSECTION_WAVE_ITERATIONS
    );

    if (middleGap > 0.0) {
      lowerDistance = middleDistance;
    } else {
      upperDistance = middleDistance;
    }
  }

  return startDistance + 0.5 * (lowerDistance + upperDistance);
}

fn waterSurfaceNormal(
  position: vec2<f32>,
  distanceToWater: f32,
  time: f32,
  scale: f32,
  depth: f32
) -> vec3<f32> {
  let iterationCount = select(
    select(8, 16, distanceToWater < 160.0),
    MAX_NORMAL_WAVE_ITERATIONS,
    distanceToWater < 35.0
  );
  let safeScale = max(scale, 0.05);
  let waves = waterWaveHeightAndGradient(
    position / safeScale,
    time,
    iterationCount
  );
  let gradient = waves.yz * depth / safeScale;
  let detailedNormal = normalize(vec3<f32>(-gradient.x, 1.0, -gradient.y));
  let distanceSmoothing =
    0.96 * min(1.0, sqrt(max(distanceToWater, 0.0) * 0.01) * 1.1);

  return normalize(mix(
    detailedNormal,
    vec3<f32>(0.0, 1.0, 0.0),
    distanceSmoothing
  ));
}

