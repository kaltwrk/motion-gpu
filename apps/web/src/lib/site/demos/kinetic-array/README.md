# Kinetic Array

Move the pointer across the pin matrix to depress the surface. Holding the pointer
applies more force; pressing once also sends a short impulse through the coupled
springs. The surrounding case and floor do not receive input. The device and
shared studio camera stay fixed so the pointer remains aligned with the pins.

## Storage-buffer simulation

`simulation.ts` declares three material storage buffers. `pinState` contains one
`vec4f` per pin in a 17 × 13 grid; displacement and velocity remain on the GPU.
`pinForces` carries the force calculation into the integration pass. `interaction`
is a single 16-byte `vec4f` containing board-local X, board-local Z, continuous force and a
one-frame impulse.

The force `ComputePass` reads `pinState` with `version: 'initial'`: the state
imported at the beginning of the current frame, not the original `initialData`.
It reads the CPU interaction buffer and writes `pinForces`. The integration pass
reads `pinForces` with `version: 'current'` and updates `pinState`. Those resource
declarations establish the dependency order. Both passes run before the base
fragment shader, which reads the updated `pinState` directly as a read-only storage
buffer. There is no per-frame CPU readback or separate CPU copy of the simulation.

Material `defines` apply to the fragment shader. `simulation.ts` also writes those
same typed constants into a WGSL preamble for each `ComputePass`, so compute and
rendering agree on the grid without assuming that material defines reach compute.

The initial state is uploaded once when the material's buffers are created. Pin
spacing is 0.145 local units, the rest height is 0.64, and displacement is limited
to −0.27 through +0.28. `uStep` comes from frame delta and is capped at 1/30 second.

## Lighting caches

`lighting.ts` adds three `ComputePass` instances after integration. Each reads
`pinState` with `version: 'current'` and writes its own `rgba16float` storage
texture. The base fragment shader samples those textures in the same frame.
RGB stores visibility of the three shared studio lights; alpha is one. Surface
normals, material response and ambient occlusion remain evaluated per fragment.

`uPinLighting` is a 272 × 416 atlas with one 16 × 32 tile per pin. Each tile has
a planar chart for the face and separate angular charts for the head wall,
chamfers, three shaft sections and guide. Bilinear reads stay inside each chart;
angular coordinates wrap within that pin. The base, fasteners, guide interiors
and horizontal shaft shoulders retain direct shadow evaluation.

`uDeckLighting` covers the flat deck at 256 × 208. `uFloorLighting` has a fixed
512 × 512 allocation and an active rectangle of at most about 65,536 texels,
with the same aspect ratio as the framebuffer. Its compute shader intersects
camera rays with the studio floor directly. Resizing changes that rectangle
and dispatch size without recreating the simulation buffers. Sampling clamps to
the active rectangle so unused texels cannot enter the result.

The compute shaders and fragment sampling helpers share `lighting-layout.wgsl`.
They use the same scene geometry and studio shadow function. Texture writes and
sampling stay on the GPU; the caches need no image uploads or CPU readback.

## Pointer input

`usePointer` supplies Y-up UV coordinates. `geometry.ts` projects these through the
shared studio camera onto the scaled pin rest plane. The device has a uniform
`KINETIC_SCALE` of 0.84; projected world coordinates are divided by that scale
before the active-grid check and buffer write. `interaction.ts` smooths the cursor position and continuous force,
then calls `frame.writeStorageBuffer('interaction', ...)` only when its four values
change. Spektral queues an owned copy and uploads it before the compute passes.

A pointer-down event queues the impulse until the next rendered frame, preserving
a fast tap that is released between frames. The following frame writes zero to
the impulse component. Holding does not retrigger it, and leaving the grid clears
continuous force immediately. Pointer capture keeps release and cancellation
handling valid outside the canvas.

Each adapter creates its own stable material and interaction helper. The host uses
`renderMode="always"` so the GPU can continue integrating the springs after input
stops. The runtime owns no timers or GPU resources; Spektral owns pointer listeners,
passes and storage-buffer teardown. Shared studio presentation handles tone
mapping, sRGB encoding and stationary dithering after rendering.

## Rendered mechanism

Each buffer record controls a thin, chamfered steel head and three nested shaft
sections. The guide bushing remains fixed to the deck. The casing has a separate
top plate, gasket, recessed fasteners and rubber feet. Ray traversal visits grid
cells in order and intersects their mechanisms analytically, using the current
GPU displacement for each head.

The turned faces use a radial anisotropic reflection integrated over the shared
studio softboxes. Fine tooling marks fade below pixel resolution. Local pin
geometry supplies contact occlusion and soft shadows; traversal bounding boxes
do not contribute to the shadow silhouette. The scene uses the existing studio
camera, floor and presentation pass.
