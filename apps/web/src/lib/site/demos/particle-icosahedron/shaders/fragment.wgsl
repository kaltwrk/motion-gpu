fn frag(uv: vec2f) -> vec4f {
  let aspect = spektralFrame.resolution.x / max(spektralFrame.resolution.y, 1.0);
  let fit = select(vec2f(1.0, 1.0 / aspect), vec2f(aspect, 1.0), aspect > 1.0);
  let sampleUv = (uv - 0.5) * fit + 0.5;
  let inBounds = sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0;
  let shapeMask = select(0.0, 1.0, inBounds);

  let texelCoord = vec2i(clamp(floor(sampleUv * 2056.0), vec2f(0.0), vec2f(2055.0)));
  let writtenFrame = textureLoad(densityFrame, texelCoord, 0).r;
  let fresh = select(0.0, 1.0, abs(writtenFrame - spektralUniforms.uFrameId) < 0.5);
  var acc = textureLoad(densityMap, texelCoord, 0).rgb * 1.4 * fresh;

  var color = (acc + pow(acc, vec3f(1.35)) * 0.55) * shapeMask;

  return vec4f(color, 1.0);
}
