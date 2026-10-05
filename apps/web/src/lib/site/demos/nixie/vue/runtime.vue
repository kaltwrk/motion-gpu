<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useFrame, usePointer, useSpektral, useTexture } from 'spektral/vue';
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
let dispose: (() => void) | undefined;
onMounted(() => {
	dispose = runtime.mount();
});
onBeforeUnmount(() => dispose?.());
useFrame(
	(frame) => runtime.update(frame, pointer.state.current, cathodes, woodColor, woodSurface),
	{
		autoInvalidate: false
	}
);
</script>

<template></template>
