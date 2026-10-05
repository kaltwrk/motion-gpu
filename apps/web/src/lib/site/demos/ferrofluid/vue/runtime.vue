<script setup lang="ts">
import { useFrame, usePointer } from 'spektral/vue';
import { createMagnetInteraction } from '../interaction';

const pointer = usePointer({ capturePointer: true, trackWhilePressedOutsideCanvas: true });
const updateMagnet = createMagnetInteraction();
useFrame((frame) => updateMagnet(frame, pointer.state.current));
</script>

<template></template>
