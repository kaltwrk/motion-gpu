fn hash12(value: vec2f) -> f32 {
    return fract(sin(dot(value, vec2f(127.1, 311.7))) * 43758.5453);
}

fn loadVideo(frameCoord: vec2i, frameSize: vec2u) -> vec3f {
    let videoSize = textureDimensions(uVideo);
    let uv = (vec2f(frameCoord) + 0.5) / vec2f(frameSize);
    let videoCoord = clamp(vec2i(uv * vec2f(videoSize)), vec2i(0), vec2i(videoSize) - 1);
    return textureLoad(uVideo, videoCoord, 0).rgb;
}

@compute @workgroup_size(8, 8)
fn compute(@builtin(global_invocation_id) id: vec3u) {
    let frameSize = textureDimensions(uMoshNext);
    if any(id.xy >= frameSize) { return; }

    let pixel = vec2i(id.xy);
    let frameLimit = vec2i(frameSize) - 1;
    let flowSize = textureDimensions(uMotionVectors);
    let flowCoord = min(pixel / 8, vec2i(flowSize) - 1);
    let flow = textureLoad(uMotionVectors, flowCoord, 0);
    let current = loadVideo(pixel, frameSize);

    let frameDifference = smoothstep(0.025, 0.19, flow.a);
    let activity = clamp(max(flow.z, frameDifference * 0.72), 0.0, 1.0);
    let row = f32(flowCoord.y);
    let timeSlice = floor(spektralFrame.time * 5.0);
    let tearNoise = hash12(vec2f(row, timeSlice));
    let tear = smoothstep(0.82, 0.99, tearNoise)
        * sin(row * 0.71 + spektralFrame.time * 2.3)
        * activity;
    var displacement = flow.xy * (1.35 + activity * 2.8);
    displacement.x += tear * (5.0 + activity * 13.0);

    let historyCoord = clamp(pixel + vec2i(round(displacement)), vec2i(0), frameLimit);
    let direction = normalize(displacement + vec2f(0.001));
    let chromaOffset = vec2i(round(direction * (1.0 + activity * 2.6)));
    let previousCenter = textureLoad(uMoshPrevious, historyCoord, 0);
    let previousRed = textureLoad(
        uMoshPrevious,
        clamp(historyCoord + chromaOffset, vec2i(0), frameLimit),
        0
    ).r;
    let previousBlue = textureLoad(
        uMoshPrevious,
        clamp(historyCoord - chromaOffset, vec2i(0), frameLimit),
        0
    ).b;
    let echoCoord = clamp(pixel + vec2i(round(displacement * 1.8)), vec2i(0), frameLimit);
    let echo = textureLoad(uMoshPrevious, echoCoord, 0).rgb;
    var historyColor = vec3f(previousRed, previousCenter.g, previousBlue);
    historyColor = mix(historyColor, echo, activity * 0.16);

    let historyWeight = clamp(0.76 + activity * 0.19, 0.0, 0.965);
    var color = mix(current, historyColor * 0.994, historyWeight);
    color += max(current - vec3f(0.58), vec3f(0.0)) * (0.04 + activity * 100.08);

    if spektralUniforms.uReset > 0.5 || previousCenter.a < 0.5 {
        color = current;
    }

    textureStore(uMoshNext, id.xy, vec4f(color, 1.0));
}
