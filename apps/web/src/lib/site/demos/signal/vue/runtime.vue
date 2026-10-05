<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useFrame, usePointer, useSpektral, useTexture } from 'spektral/vue';
import { signalLabelOptions, signalLabelUrls } from '../assets';
import { createSignalRuntime } from '../interaction';

const context = useSpektral();
const runtime = createSignalRuntime(() => context.canvas, context.invalidate);
const labels = useTexture(signalLabelUrls, signalLabelOptions);
const pointer = usePointer(runtime.pointerOptions);
let dispose: (() => void) | undefined;
onMounted(() => {
	dispose = runtime.mount();
});
onBeforeUnmount(() => dispose?.());
useFrame((frame) => runtime.update(frame, pointer.state.current, labels), {
	autoInvalidate: false
});
</script>

<template></template>
