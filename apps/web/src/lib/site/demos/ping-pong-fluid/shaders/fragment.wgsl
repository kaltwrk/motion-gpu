fn coverUv(uv: vec2f, imageSize: vec2f, viewportSize: vec2f) -> vec2f {
    let imageAspect = imageSize.x / max(imageSize.y, 1.0);
    let viewportAspect = viewportSize.x / max(viewportSize.y, 1.0);
    let scale = select(
        vec2f(viewportAspect / imageAspect, 1.0),
        vec2f(1.0, imageAspect / viewportAspect),
        imageAspect < viewportAspect
    );
    return (uv - 0.5) * scale + 0.5;
}

fn sampleImage(uv: vec2f) -> vec3f {
    let edgeClampedUv = clamp(uv, vec2f(0.0), vec2f(1.0));
    let rawDims = textureDimensions(uImage);
    let dims = vec2f(f32(rawDims.x), f32(rawDims.y));
    let viewport = max(spektralFrame.resolution, vec2f(1.0));
    let coveredUv = coverUv(edgeClampedUv, dims, viewport);
    let inBounds = coveredUv.x >= 0.0 && coveredUv.x <= 1.0 && coveredUv.y >= 0.0 && coveredUv.y <= 1.0;
    let color = textureSample(uImage, uImageSampler, clamp(coveredUv, vec2f(0.0), vec2f(1.0))).rgb;
    return mix(vec3f(0.0, 0.0, 0.0), color, select(0.0, 1.0, inBounds));
}

fn frag(uv: vec2f) -> vec4f {
    let fluidState = textureSample(fluid, fluidSampler, uv);
    let flow = fluidState.xy;

    let warpedUv = uv + flow * DISTORTION_AMOUNT;

    var color = sampleImage(warpedUv);

    return vec4f(color, 1.0);
}
