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
import Runtime from './runtime';
import fragmentShader from './shaders/fragment.wgsl?raw';

const material = defineMaterial({
	defines: {
		AMBIENT_LIGHT: 0.2,
		EPSILON: 0.001,
		GEM_ALPHA: 0.95,
		MAX_BOUNCES: { type: 'i32', value: 10 },
		MAX_DISTANCE: 20.0,
		MAX_STEPS: { type: 'i32', value: 120 },
		PI: 3.14159265359,
		SPECULAR_GAIN: 0.5,
		SPECULAR_SHARPNESS: 3.0
	},
	fragment: fragmentShader,
	uniforms: {
		uEdgeColor: { type: 'vec3f', value: [1.0, 1.0, 1.0] },
		uEdgeGain: { type: 'f32', value: 2.2 },
		uEdgePower: { type: 'f32', value: 5.2 },
		uOrbit: { type: 'vec2f', value: [0, 0] }
	}
});

export default function App() {
	return (
		<FragCanvas
			material={material}
			color={{ outputEncoding: 'linear', dynamicRange: 'auto', canvasColorSpace: 'display-p3' }}
		>
			<Runtime />
		</FragCanvas>
	);
}
