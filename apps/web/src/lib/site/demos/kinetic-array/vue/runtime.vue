<script setup lang="ts">
import { useFrame, usePointer } from 'spektral/vue';
import { createKineticInteraction } from '../interaction';

const interaction = createKineticInteraction();
const pointer = usePointer(interaction.pointerOptions);
useFrame((frame) => interaction.update(frame, pointer.state.current), { autoInvalidate: false });
</script>

<template></template>
