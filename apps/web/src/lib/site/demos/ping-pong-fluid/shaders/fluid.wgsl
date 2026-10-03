const BRUSH_RADIUS: f32 = 0.055;
const BRUSH_STRENGTH: f32 = 3.0;
const FLUID_DECAY: f32 = 0.982;
const TRAIL_DECAY: f32 = 0.95;
const DIFFUSION: f32 = 0.18;

fn wrapUv(uv: vec2f) -> vec2f {
    return fract(uv + vec2f(1.0));
}

fn readFluid(uv: vec2f) -> vec4f {
    let rawDims = textureDimensions(spektralPrevious);
    let dims = vec2f(f32(rawDims.x), f32(rawDims.y));
    let p = wrapUv(uv) * dims - vec2f(0.5);
    let base = floor(p);
    let f = fract(p);
    let baseCoord = vec2i(i32(base.x), i32(base.y));
    let size = vec2i(i32(rawDims.x), i32(rawDims.y));
    let a = textureLoad(spektralPrevious, (baseCoord + size) % size, 0);
    let b = textureLoad(spektralPrevious, (baseCoord + vec2i(1, 0) + size) % size, 0);
    let c = textureLoad(spektralPrevious, (baseCoord + vec2i(0, 1) + size) % size, 0);
    let d = textureLoad(spektralPrevious, (baseCoord + vec2i(1, 1) + size) % size, 0);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn lineDistance(p: vec2f, a: vec2f, b: vec2f, aspect: f32) -> f32 {
    let pa = vec2f(p.x - a.x, (p.y - a.y) * aspect);
    let ba = vec2f(b.x - a.x, (b.y - a.y) * aspect);
    let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
    return length(pa - ba * h);
}

fn frag(uv: vec2f) -> vec4f {
    let rawDims = textureDimensions(spektralPrevious);
    let dims = vec2f(f32(rawDims.x), f32(rawDims.y));
    let texel = 1.0 / dims;

    let prev = readFluid(uv);
    let advected = readFluid(uv - prev.xy * 0.16);
    let north = readFluid(uv + vec2f(0.0, texel.y));
    let south = readFluid(uv - vec2f(0.0, texel.y));
    let east = readFluid(uv + vec2f(texel.x, 0.0));
    let west = readFluid(uv - vec2f(texel.x, 0.0));
    let blur = (north + south + east + west) * 0.25;

    let mixed = mix(advected, blur, DIFFUSION);
    let baseVelocity = mixed.xy * FLUID_DECAY;
    let baseTrail = mixed.z * TRAIL_DECAY;

    let pointer = spektralUniforms.uPointer.xy;
    let previousPointer = spektralUniforms.uPointer.zw;
    let pointerVector = pointer - previousPointer;
    let pointerSpeed = length(pointerVector);
    let aspect = dims.x / max(dims.y, 1.0);
    let pointerDistance = lineDistance(uv, pointer, previousPointer, 1 / aspect);
    let falloff = exp(-pointerDistance * pointerDistance / (BRUSH_RADIUS * BRUSH_RADIUS));
    let pointerActive = spektralUniforms.uPointerActive;

    let nextVelocity = baseVelocity + pointerVector * (BRUSH_STRENGTH * falloff * pointerActive);
    let nextTrail = baseTrail + falloff * pointerActive * (0.22 + pointerSpeed * 2.8);
    let border = vec2f(2.0 / dims.x, 2.0 / dims.y);
    let edgeFade = smoothstep(0.0, border.x, uv.x)
                     * smoothstep(0.0, border.x, 1.0 - uv.x)
                     * smoothstep(0.0, border.y, uv.y)
                     * smoothstep(0.0, border.y, 1.0 - uv.y);

    let next = vec4f(nextVelocity, nextTrail, 0.0) * edgeFade;
    return clamp(next, vec4f(-0.6, -0.6, 0.0, 0.0), vec4f(0.6, 0.6, 1.6, 0.0));
}
