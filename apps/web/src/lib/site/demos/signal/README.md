# Signal

A laboratory monitor in the shared Spektral studio, displaying an orbital night
timelapse. Click the glass screen or the physical power button to turn the monitor
off or on. While fully on, drag horizontally across the screen to seek. Playback
resumes after the drag if it was running before. Other parts of the housing and
the background do not act as controls.

The first decoded video frame starts the tube: a short dark heater delay, a seed
that opens into a horizontal line, then a growing raster whose brightness settles.
Shutdown collapses the image vertically, contracts the line to a dot and lets the
phosphor afterglow fade. Rapid toggles restart from the current visible state, rather
than jumping to a fixed first frame. Powering off pauses the decoder immediately;
rendering continues only until the shutdown animation and inspection turn settle.

## Video texture lifecycle

`media.ts` creates an off-DOM `HTMLVideoElement` with muted, inline, looping playback.
The runtime publishes it through `frame.setTexture('uVideo', ...)` after the browser
has decoded a frame and reported valid image dimensions. The texture uses sRGB,
linear filtering, clamp addressing and `update: 'perFrame'`.

`requestVideoFrameCallback` invalidates the on-demand canvas when a decoded frame
arrives. Browsers without that API use an animation-frame fallback while playing.
The callback stops when paused or powered off. A seek invalidates its completed
frame, and pointer movement invalidates only while the small inspection turn is
settling. `power.ts` advances the CRT envelope through `uRaster`, `uBoot` and `uPower`,
with explicit invalidation while those values change. A fully off, stationary
monitor submits no GPU frames.

Power-on calls `play()` inside the user gesture, allowing a browser that denied
autoplay to grant playback permission.
On unmount, the runtime cancels pending callbacks, removes listeners, unbinds the
texture, pauses the video, clears its source and releases the decoder with `load()`.

The printed faceplate is a separate authored texture, loaded through `useTexture`
as linear data with mipmaps. It does not delay video readiness. Svelte, React and Vue
use the same media and interaction code; each adapter owns its mount and cleanup.

## Assets

The 18-second, silent clip shows a nighttime orbital timelapse photographed during
ISS Expedition 28. It is a 4:3 crop of the
[NASA Scientific Visualization Studio source](https://svs.gsfc.nasa.gov/30180/),
encoded as H.264 at 960 × 720 and 30 fps. Video courtesy of the Earth Science and
Remote Sensing Unit, NASA Johnson Space Center.

Source, transformation and media-usage details are recorded beside the asset in
`static/playground-media/signal/NOTICE.txt` and `sources.json`. The video and faceplate
load from the public `/playground-media/signal/` path, whose CORS headers allow the
opaque playground preview to read them.
