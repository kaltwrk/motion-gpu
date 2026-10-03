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
		GLASS_ROTATION: 50.0,
		GLASS_REFRACTION: 1.0,
		GLASS_CHROMATIC_ABERRATION: 1.0,
		GLASS_PANEL_WIDTH: 0.5,
		GLASS_WAVE_FREQUENCY: 0.6,
		GLASS_WAVE_AMPLITUDE: 0.6,
		GLASS_SPEED: 0.5
	},
	fragment: fragmentShader,
	textures: {
		uImage: {
			flipY: true,
			colorSpace: 'srgb',
			generateMipmaps: false
		}
	}
});

export default function App() {
	return (
		<FragCanvas
			material={material}
			color={{ outputEncoding: 'srgb', dynamicRange: 'sdr', canvasColorSpace: 'srgb' }}
		>
			<Runtime />
		</FragCanvas>
	);
}
