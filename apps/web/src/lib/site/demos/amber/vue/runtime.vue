<script setup lang="ts">
import { useFrame, usePointer, useTexture } from 'spektral/vue';
import { albedoOptions, albedoUrls, surfaceOptions, surfaceUrls } from '../assets';
import { createInspectionInteraction } from '../interaction';

const albedo = useTexture(albedoUrls, albedoOptions);
const surface = useTexture(surfaceUrls, surfaceOptions);
const pointer = usePointer({ capturePointer: true, trackWhilePressedOutsideCanvas: true });
const updateInspection = createInspectionInteraction();
useFrame((frame) => updateInspection(frame, pointer.state.current, albedo, surface), {
	autoInvalidate: false
});
</script>

<template></template>
