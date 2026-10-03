/*
 * Created by Marek Jóźwiak @madebyhex
 *
 * License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
 * SPDX-License-Identifier: CC-BY-NC-SA-4.0
 *
 * You are free to share and adapt this work under the terms of the license.
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */
import { FragCanvas, defineMaterial } from 'spektral/react';
import utils from './shaders/includes/utils.wgsl?raw';
import transforms from './shaders/includes/transforms.wgsl?raw';
import logoSdf from './shaders/includes/logo-sdf.wgsl?raw';
import scene from './shaders/includes/scene.wgsl?raw';
import raymarch from './shaders/includes/raymarch.wgsl?raw';
import lighting from './shaders/includes/lighting.wgsl?raw';
import fragmentShader from './shaders/fragment.wgsl?raw';

const material = defineMaterial({
	defines: {
		MAX_STEPS: { type: 'i32', value: 72 },
		MAX_DIST: 20.0,
		SURF_DIST: 0.001,
		LOGO_HALF_DEPTH: 0.2,
		LOGO_INSET_BEVEL_RADIUS: 0.0025,
		LOGO_INSET_BEVEL_BITE: 0.025,
		PI: 3.14159265359
	},
	includes: {
		utils,
		transforms,
		logoSdf,
		scene,
		raymarch,
		lighting
	},
	fragment: fragmentShader
});

export default function App() {
	return (
		<FragCanvas
			material={material}
			color={{ outputEncoding: 'linear', dynamicRange: 'auto', canvasColorSpace: 'display-p3' }}
		/>
	);
}
