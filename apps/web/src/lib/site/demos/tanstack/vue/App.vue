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
import common from './shaders/includes/common.wgsl?raw';
import stars from './shaders/includes/stars.wgsl?raw';
import water from './shaders/includes/water.wgsl?raw';
import island from './shaders/includes/island.wgsl?raw';
import palm from './shaders/includes/palm.wgsl?raw';
import seabed from './shaders/includes/seabed.wgsl?raw';
import atmosphere from './shaders/includes/atmosphere.wgsl?raw';
import fragmentShader from './shaders/fragment.wgsl?raw';
import atmosphereLutShader from './shaders/compute/atmosphere-lut.wgsl?raw';
import cloudLutShader from './shaders/compute/cloud-lut.wgsl?raw';

const ATMOSPHERE_LUT_WIDTH = 256;
const ATMOSPHERE_LUT_HEIGHT = 128;
const CLOUD_LUT_WIDTH = 512;
const CLOUD_LUT_HEIGHT = 256;

const material = defineMaterial({
	defines: {
		PI: 3.141592653589793,
		DEG_TO_RAD: 0.017453292519943295,
		SUN_INTENSITY: 2,
		MOON_ANGULAR_RADIUS: 0.0047,
		MOONLIGHT_INTENSITY: 0.028,
		MAX_SUN_ELEVATION: 10,
		MAX_SUN_AZIMUTH: 10,
		MAX_MOON_ELEVATION: 10,
		CAMERA_SIN_PITCH: 0.001745328,
		CAMERA_COS_PITCH: 0.99998477,
		CAMERA_TAN_HALF_FOV: 0.243389326,
		WATER_CAMERA_HEIGHT: 5.5,
		WATER_SCALE: 2,
		WATER_DEPTH: 1,
		WATER_ROUGHNESS: 0.7,
		WATER_IOR: 1.333,
		WATER_ABSORPTION: { type: 'vec3f', value: [0.72, 0.2, 0.075] },
		INTERSECTION_WAVE_ITERATIONS: { type: 'i32', value: 8 },
		BRACKET_WAVE_ITERATIONS: { type: 'i32', value: 8 },
		MAX_NORMAL_WAVE_ITERATIONS: { type: 'i32', value: 8 },
		WATER_BRACKET_STEPS: { type: 'i32', value: 16 },
		WATER_REFINEMENT_STEPS: { type: 'i32', value: 8 },
		ISLAND_CENTER: { type: 'vec2f', value: [-5, 48] },
		ISLAND_RADIUS: { type: 'vec2f', value: [3.7, 2.9] },
		ISLAND_SEABED_RADIUS: { type: 'vec2f', value: [103, 42.5] },
		ISLAND_SEABED_OFFSET: { type: 'vec2f', value: [10, 10] },
		ISLAND_SEABED_ROTATION: 10,
		ISLAND_SEABED_SLOPE_POWER: 10.18,
		PALM_POSITION: { type: 'vec2f', value: [-4.85, 47.8] },
		PALM_HEIGHT: 5.9,
		PALM_LEAF_COUNT: { type: 'i32', value: 6 },
		PALM_MARCH_STEPS: { type: 'i32', value: 84 },
		SUN_RADIUS_RADIANS: 0.003228859,
		SUN_DISC_COS_OUTER: 0.999975679,
		SUN_DISC_COS_INNER: 0.999982352,
		SUN_DISC_COS_RADIUS: 0.999979149
	},
	includes: {
		common,
		stars,
		water,
		island,
		palm,
		seabed,
		atmosphere
	},
	fragment: fragmentShader,
	textures: {
		solarAtmosphereLut: {
			storage: true,
			format: 'rgba16float',
			width: ATMOSPHERE_LUT_WIDTH,
			height: ATMOSPHERE_LUT_HEIGHT,
			filter: 'linear'
		},
		lunarAtmosphereLut: {
			storage: true,
			format: 'rgba16float',
			width: ATMOSPHERE_LUT_WIDTH,
			height: ATMOSPHERE_LUT_HEIGHT,
			filter: 'linear'
		},
		cloudLut: {
			storage: true,
			format: 'rgba16float',
			width: CLOUD_LUT_WIDTH,
			height: CLOUD_LUT_HEIGHT,
			filter: 'linear'
		}
	},
	storageBuffers: {
		lightingState: {
			size: 2 * 4 * Float32Array.BYTES_PER_ELEMENT,
			type: 'array<vec4f>',
			access: 'read-write'
		}
	},
	uniforms: {
		uTimeOfDay: { type: 'f32', value: 12 },
		uHorizonHaze: { type: 'f32', value: 1 },
		uExposure: { type: 'f32', value: 1 },
		uWaveSpeed: { type: 'f32', value: 1 },
		uCloudCoverage: { type: 'f32', value: 1 },
		uCloudSpeed: { type: 'f32', value: 0.55 },
		uStarDensity: { type: 'f32', value: 2 },
		uStarSize: { type: 'f32', value: 0.75 },
		uStarBrightness: { type: 'f32', value: 2 },
		uSeabedLevel: { type: 'f32', value: -2 }
	}
});

const atmosphereLutPass = new ComputePass({
	compute: atmosphereLutShader,
	dispatch: [ATMOSPHERE_LUT_WIDTH / 8, ATMOSPHERE_LUT_HEIGHT / 8],
	resources: {
		solarAtmosphereLut: { texture: 'solarAtmosphereLut', access: 'storage-write' },
		lunarAtmosphereLut: { texture: 'lunarAtmosphereLut', access: 'storage-write' },
		lightingState: { buffer: 'lightingState', access: 'storage-read-write' }
	}
});

const cloudLutPass = new ComputePass({
	compute: cloudLutShader,
	dispatch: [CLOUD_LUT_WIDTH / 8, CLOUD_LUT_HEIGHT / 8],
	resources: {
		cloudLut: { texture: 'cloudLut', access: 'storage-write' }
	}
});
</script>

<template>
	<FragCanvas
		:material="material"
		:passes="[atmosphereLutPass, cloudLutPass]"
		render-mode="always"
		:color="{ outputEncoding: 'linear', dynamicRange: 'auto', canvasColorSpace: 'display-p3' }"
	>
		<Runtime />
	</FragCanvas>
</template>
