<script lang="ts">
	import { onMount } from 'svelte';
	import { useFrame, usePointer, useSpektral, useTexture } from 'spektral/svelte';
	import { signalLabelOptions, signalLabelUrls } from '../assets';
	import { createSignalRuntime } from '../interaction';

	const context = useSpektral();
	const runtime = createSignalRuntime(() => context.canvas, context.invalidate);
	const labels = useTexture(signalLabelUrls, signalLabelOptions);
	const pointer = usePointer(runtime.pointerOptions);
	onMount(runtime.mount);
	useFrame((frame) => runtime.update(frame, pointer.state.current, labels), {
		autoInvalidate: false
	});
</script>
