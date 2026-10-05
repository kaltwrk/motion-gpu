import { defineMaterial, type SpektralErrorReport, type TextureDefinition } from 'spektral';
import { studioCameraDefines } from '../../demo-shared/camera';
import { createStudioPresentation } from '../../demo-shared/presentation';
import studioShader from '../../demo-shared/studio.wgsl?raw';
import fragmentShader from './shaders/fragment.wgsl?raw';

const sampledSurface = {
	colorSpace: 'linear',
	update: 'once',
	generateMipmaps: true,
	filter: 'linear',
	anisotropy: 8,
	addressModeU: 'repeat',
	addressModeV: 'repeat'
} satisfies TextureDefinition;

export function createAmberScene() {
	const material = defineMaterial({
		fragment: fragmentShader,
		includes: { studio: studioShader },
		defines: studioCameraDefines,
		uniforms: {
			uInspect: [0, 0],
			uRotation: 0,
			uReveal: 0,
			uReady: 0
		},
		textures: {
			uAlbedo: { ...sampledSurface, colorSpace: 'srgb' },
			uNormal: sampledSurface,
			uRoughness: sampledSurface,
			uHeight: sampledSurface,
			uAO: sampledSurface
		}
	});
	return { material, passes: [createStudioPresentation()] };
}

export function reportSceneError(report: SpektralErrorReport) {
	console.error('Amber', report);
}
