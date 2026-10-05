<script lang="ts">
	import { onMount } from 'svelte';
	import { useFrame, usePointer, useSpektral, useTexture } from 'spektral/svelte';
	import {
		nixieCathodeOptions,
		nixieCathodeUrls,
		nixieWoodColorOptions,
		nixieWoodColorUrls,
		nixieWoodSurfaceOptions,
		nixieWoodSurfaceUrls
	} from '../assets';
	import { createNixieRuntime } from '../interaction';

	const context = useSpektral();
	const runtime = createNixieRuntime(() => context.canvas, context.invalidate);
	const cathodes = useTexture(nixieCathodeUrls, nixieCathodeOptions);
	const woodColor = useTexture(nixieWoodColorUrls, nixieWoodColorOptions);
	const woodSurface = useTexture(nixieWoodSurfaceUrls, nixieWoodSurfaceOptions);
	const pointer = usePointer(runtime.pointerOptions);
	onMount(runtime.mount);
	useFrame(
		(frame) => runtime.update(frame, pointer.state.current, cathodes, woodColor, woodSurface),
		{
			autoInvalidate: false
		}
	);
</script>
