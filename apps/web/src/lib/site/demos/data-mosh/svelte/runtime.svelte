<script lang="ts">
	import { onMount } from 'svelte';
	import { useFrame } from 'spektral/svelte';
	// @ts-expect-error The playground mounts shared demo files beside the virtual runtime entry.
	import { createOriginCleanVideo, type OriginCleanVideo } from './video-source';

	let videoHandle: OriginCleanVideo | null = null;
	let lastVideoTime = 0;
	let resetNextFrame = true;

	onMount(() => {
		const handle = createOriginCleanVideo();
		videoHandle = handle;
		void handle.ready.catch((error: unknown) =>
			console.error('[Data Mosh] Unable to load video.', error)
		);

		return () => {
			handle.dispose();
			if (videoHandle === handle) videoHandle = null;
		};
	});

	useFrame((frame) => {
		const video = videoHandle?.video;
		if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

		const looped = video.currentTime + 0.25 < lastVideoTime;
		frame.setUniform('uReset', resetNextFrame || looped || video.seeking ? 1 : 0);
		frame.setTexture('video', {
			source: video,
			update: 'perFrame',
			flipY: true,
			colorSpace: 'srgb'
		});
		lastVideoTime = video.currentTime;
		resetNextFrame = false;
	});
</script>
