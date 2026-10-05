# Amber

An amber glass specimen in the shared Spektral studio. Move the pointer to gently turn
the specimen. Drag horizontally to rotate the
specimen; it keeps the selected angle after release. Hold the pointer down to reveal
more of the material's optical depth. The preview has no controls or overlays.

## Texture loading

The runtime calls `useTexture` separately for the color map and surface data. Albedo
loads as sRGB; normal, roughness, height and ambient occlusion load as linear data,
with browser color conversion disabled. Every map uses mipmaps and linear filtering.

Once both requests finish, a single `useFrame` callback sends all five decoded
bitmaps to the material with `frame.setTexture`. It preserves the loader's dimensions,
color space and upload metadata, then sets `uReady`. The fragment shader can keep its
fallback material until this complete set is available. There is no frame with only
some of the maps installed.

`useTexture` owns fetch cancellation and bitmap disposal on unmount. Loading errors
are reported once in the console. The application does not close the bitmaps itself.

## Rendering and interaction

`usePointer` supplies normalized input and pointer capture. Dragging uses unclamped
coordinates so rotation continues outside the canvas. `useFrame` smooths `uInspect`,
the persistent Y rotation `uRotation`, and the press response `uReveal`. It invalidates
while those values change or new textures arrive. With `autoInvalidate` disabled and
`renderMode="on-demand"`, the GPU stops rendering when the view settles.

The scene imports the same camera, studio shader and SDR presentation pass as
Ferrofluid. In the editor, those sources are available under `src/shared/`.

## Assets

The demo uses the native 1024 × 1024 maps from
[Obsidian 001 by Katsukagi](https://3dtextures.me/2019/09/12/obsidian-001/), published
under [CC0](https://3dtextures.me/about/). The normal map uses the OpenGL +Y convention.
Albedo, normal, roughness and AO are JPEG; the height map is the source 16-bit PNG.

Files are served from `/playground-media/obsidian/`. URLs resolve against the preview
document's URL, since its sandbox security origin is opaque. Development middleware
and the production `_headers` rule allow anonymous CORS requests for this public media
directory. Source and license details are stored with the downloaded maps.
