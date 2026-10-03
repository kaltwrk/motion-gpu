const PI: f32 = 3.141592653589793;
const DEG_TO_RAD: f32 = 0.017453292519943295;
const PLANET_RADIUS: f32 = 6371.0;
const ATMOSPHERE_RADIUS: f32 = 6471.0;
const RAYLEIGH_SCALE_HEIGHT: f32 = 8.0;
const MIE_SCALE_HEIGHT: f32 = 1.2;
const OZONE_HEIGHT: f32 = 25.0;
const OZONE_WIDTH: f32 = 15.0;
const MULTI_SCATTER_STRENGTH: f32 = 0.95;
const MULTI_SCATTER_DESATURATION: f32 = 0.5;
const MAX_SUN_ELEVATION: f32 = 10.0;
const MAX_SUN_AZIMUTH: f32 = 10.0;
const MAX_MOON_ELEVATION: f32 = 10.0;
const OBSERVER_ALTITUDE: f32 = 0.2;
const PRIMARY_STEPS: i32 = 64;
const LIGHT_STEPS: i32 = 6;
const ATMOSPHERE_LUT_WIDTH: u32 = 256u;
const ATMOSPHERE_LUT_HEIGHT: u32 = 128u;

fn raySphereIntersect(
    rayOrigin: vec3<f32>,
    rayDirection: vec3<f32>,
    radius: f32
) -> vec2<f32> {
    let b = dot(rayOrigin, rayDirection);
    let c = dot(rayOrigin, rayOrigin) - radius * radius;
    let discriminant = b * b - c;

    if discriminant < 0.0 {
        return vec2<f32>(-1.0);
    }

    let root = sqrt(discriminant);
    return vec2<f32>(-b - root, -b + root);
}

fn atmosphereDensities(height: f32) -> vec3<f32> {
    let altitude = max(height, 0.0);
    let rayleigh = exp(-altitude / RAYLEIGH_SCALE_HEIGHT);
    let mie = exp(-altitude / MIE_SCALE_HEIGHT);
    let ozone = max(0.0, 1.0 - abs(altitude - OZONE_HEIGHT) / OZONE_WIDTH);

    return vec3<f32>(rayleigh, mie, ozone);
}

fn rayleighPhase(mu: f32) -> f32 {
    return 3.0 / (16.0 * PI) * (1.0 + mu * mu);
}

fn miePhase(mu: f32, directionality: f32) -> f32 {
    let g = clamp(directionality, 0.0, 0.95);
    let gg = g * g;
    let numerator = 3.0 * (1.0 - gg) * (1.0 + mu * mu);
    let phaseBase = max(1.0 + gg - 2.0 * g * mu, 0.0001);
    let denominator = 8.0 * PI * (2.0 + gg) * phaseBase * sqrt(phaseBase);

    return numerator / denominator;
}

fn lightOpticalDepth(
    samplePosition: vec3<f32>,
    sunDirection: vec3<f32>,
    stepCount: i32
) -> vec4<f32> {
    let planetHit = raySphereIntersect(samplePosition, sunDirection, PLANET_RADIUS);

    if planetHit.x > 0.001 {
        return vec4<f32>(0.0);
    }

    let atmosphereHit = raySphereIntersect(samplePosition, sunDirection, ATMOSPHERE_RADIUS);
    let marchDistance = max(atmosphereHit.y, 0.0);
    let stepLength = marchDistance / f32(stepCount);
    var opticalDepth = vec3<f32>(0.0);

    for (var step = 0; step < LIGHT_STEPS; step = step + 1) {
        if step >= stepCount {
            break;
        }

        let distanceAlongRay = (f32(step) + 0.5) * stepLength;
        let position = samplePosition + sunDirection * distanceAlongRay;
        let height = length(position) - PLANET_RADIUS;
        opticalDepth += atmosphereDensities(height) * stepLength;
    }

    return vec4<f32>(opticalDepth, 1.0);
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
    let elevationRadians = sin(lunarPhase) * MAX_MOON_ELEVATION * DEG_TO_RAD;
    let azimuthRadians = -sin(hourAngle) * MAX_SUN_AZIMUTH * DEG_TO_RAD;
    let horizontal = cos(elevationRadians);

    return vec3<f32>(
        sin(azimuthRadians) * horizontal,
        sin(elevationRadians),
        cos(azimuthRadians) * horizontal
    );
}

fn observerSunTransmittance(
    rayOrigin: vec3<f32>,
    sunDirection: vec3<f32>,
    betaRayleigh: vec3<f32>,
    betaMieExtinction: vec3<f32>,
    betaOzoneAbsorption: vec3<f32>
) -> vec3<f32> {
    let sunDepth = lightOpticalDepth(rayOrigin, sunDirection, LIGHT_STEPS);
    let sunTau = betaRayleigh * sunDepth.x +
    betaMieExtinction * sunDepth.y +
    betaOzoneAbsorption * sunDepth.z;

    return exp(-sunTau) * sunDepth.w;
}

fn renderAtmosphere(
    rayOrigin: vec3<f32>,
    viewDirection: vec3<f32>,
    sunDirection: vec3<f32>,
    betaRayleigh: vec3<f32>,
    betaMieScatter: vec3<f32>,
    betaMieExtinction: vec3<f32>,
    betaOzoneAbsorption: vec3<f32>,
    mieDirectionality: f32,
    sunIntensity: f32,
    primaryStepCount: i32,
    lightStepCount: i32
) -> vec3<f32> {
    let atmosphereHit = raySphereIntersect(rayOrigin, viewDirection, ATMOSPHERE_RADIUS);
    let marchDistance = max(atmosphereHit.y, 0.0);
    let stepLength = marchDistance / f32(primaryStepCount);
    var viewOpticalDepth = vec3<f32>(0.0);
    var sumRayleigh = vec3<f32>(0.0);
    var sumMie = vec3<f32>(0.0);

    for (var step = 0; step < PRIMARY_STEPS; step = step + 1) {
        if step >= primaryStepCount {
            break;
        }

        let distanceAlongRay = (f32(step) + 0.5) * stepLength;
        let samplePosition = rayOrigin + viewDirection * distanceAlongRay;
        let height = length(samplePosition) - PLANET_RADIUS;
        let density = atmosphereDensities(height);
        viewOpticalDepth += density * stepLength;

        let sunOpticalDepth = lightOpticalDepth(
            samplePosition,
            sunDirection,
            lightStepCount
        );
        let tau = betaRayleigh * (viewOpticalDepth.x + sunOpticalDepth.x) +
      betaMieExtinction * (viewOpticalDepth.y + sunOpticalDepth.y) +
      betaOzoneAbsorption * (viewOpticalDepth.z + sunOpticalDepth.z);
        let transmittance = exp(-tau) * sunOpticalDepth.w;

        sumRayleigh += density.x * transmittance * stepLength;
        sumMie += density.y * transmittance * stepLength;
    }

    let mu = clamp(dot(viewDirection, sunDirection), -1.0, 1.0);
    let phaseRayleigh = rayleighPhase(mu);
    let phaseMie = miePhase(mu, mieDirectionality);
    let rayleighRadiance = sunIntensity * betaRayleigh * sumRayleigh * phaseRayleigh;
    let mieRadiance = sunIntensity * betaMieScatter * sumMie * phaseMie;
    let singleScattering = rayleighRadiance + mieRadiance;

    let scatteringDepth = betaRayleigh * viewOpticalDepth.x +
    betaMieScatter * viewOpticalDepth.y;
    let scatterProbability = 1.0 - exp(
        -dot(scatteringDepth, vec3<f32>(0.2126, 0.7152, 0.0722))
    );
    let singleLuminance = dot(
        singleScattering,
        vec3<f32>(0.2126, 0.7152, 0.0722)
    );
    let multiScatterColor = mix(
        singleScattering,
        vec3<f32>(singleLuminance),
        MULTI_SCATTER_DESATURATION
    );
    let multiScatterFactor = MULTI_SCATTER_STRENGTH * mix(
        0.35,
        1.0,
        clamp(scatterProbability * 2.0, 0.0, 1.0)
    );
    var radiance = singleScattering + multiScatterColor * multiScatterFactor;

    let viewTau = betaRayleigh * viewOpticalDepth.x +
    betaMieExtinction * viewOpticalDepth.y +
    betaOzoneAbsorption * viewOpticalDepth.z;
    let viewTransmittance = exp(-viewTau);
    let spaceRadiance = vec3<f32>(0.0002, 0.00035, 0.001);

    return radiance + spaceRadiance * viewTransmittance;
}

fn atmosphereDirection(uv: vec2f) -> vec3f {
    let azimuth = (uv.x * 2.0 - 1.0) * PI;
    let elevation = (uv.y - 0.5) * PI;
    let elevationCosine = cos(elevation);
    return normalize(vec3f(
        sin(azimuth) * elevationCosine,
        sin(elevation),
        cos(azimuth) * elevationCosine
    ));
}

@compute @workgroup_size(8, 8)
fn compute(@builtin(global_invocation_id) id: vec3u) {
    if id.x >= ATMOSPHERE_LUT_WIDTH || id.y >= ATMOSPHERE_LUT_HEIGHT {
        return;
    }

    let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(
        f32(ATMOSPHERE_LUT_WIDTH),
        f32(ATMOSPHERE_LUT_HEIGHT)
    );
    let direction = atmosphereDirection(uv);
    let rayOrigin = vec3f(0.0, PLANET_RADIUS + OBSERVER_ALTITUDE, 0.0);
    let sunDirection = makeSunDirection(spektralUniforms.uTimeOfDay);
    let moonDirection = makeMoonDirection(spektralUniforms.uTimeOfDay);
    let aerosolDensity = clamp(spektralUniforms.uHorizonHaze, 0.0, 4.0);
    let betaRayleigh = vec3f(0.0058, 0.0135, 0.0331);
    let betaMieScatter = vec3f(0.003) * aerosolDensity;
    let betaMieExtinction = vec3f(0.00444) * aerosolDensity;
    let betaOzoneAbsorption = vec3f(0.00065, 0.00188, 0.00008);
    let solar = renderAtmosphere(
        rayOrigin, direction, sunDirection, betaRayleigh, betaMieScatter,
        betaMieExtinction, betaOzoneAbsorption, 0.9, 2.0, PRIMARY_STEPS, LIGHT_STEPS
    );
    let lunar = renderAtmosphere(
        rayOrigin, direction, moonDirection, betaRayleigh, betaMieScatter,
        betaMieExtinction, betaOzoneAbsorption, 0.9, 0.028, PRIMARY_STEPS, LIGHT_STEPS
    );

    textureStore(solarAtmosphereLut, vec2u(id.xy), vec4f(solar, 1.0));
    textureStore(lunarAtmosphereLut, vec2u(id.xy), vec4f(lunar, 1.0));

    if id.x == 0u && id.y == 0u {
        lightingState[0] = vec4f(observerSunTransmittance(
            rayOrigin, sunDirection, betaRayleigh, betaMieExtinction, betaOzoneAbsorption
        ), 1.0);
        lightingState[1] = vec4f(observerSunTransmittance(
            rayOrigin, moonDirection, betaRayleigh, betaMieExtinction, betaOzoneAbsorption
        ), 1.0);
    }
}
