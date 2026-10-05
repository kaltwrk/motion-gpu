# Ferrofluid

A magnetic surface in the shared Spektral studio. Move the pointer over the basin to
move the field; press and hold to increase it. Moving away returns the field to the
center. The preview contains only the rendered scene.

## Spektral concepts

- `defineMaterial` declares `uMagnet`, `uStep` and the `rgba16float` storage texture.
- `PingPongComputePass` alternates sampled `previousState` and writable `nextState`
  aliases of `uFluid`. The latest result is published to the fragment shader without
  the application tracking A/B parity.
- Two compute iterations run before each scene render. Each uses half the clamped
  frame delta, keeping elapsed simulation time independent of the iteration count.
- `usePointer` supplies Y-up UV coordinates, pointer capture and pressed state.
  `useFrame` projects that input into the studio and updates the magnet uniform.
- `includes` inserts the shared studio, while typed vector `defines` keep the camera
  identical in WGSL and TypeScript.
- The shared presentation `ShaderPass` applies ACES Hill to linear scene radiance,
  encodes sRGB, then adds static monochrome dithering of +/-0.625 of an 8-bit code
  value. Dithering is fixed to physical pixels, with no animation or colored grain.
  The canvas uses `workingFormat: 'rgba16float'` with its own tone mapping and
  encoding disabled, so the shared pass controls the final SDR transform once.

The simulation is a damped heightfield model with a magnetic instability profile,
not a full magnetohydrodynamics solver. R stores surface height, G vertical velocity,
B the local field envelope, and A initialization validity. A zeroed texture starts
the simulation on the GPU, including after device recreation.

## Source boundaries

- `shaders/simulate.wgsl`: evolving surface state.
- `shaders/fragment.wgsl`: basin and fluid rendering.
- `material.ts`: material resources and compute dispatch.
- `interaction.ts`: projection, damping and uniform updates.
- `../../demo-shared/studio.wgsl`: common environment, lighting and shading.
- `../../demo-shared/camera.ts`: common camera and world-space pointer projection.
- `../../demo-shared/presentation.ts`: common SDR presentation pass and canvas color options.

Svelte, React and Vue each mount the same resources with a runtime child inside
`FragCanvas`. The canvas owns its GPU resource lifecycle. The adapters use continuous
rendering because the surface keeps relaxing after pointer input stops.

In the playground, shared studio sources appear under `src/shared/`. They remain
editable alongside the demo, while repository maintenance has a single source.
