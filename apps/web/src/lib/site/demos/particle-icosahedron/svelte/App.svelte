<script lang="ts">
	/*
	 * Created by Marek Jóźwiak @madebyhex
	 *
	 * License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
	 * SPDX-License-Identifier: CC-BY-NC-SA-4.0
	 *
	 * You are free to share and adapt this work under the terms of the license.
	 * https://creativecommons.org/licenses/by-nc-sa/4.0/
	 */
	import { ComputePass, FragCanvas, defineMaterial } from 'spektral/svelte';
	import Runtime from './runtime.svelte';
	import fragmentShader from './shaders/fragment.wgsl?raw';
	import clearDensityShader from './shaders/compute/clear-density.wgsl?raw';
	import simulateShader from './shaders/compute/simulate.wgsl?raw';

	const FACE_COUNT = 20;
	const PARTICLES_PER_FACE = 128000;
	const PARTICLE_COUNT = FACE_COUNT * PARTICLES_PER_FACE;
	const FLOATS_PER_PARTICLE = 5;
	const PARTICLE_STORAGE_SHARDS = 4;
	const SHARD_PARTICLE_CAPACITY = Math.ceil(PARTICLE_COUNT / PARTICLE_STORAGE_SHARDS);
	const TEX_SIZE = 2056;

	const particleShards = Array.from({ length: PARTICLE_STORAGE_SHARDS }, (_, shard) => {
		const start = shard * SHARD_PARTICLE_CAPACITY;
		const count = Math.max(0, Math.min(SHARD_PARTICLE_CAPACITY, PARTICLE_COUNT - start));
		return {
			name: `particles${shard}`,
			count,
			data: new Float32Array(count * FLOATS_PER_PARTICLE)
		};
	}).filter((shard) => shard.count > 0);

	for (let face = 0; face < FACE_COUNT; face++) {
		for (let i = 0; i < PARTICLES_PER_FACE; i++) {
			const index = face * PARTICLES_PER_FACE + i;
			const shardIndex = Math.floor(index / SHARD_PARTICLE_CAPACITY);
			const localIndex = index - shardIndex * SHARD_PARTICLE_CAPACITY;
			const shard = particleShards[shardIndex];
			if (!shard) {
				continue;
			}

			const base = localIndex * FLOATS_PER_PARTICLE;

			let u = Math.random();
			let v = Math.random();
			if (u + v > 1) {
				u = 1 - u;
				v = 1 - v;
			}

			shard.data[base] = u;
			shard.data[base + 1] = v;
			shard.data[base + 2] = Math.random() * Math.PI * 2;
			shard.data[base + 3] = 0.35 + Math.random() * 0.9;
			shard.data[base + 4] = Math.random();
		}
	}

	const storageBuffers = Object.fromEntries(
		particleShards.map((shard) => [
			shard.name,
			{
				size: shard.data.byteLength,
				type: 'array<f32>' as const,
				access: 'read' as const,
				initialData: shard.data
			}
		])
	);

	const material = defineMaterial({
		fragment: fragmentShader,
		textures: {
			densityMap: {
				storage: true,
				format: 'rgba16float',
				width: TEX_SIZE,
				height: TEX_SIZE,
				filter: 'linear'
			},
			densityFrame: {
				storage: true,
				format: 'r32float',
				width: TEX_SIZE,
				height: TEX_SIZE,
				filter: 'nearest'
			}
		},
		storageBuffers,
		uniforms: {
			uRotateY: 0,
			uRotateX: 0,
			uFrameId: 0
		}
	});

	const clearDensity = new ComputePass({
		compute: clearDensityShader,
		dispatch: [Math.ceil(TEX_SIZE / 16), Math.ceil(TEX_SIZE / 16)],
		enabled: false,
		resources: {
			densityMap: { texture: 'densityMap', access: 'storage-write' },
			densityFrame: { texture: 'densityFrame', access: 'storage-write' }
		}
	});

	const simulate = new ComputePass({
		compute: simulateShader,
		dispatch: [Math.ceil(PARTICLE_COUNT / 256)],
		resources: {
			densityMap: { texture: 'densityMap', access: 'storage-write' },
			densityFrame: { texture: 'densityFrame', access: 'storage-write' },
			particles0: { buffer: 'particles0', access: 'storage-read' },
			particles1: { buffer: 'particles1', access: 'storage-read' },
			particles2: { buffer: 'particles2', access: 'storage-read' },
			particles3: { buffer: 'particles3', access: 'storage-read' }
		}
	});
</script>

<FragCanvas
	{material}
	passes={[clearDensity, simulate]}
	color={{ outputEncoding: 'linear', dynamicRange: 'auto', canvasColorSpace: 'display-p3' }}
>
	<Runtime {clearDensity} {simulate} />
</FragCanvas>
