<script setup lang="ts">
/*
 * Created by Marek Jóźwiak @madebyhex
 *
 * License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
 * SPDX-License-Identifier: CC-BY-NC-SA-4.0
 *
 * You are free to share and adapt this work under the terms of the license.
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */
import { ComputePass, FragCanvas, defineMaterial } from 'spektral/vue';
import Runtime from './runtime.vue';
import fragmentShader from './shaders/fragment.wgsl?raw';
import transformPassShader from './shaders/compute/transform-pass.wgsl?raw';

const CUBE_COUNT = 27;
const FLOATS_PER_ENTRY = 4;
const BUFFER_SIZE = CUBE_COUNT * FLOATS_PER_ENTRY * 4;

const createInitialGridPositions = () => {
	const data = new Float32Array(CUBE_COUNT * FLOATS_PER_ENTRY);
	let index = 0;
	for (const x of [-1, 0, 1]) {
		for (const y of [-1, 0, 1]) {
			for (const z of [-1, 0, 1]) {
				const base = index * FLOATS_PER_ENTRY;
				data[base] = x;
				data[base + 1] = y;
				data[base + 2] = z;
				data[base + 3] = 1;
				index += 1;
			}
		}
	}
	return data;
};

const createInitialIdentityQuaternions = () => {
	const data = new Float32Array(CUBE_COUNT * FLOATS_PER_ENTRY);
	for (let index = 0; index < CUBE_COUNT; index += 1) {
		const base = index * FLOATS_PER_ENTRY;
		data[base] = 0;
		data[base + 1] = 0;
		data[base + 2] = 0;
		data[base + 3] = 1;
	}
	return data;
};

const material = defineMaterial({
	fragment: fragmentShader,
	uniforms: {
		uBodyColor: { type: 'vec3f', value: [0.05, 0.045, 0.048] },
		uRimColor: { type: 'vec3f', value: [1.0, 1.0, 1.0] },
		uRimPower: { type: 'f32', value: 3.2 },
		uRimIntensity: { type: 'f32', value: 2.2 },
		uCubeScale: { type: 'f32', value: 0.9 },
		uRoundRadius: { type: 'f32', value: 0.075 },
		uSceneBound: { type: 'f32', value: 2.7 },
		uSceneQuat: { type: 'vec4f', value: [0, 0, 0, 1] },
		uMoveQuat: { type: 'vec4f', value: [0, 0, 0, 1] },
		uSpacing: { type: 'f32', value: 1 },
		uActiveAxis: { type: 'f32', value: 0 },
		uActiveLayer: { type: 'f32', value: 0 },
		uMoveActive: { type: 'f32', value: 0 }
	},
	storageBuffers: {
		cubeBasePositions: {
			size: BUFFER_SIZE,
			type: 'array<vec4f>',
			access: 'read-write',
			initialData: createInitialGridPositions()
		},
		cubeBaseQuaternions: {
			size: BUFFER_SIZE,
			type: 'array<vec4f>',
			access: 'read-write',
			initialData: createInitialIdentityQuaternions()
		},
		cubeGridPositions: {
			size: BUFFER_SIZE,
			type: 'array<vec4f>',
			access: 'read-write',
			initialData: createInitialGridPositions()
		},
		cubeWorldPositions: {
			size: BUFFER_SIZE,
			type: 'array<vec4f>',
			access: 'read-write',
			initialData: createInitialGridPositions()
		},
		cubeWorldQuaternions: {
			size: BUFFER_SIZE,
			type: 'array<vec4f>',
			access: 'read-write',
			initialData: createInitialIdentityQuaternions()
		},
		cubeInvWorldQuaternions: {
			size: BUFFER_SIZE,
			type: 'array<vec4f>',
			access: 'read-write',
			initialData: createInitialIdentityQuaternions()
		}
	}
});

const transformPass = new ComputePass({
	compute: transformPassShader,
	dispatch: [1],
	resources: {
		cubeBasePositions: { buffer: 'cubeBasePositions', access: 'storage-read' },
		cubeBaseQuaternions: { buffer: 'cubeBaseQuaternions', access: 'storage-read' },
		cubeGridPositions: { buffer: 'cubeGridPositions', access: 'storage-read-write' },
		cubeWorldPositions: { buffer: 'cubeWorldPositions', access: 'storage-read-write' },
		cubeWorldQuaternions: { buffer: 'cubeWorldQuaternions', access: 'storage-read-write' },
		cubeInvWorldQuaternions: {
			buffer: 'cubeInvWorldQuaternions',
			access: 'storage-read-write'
		}
	}
});
</script>

<template>
	<FragCanvas
		:material="material"
		:passes="[transformPass]"
		:color="{ outputEncoding: 'linear', dynamicRange: 'auto', canvasColorSpace: 'display-p3' }"
	>
		<Runtime />
	</FragCanvas>
</template>
