/*
 * Created by Marek Jóźwiak @madebyhex
 *
 * License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
 * SPDX-License-Identifier: CC-BY-NC-SA-4.0
 *
 * You are free to share and adapt this work under the terms of the license.
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */
import { FragCanvas, PingPongComputePass, defineMaterial } from 'spektral/react';
import Runtime from './runtime';
import estimateMotionShader from './shaders/estimate-motion.wgsl?raw';
import fragmentShader from './shaders/fragment.wgsl?raw';
import dataMoshShader from './shaders/mosh.wgsl?raw';

const WIDTH = 1280;
const HEIGHT = 720;
const FLOW_WIDTH = WIDTH / 8;
const FLOW_HEIGHT = HEIGHT / 8;
const material = defineMaterial({
	fragment: fragmentShader,
	textures: {
		video: { update: 'perFrame', fragmentVisible: false, flipY: true },
		frameHistory: {
			storage: true,
			format: 'rgba16float',
			width: WIDTH,
			height: HEIGHT,
			fragmentVisible: false
		},
		motionVectors: {
			storage: true,
			format: 'rgba16float',
			width: FLOW_WIDTH,
			height: FLOW_HEIGHT,
			fragmentVisible: false
		},
		feedback: {
			storage: true,
			format: 'rgba16float',
			width: WIDTH,
			height: HEIGHT,
			filter: 'linear'
		}
	},
	uniforms: { uReset: 1 }
});

const estimateMotion = new PingPongComputePass({
	compute: estimateMotionShader,
	resources: {
		uVideo: { texture: 'video', access: 'sampled' },
		uFramePrevious: { texture: 'frameHistory', access: 'sampled', pingPong: 'read' },
		uFrameNext: { texture: 'frameHistory', access: 'storage-write', pingPong: 'write' },
		uMotionVectors: { texture: 'motionVectors', access: 'storage-write' }
	},
	dispatch: [Math.ceil(FLOW_WIDTH / 8), Math.ceil(FLOW_HEIGHT / 8)]
});

const dataMosh = new PingPongComputePass({
	compute: dataMoshShader,
	resources: {
		uVideo: { texture: 'video', access: 'sampled' },
		uMotionVectors: { texture: 'motionVectors', access: 'sampled' },
		uMoshPrevious: { texture: 'feedback', access: 'sampled', pingPong: 'read' },
		uMoshNext: { texture: 'feedback', access: 'storage-write', pingPong: 'write' }
	},
	dispatch: [WIDTH / 8, Math.ceil(HEIGHT / 8)]
});

export default function App() {
	return (
		<FragCanvas
			material={material}
			passes={[dataMosh, estimateMotion]}
			renderMode="always"
			color={{ outputEncoding: 'srgb', dynamicRange: 'sdr', canvasColorSpace: 'display-p3' }}
		>
			<Runtime />
		</FragCanvas>
	);
}
