fn palmTrunkBend(height: f32) -> vec2<f32> {
    let t = clamp(height / PALM_HEIGHT, 0.0, 1.0);

    let sidewaysBend = -0.32 * sin(PI * t) +
    0.32 * t * t;

    let towardCamera = -0.16 * t -
    1.18 * t * t;

    return vec2<f32>(sidewaysBend, towardCamera);
}

fn palmLocalPosition(position: vec3<f32>) -> vec3<f32> {
    let baseHeight = islandHeight(PALM_POSITION);

    return position - vec3<f32>(PALM_POSITION.x, baseHeight, PALM_POSITION.y);
}

fn palmTrunkDistance(localPosition: vec3<f32>) -> f32 {
    let height = clamp(localPosition.y, 0.0, PALM_HEIGHT);
    let t = height / PALM_HEIGHT;
    let bend = palmTrunkBend(height);
    let radialPosition = localPosition.xz - bend;
    let barkAngle = atan2(radialPosition.y, radialPosition.x);
    let ringSignal = 0.5 +
    0.5 * sin(localPosition.y * 10.8 + sin(barkAngle * 3.0) * 0.18);
    let leafScarRidges = pow(ringSignal, 9.0) * 0.018;
    let verticalFibers = sin(barkAngle * 19.0 + localPosition.y * 0.7) * 0.0035;
    let radius = mix(0.87, 0.3, pow(t, 0.72)) +
    leafScarRidges +
    verticalFibers;
    let radialDistance = length(radialPosition) - radius;
    let verticalDistance = max(-localPosition.y, localPosition.y - PALM_HEIGHT);

    return max(radialDistance, verticalDistance);
}

fn palmLeafDistance(
    crownPosition: vec3<f32>,
    angle: f32,
    lengthScale: f32,
    droop: f32,
    lift: f32
) -> f32 {
    let crownTilt = 0.68;
    let tiltCosine = cos(crownTilt);
    let tiltSine = sin(crownTilt);
    let tiltedCrownPosition = vec3<f32>(
        crownPosition.x,
        tiltCosine * crownPosition.y - tiltSine * crownPosition.z,
        tiltSine * crownPosition.y + tiltCosine * crownPosition.z
    );
    let cosine = cos(angle);
    let sine = sin(angle);
    let leafPosition = vec3<f32>(
        cosine * tiltedCrownPosition.x + sine * tiltedCrownPosition.z,
        tiltedCrownPosition.y,
        -sine * tiltedCrownPosition.x + cosine * tiltedCrownPosition.z
    );
    let leafLength = 2.55 * lengthScale;
    let along = clamp(leafPosition.x, 0.0, leafLength);
    let u = along / leafLength;
    let arch = lift * sin(u * PI * 0.72) -
    droop * u * u +
    0.12 * u;
    let leafBody = pow(max(sin(u * PI), 0.0), 0.58);
    let bladeWidth = (0.065 + leafBody * 0.54) *
    (1.0 - 0.18 * u);
    let bladeThickness = 0.085 + leafBody * 0.035;
    let lateralPosition =
        abs(leafPosition.z) / max(bladeWidth, 0.012);
    let centerGroove =
        (1.0 - smoothstep(0.0, 0.48, lateralPosition)) *
        leafBody;
    let groovedArch = arch - centerGroove * 0.052;
    let crossSection = length(vec2<f32>(
        (leafPosition.y - groovedArch) / bladeThickness,
        leafPosition.z / max(bladeWidth, 0.012)
    )) - 1.0;
    let crossDistance = crossSection * min(bladeThickness, bladeWidth);
    let endDistance = max(-leafPosition.x, leafPosition.x - leafLength);
    let bladeDistance = max(crossDistance, endDistance);
    let rachisCross = length(vec2<f32>(
        leafPosition.y - (groovedArch - 0.018),
        leafPosition.z
    )) - 0.024;
    let rachisDistance = max(rachisCross, endDistance);

    return min(bladeDistance, rachisDistance);
}

fn palmMap(position: vec3<f32>) -> vec2<f32> {
    let localPosition = palmLocalPosition(position);
    let crownBend = palmTrunkBend(PALM_HEIGHT);
    let crownPosition = localPosition - vec3<f32>(crownBend.x, PALM_HEIGHT, crownBend.y);
    var distance = palmTrunkDistance(localPosition);
    var material = 1.0;

    for (var leaf = 0; leaf < PALM_LEAF_COUNT; leaf = leaf + 1) {
        let leafSeed = f32(leaf);
        let angle = leafSeed / f32(PALM_LEAF_COUNT) * 2.0 * PI +
      (hash21(vec2<f32>(leafSeed, 7.1)) - 0.5) * 0.22;
        let lengthScale = mix(
            0.88,
            1.08,
            hash21(vec2<f32>(leafSeed + 13.0, 2.7))
        );
        let droop = mix(
            0.52,
            0.9,
            hash21(vec2<f32>(leafSeed + 29.0, 5.4))
        );
        let lift = mix(
            0.34,
            0.92,
            hash21(vec2<f32>(leafSeed + 47.0, 9.2))
        );
        let leafDistance = palmLeafDistance(
            crownPosition,
            angle,
            lengthScale,
            droop,
            lift
        );

        if leafDistance < distance {
            distance = leafDistance;
            material = 2.0;
        }
    }

    return vec2<f32>(distance, material);
}

fn intersectPalm(
    rayOrigin: vec3<f32>,
    rayDirection: vec3<f32>
) -> vec2<f32> {
    let baseHeight = islandHeight(PALM_POSITION);
    let boundsCenter = vec3<f32>(
        PALM_POSITION.x + 0.2,
        baseHeight + PALM_HEIGHT * 0.58,
        PALM_POSITION.y - 0.08
    );
    let relativeOrigin = rayOrigin - boundsCenter;
    let boundsRadius = 5.7;
    let b = dot(relativeOrigin, rayDirection);
    let c = dot(relativeOrigin, relativeOrigin) - boundsRadius * boundsRadius;
    let discriminant = b * b - c;

    if discriminant < 0.0 {
        return vec2<f32>(-1.0, 0.0);
    }

    let root = sqrt(discriminant);
    var distanceAlongRay = max(-b - root, 0.0);
    let maximumDistance = -b + root;
    var material = 0.0;

    for (var step = 0; step < PALM_MARCH_STEPS; step = step + 1) {
        let sample = palmMap(rayOrigin + rayDirection * distanceAlongRay);

        if sample.x < 0.008 {
            material = sample.y;
            break;
        }

        distanceAlongRay += max(sample.x * 0.72, 0.006);
        if distanceAlongRay > maximumDistance {
            break;
        }
    }

    return select(
        vec2<f32>(-1.0, 0.0),
        vec2<f32>(distanceAlongRay, material),
        material > 0.0 && distanceAlongRay <= maximumDistance
    );
}

fn palmSurfaceNormal(position: vec3<f32>) -> vec3<f32> {
    let epsilon = 0.012;
    let xOffset = vec3<f32>(epsilon, 0.0, 0.0);
    let yOffset = vec3<f32>(0.0, epsilon, 0.0);
    let zOffset = vec3<f32>(0.0, 0.0, epsilon);

    return normalize(vec3<f32>(
        palmMap(position + xOffset).x - palmMap(position - xOffset).x,
        palmMap(position + yOffset).x - palmMap(position - yOffset).x,
        palmMap(position + zOffset).x - palmMap(position - zOffset).x
    ));
}

fn palmShadow(
    surfacePosition: vec3<f32>,
    lightDirection: vec3<f32>
) -> f32 {
    var distanceAlongRay = 0.035;
    var visibility = 1.0;

    for (var step = 0; step < 18; step = step + 1) {
        let sampleDistance = palmMap(
            surfacePosition + lightDirection * distanceAlongRay
        ).x;

        if sampleDistance < 0.006 {
            return 0.12;
        }

        visibility = min(visibility, 9.0 * sampleDistance / distanceAlongRay);
        distanceAlongRay += clamp(sampleDistance, 0.025, 0.65);
        if distanceAlongRay > 12.0 {
            break;
        }
    }

    return clamp(visibility, 0.12, 1.0);
}
