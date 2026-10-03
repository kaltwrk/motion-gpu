fn starHash22(point: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(
        hash21(point + vec2<f32>(17.13, 91.71)),
        hash21(point + vec2<f32>(63.29, 11.47))
    );
}

fn nightStarLayer(
    viewDirection: vec3<f32>,
    resolution: vec2<f32>,
    gridScale: f32,
    layerSeed: f32,
    time: f32,
    density: f32,
    size: f32
) -> vec3<f32> {
    let skyPoint = vec2<f32>(
        atan2(viewDirection.x, viewDirection.z) / PI,
        asin(clamp(viewDirection.y, -1.0, 1.0)) / PI
    );
    let gridPoint = skyPoint * gridScale;
    let cell = floor(gridPoint);
    let local = fract(gridPoint) - vec2<f32>(0.5);
    let safeSize = max(size, 0.05);
    let antiAlias = max(
        0.14 * gridScale / max(min(resolution.x, resolution.y), 1.0),
        0.00065
    );
    var layerRadiance = vec3<f32>(0.0);

    for (var neighborY = -1; neighborY <= 1; neighborY = neighborY + 1) {
        for (var neighborX = -1; neighborX <= 1; neighborX = neighborX + 1) {
            let neighborOffset = vec2<f32>(f32(neighborX), f32(neighborY));
            let seedCell = cell +
        neighborOffset +
        vec2<f32>(layerSeed * 31.7, layerSeed * 67.3);
            let jitter = (starHash22(seedCell) - vec2<f32>(0.5)) * 0.76;
            let delta = local - neighborOffset - jitter;
            let distanceToStar = length(delta);
            let birth = hash21(seedCell + vec2<f32>(41.3, 13.1));
            let starEnabled = step(
                1.0 - clamp(density * 0.16, 0.0, 0.32),
                birth
            );
            let character = hash21(seedCell + vec2<f32>(7.9, 103.1));
            let brightness = pow(character, 3.6);
            let radius = mix(0.0035, 0.014, brightness) * safeSize;
            let core = 1.0 - smoothstep(
                radius - antiAlias,
                radius + antiAlias,
                distanceToStar
            );
            let halo = exp(
                -distanceToStar * mix(31.0, 18.0, brightness) / safeSize
            ) * brightness * 0.045;
            let pulseRate = mix(
                0.8,
                3.2,
                hash21(seedCell + vec2<f32>(53.7, 5.3))
            );
            let pulsePhase = hash21(seedCell + vec2<f32>(19.4, 71.2)) * 2.0 * PI;
            let pulseSignal = 0.5 + 0.5 * sin(time * pulseRate + pulsePhase);
            let basePulse = mix(0.78, 1.12, pulseSignal);
            let sparkleGate = smoothstep(0.62, 1.0, brightness);
            let sparkle = pow(pulseSignal, 10.0) * sparkleGate * 0.72;
            let twinkle = basePulse + sparkle;
            let temperature = hash21(seedCell + vec2<f32>(83.2, 29.6));
            let coolColor = vec3<f32>(0.62, 0.76, 1.0);
            let warmColor = vec3<f32>(1.0, 0.82, 0.62);
            let starColor = mix(coolColor, warmColor, vec3<f32>(temperature));

            layerRadiance += starColor *
        starEnabled *
        twinkle *
        (core * mix(0.8, 2.6, brightness) + halo);
        }
    }

    return layerRadiance;
}

fn nightEnvironmentRadiance(
    viewDirection: vec3<f32>,
    nightAmount: f32
) -> vec3<f32> {
    let altitude = clamp(viewDirection.y, 0.0, 1.0);
    let visibleSkyHeight = clamp(altitude / 0.22, 0.0, 1.0);
    let zenith = vec3<f32>(0.00012, 0.0002, 0.00048);
    let lowerSky = vec3<f32>(0.0038, 0.0052, 0.0215);
    let verticalGradient = mix(
        lowerSky,
        zenith,
        smoothstep(0.16, 0.96, visibleSkyHeight)
    );
    let horizonBand = exp(-visibleSkyHeight * 7.5);
    let twilightMauve = vec3<f32>(0.01, 0.01, 0.018) * horizonBand;
    let lowerAtmosphere = vec3<f32>(0.0012, 0.0017, 0.0038) *
    (1.0 - smoothstep(0.12, 0.68, visibleSkyHeight));
    let airglow = verticalGradient + twilightMauve + lowerAtmosphere;

    return airglow * nightAmount;
}

fn nightStarRadiance(
    viewDirection: vec3<f32>,
    moonDirection: vec3<f32>,
    nightAmount: f32,
    resolution: vec2<f32>,
    time: f32,
    density: f32,
    size: f32,
    brightness: f32
) -> vec3<f32> {
    if nightAmount <= 0.001 {
        return vec3<f32>(0.0);
    }

    let altitude = clamp(viewDirection.y, 0.0, 1.0);
    let moonAlignment = max(dot(viewDirection, moonDirection), 0.0);
    var stars = vec3<f32>(0.0);
    stars += nightStarLayer(
        viewDirection,
        resolution,
        61.0,
        1.0,
        time,
        density,
        size
    );
    stars += nightStarLayer(
        viewDirection,
        resolution,
        109.0,
        2.0,
        time,
        density,
        size
    );
    stars += nightStarLayer(
        viewDirection,
        resolution,
        173.0,
        3.0,
        time,
        density,
        size
    );
    let horizonFade = smoothstep(0.04, 0.12, altitude);
    let horizonVisibility = horizonFade * horizonFade;
    let moonWashout = 1.0 - smoothstep(0.82, 0.995, moonAlignment) * 0.82;
    let starVisibility = nightAmount * horizonVisibility * moonWashout;

    return stars * starVisibility * max(brightness, 0.0);
}
