const BLOCK_SIZE: i32 = 8;
const SEARCH_STEP: i32 = 4;

fn luminance(color: vec3f) -> f32 {
    return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn matchError(current: vec3f, previous: vec3f) -> f32 {
    let colorDistance = dot(abs(current - previous), vec3f(0.25, 0.5, 0.25));
    return colorDistance + abs(luminance(current) - luminance(previous)) * 0.6;
}

fn loadVideo(frameCoord: vec2i, frameSize: vec2u) -> vec4f {
    let videoSize = textureDimensions(uVideo);
    let uv = (vec2f(frameCoord) + 0.5) / vec2f(frameSize);
    let videoCoord = clamp(vec2i(uv * vec2f(videoSize)), vec2i(0), vec2i(videoSize) - 1);
    return textureLoad(uVideo, videoCoord, 0);
}

@compute @workgroup_size(8, 8)
fn compute(@builtin(global_invocation_id) id: vec3u) {
    let flowSize = textureDimensions(uMotionVectors);
    if any(id.xy >= flowSize) { return; }

    let frameSize = textureDimensions(uFrameNext);
    let frameLimit = vec2i(frameSize) - 1;
    let blockOrigin = vec2i(id.xy) * BLOCK_SIZE;
    let blockCenter = min(blockOrigin + vec2i(BLOCK_SIZE / 2), frameLimit);
    let currentBlock = loadVideo(blockCenter, frameSize).rgb;
    let previousBlock = textureLoad(uFramePrevious, blockCenter, 0);

    var bestOffset = vec2i(0);
    let zeroError = matchError(currentBlock, previousBlock.rgb);
    var bestError = zeroError;

    for (var searchY: i32 = -2; searchY <= 2; searchY += 1) {
        for (var searchX: i32 = -2; searchX <= 2; searchX += 1) {
            let offset = vec2i(searchX, searchY) * SEARCH_STEP;
            let candidateCoord = clamp(blockCenter + offset, vec2i(0), frameLimit);
            let candidate = textureLoad(uFramePrevious, candidateCoord, 0).rgb;
            let regularization = length(vec2f(offset)) * 0.00035;
            let error = matchError(currentBlock, candidate) + regularization;
            if error < bestError {
                bestError = error;
                bestOffset = offset;
            }
        }
    }

    let historyReady = previousBlock.a > 0.5 && spektralUniforms.uReset < 0.5;
    let improvement = clamp((zeroError - bestError) / (zeroError + 0.012), 0.0, 1.0);
    let confidence = select(
        0.0,
        improvement * smoothstep(0.018, 0.16, zeroError),
        historyReady
    );
    let motion = select(vec2f(0.0), vec2f(bestOffset), historyReady);
    textureStore(uMotionVectors, id.xy, vec4f(motion, confidence, zeroError));

    for (var localY: i32 = 0; localY < BLOCK_SIZE; localY += 1) {
        for (var localX: i32 = 0; localX < BLOCK_SIZE; localX += 1) {
            let frameCoord = blockOrigin + vec2i(localX, localY);
            if all(frameCoord < vec2i(frameSize)) {
                let current = loadVideo(frameCoord, frameSize);
                textureStore(uFrameNext, vec2u(frameCoord), vec4f(current.rgb, 1.0));
            }
        }
    }
}
