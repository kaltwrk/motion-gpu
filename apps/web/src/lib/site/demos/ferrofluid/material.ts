import { defineMaterial, PingPongComputePass, type SpektralErrorReport } from 'spektral';
import { studioCameraDefines } from '../../demo-shared/camera';
import { createStudioPresentation } from '../../demo-shared/presentation';
import studioShader from '../../demo-shared/studio.wgsl?raw';
import fragmentShader from './shaders/fragment.wgsl?raw';
import simulationShader from './shaders/simulate.wgsl?raw';

export const simulationIterations = 2;

export function createFerrofluidScene() {
	const material = defineMaterial({
		fragment: fragmentShader,
		includes: { studio: studioShader },
		defines: studioCameraDefines,
		uniforms: {
			uMagnet: [0, 0, 0.8, 0],
			uStep: 1 / 120
		},
		textures: {
			uFluid: {
				storage: true,
				format: 'rgba16float',
				width: 384,
				height: 384,
				filter: 'linear',
				addressModeU: 'clamp-to-edge',
				addressModeV: 'clamp-to-edge'
			}
		}
	});
	const simulation = new PingPongComputePass({
		label: 'Ferrofluid surface relaxation',
		compute: simulationShader,
		resources: {
			previousState: { texture: 'uFluid', access: 'sampled', pingPong: 'read' },
			nextState: { texture: 'uFluid', access: 'storage-write', pingPong: 'write' }
		},
		iterations: simulationIterations,
		dispatch: [48, 48, 1]
	});
	return { material, passes: [simulation, createStudioPresentation()] };
}

export function reportSceneError(report: SpektralErrorReport) {
	console.error('Ferrofluid', report);
}
