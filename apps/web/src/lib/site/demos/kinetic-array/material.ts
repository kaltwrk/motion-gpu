import { defineMaterial, type SpektralErrorReport } from 'spektral';
import { studioCameraDefines } from '../../demo-shared/camera';
import { createStudioPresentation } from '../../demo-shared/presentation';
import studioShader from '../../demo-shared/studio.wgsl?raw';
import fragmentShader from './shaders/fragment.wgsl?raw';
import geometryShader from './shaders/geometry.wgsl?raw';
import lightingShader from './shaders/lighting-cache.wgsl?raw';
import lightingLayoutShader from './shaders/lighting-layout.wgsl?raw';
import { createKineticSimulation } from './simulation';
import { createKineticLighting, kineticLightingDefines } from './lighting';
import { KINETIC_SCALE } from './geometry';

export function createKineticScene() {
	const simulation = createKineticSimulation();
	const defines = {
		...studioCameraDefines,
		...simulation.defines,
		...kineticLightingDefines,
		KINETIC_SCALE
	};
	const lighting = createKineticLighting(defines);
	const material = defineMaterial({
		fragment: fragmentShader,
		includes: {
			studio: studioShader,
			kineticGeometry: geometryShader,
			kineticLighting: lightingShader,
			kineticLightingLayout: lightingLayoutShader
		},
		defines,
		uniforms: { uStep: 1 / 60 },
		storageBuffers: simulation.storageBuffers,
		textures: lighting.textures
	});
	return {
		material,
		passes: [...simulation.passes, ...lighting.passes, createStudioPresentation()]
	};
}

export function reportSceneError(report: SpektralErrorReport) {
	console.error('Kinetic Array', report);
}
