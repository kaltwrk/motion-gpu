<script>
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
	import fragmentShader from './shaders/fragment.wgsl?raw';

	const material = defineMaterial({
		fragment: fragmentShader
	});
</script>

<FragCanvas
	{material}
	color={{ outputEncoding: 'linear', dynamicRange: 'auto', canvasColorSpace: 'display-p3' }}
/>
