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
	import { FragCanvas, defineMaterial } from 'spektral/svelte';
	import Runtime from './runtime.svelte';
	import fragmentShader from './shaders/fragment.wgsl?raw';

	const material = defineMaterial({
		uniforms: {
			uImpact0: { type: 'vec4f', value: [0, 0, 1, -100] },
			uImpact1: { type: 'vec4f', value: [0, 0, 1, -100] },
			uImpact2: { type: 'vec4f', value: [0, 0, 1, -100] },
			uImpact3: { type: 'vec4f', value: [0, 0, 1, -100] },
			uImpact4: { type: 'vec4f', value: [0, 0, 1, -100] },
			uImpact5: { type: 'vec4f', value: [0, 0, 1, -100] },
			uImpact6: { type: 'vec4f', value: [0, 0, 1, -100] },
			uImpact7: { type: 'vec4f', value: [0, 0, 1, -100] },
			uLens: { type: 'f32', value: 1.0 }
		},
		fragment: fragmentShader
	});
</script>

<FragCanvas
	{material}
	color={{ outputEncoding: 'linear', dynamicRange: 'auto', canvasColorSpace: 'display-p3' }}
>
	<Runtime />
</FragCanvas>
