<script setup lang="ts">
import { FragCanvas } from 'spektral/vue';
import { studioColor } from '../../../demo-shared/presentation';
import { createKineticScene, reportSceneError } from '../material';
import Runtime from './runtime.vue';

const { material, passes } = createKineticScene();
</script>

<template>
	<FragCanvas
		:material="material"
		:passes="passes"
		render-mode="always"
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
