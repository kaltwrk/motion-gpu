fn coverUv(uv: vec2f, viewport: vec2f, sourceAspect: f32) -> vec2f {
    let viewportAspect = viewport.x / viewport.y;
    var covered = uv;
    if viewportAspect > sourceAspect {
        covered.y = 0.5 + (uv.y - 0.5) * sourceAspect / viewportAspect;
    } else {
        covered.x = 0.5 + (uv.x - 0.5) * viewportAspect / sourceAspect;
    }
    return covered;
}

fn bloomSample(uv: vec2f) -> vec3f {
    return max(textureSample(feedback, feedbackSampler, uv).rgb - vec3f(0.52), vec3f(0.0));
}

fn frag(uv: vec2f) -> vec4f {
    let resolution = max(spektralFrame.resolution, vec2f(1.0));
    let feedbackSize = vec2f(textureDimensions(feedback));
    let sourceUv = coverUv(uv, resolution, feedbackSize.x / feedbackSize.y);
    let texel = 1.0 / feedbackSize;
    let center = textureSample(feedback, feedbackSampler, sourceUv).rgb;

    var bloom = vec3f(0.0);
    bloom += bloomSample(sourceUv + texel * vec2f(4.0, 0.0));
    bloom += bloomSample(sourceUv - texel * vec2f(4.0, 0.0));
    bloom += bloomSample(sourceUv + texel * vec2f(0.0, 4.0));
    bloom += bloomSample(sourceUv - texel * vec2f(0.0, 4.0));

    let p = uv * 2.0 - 1.0;
    let vignette = pow(clamp(1.0 - dot(p, p) * 0.24, 0.0, 1.0), 1.35);
    let grain = fract(
        sin(dot(uv * resolution + floor(spektralFrame.time * 24.0), vec2f(12.9898, 78.233)))
            * 43758.5453
    );
    var color = center + bloom * 0.075;
    color *= vignette;
    color += (grain - 0.5) * 0.006;
    color = 1.0 - exp(-color * 1.06);
    return vec4f(color, 1.0);
}
