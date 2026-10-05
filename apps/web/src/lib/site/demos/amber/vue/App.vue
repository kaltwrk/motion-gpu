<script setup lang="ts">
import { FragCanvas } from 'spektral/vue';
import { studioColor } from '../../../demo-shared/presentation';
import { createAmberScene, reportSceneError } from '../material';
import Runtime from './runtime.vue';

const { material, passes } = createAmberScene();
</script>

<template>
	<FragCanvas
		:material="material"
		:passes="passes"
		render-mode="on-demand"
		:dpr="1.5"
		:max-delta="1 / 30"
		:color="studioColor"
		:show-error-overlay="false"
		:on-error="reportSceneError"
		style="display: block; width: 100%; height: 100%; touch-action: none"
	>
		<Runtime />
	</FragCanvas>
</template>
