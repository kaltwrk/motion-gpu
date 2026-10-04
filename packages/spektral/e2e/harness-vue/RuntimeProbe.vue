<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { observeAnimationFrames } from '../observe-animation-frames';
import { useFrame, useSpektral } from '../../src/lib/vue';
import type { RuntimeControls } from './runtime-controls.js';

interface Props {
	passive?: boolean;
	onFrame: (count: number) => void;
	onReady: (controls: RuntimeControls) => void;
}

const props = defineProps<Props>();
const context = useSpektral();
let frameCount = 0;

const countFrame = () => {
	frameCount += 1;
	props.onFrame(frameCount);
};
const task = useFrame(
	() => {
		if (!props.passive) countFrame();
	},
	{ autoInvalidate: false, autoStart: !props.passive }
);
let stopObserving: (() => void) | undefined;
onUnmounted(() => stopObserving?.());

onMounted(() => {
	props.onReady({
		setRenderMode: (mode) => context.renderMode.set(mode),
		invalidate: context.invalidate,
		advance: context.advance,
		setTaskActive: (active) => (active ? task.start() : task.stop())
	});
	if (props.passive) stopObserving = observeAnimationFrames(countFrame);
});
</script>

<template></template>
