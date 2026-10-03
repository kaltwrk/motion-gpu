<script lang="ts">
	import { useFrame, useTexture } from 'spektral/svelte';

	const image = useTexture(['/playground-media/sample-image-21.jpg'], {
		flipY: true,
		colorSpace: 'srgb'
	});

	useFrame((state) => {
		const texture = image.textures.current?.[0];
		state.setTexture(
			'uImage',
			texture ? { source: texture.source, flipY: true, colorSpace: 'srgb' } : null
		);
	});
</script>
