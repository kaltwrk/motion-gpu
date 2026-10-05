import { defineMaterial, type SpektralErrorReport } from 'spektral';
import { studioCameraDefines } from '../../demo-shared/camera';
import { createStudioPresentation } from '../../demo-shared/presentation';
import studioShader from '../../demo-shared/studio.wgsl?raw';
import fragmentShader from './shaders/fragment.wgsl?raw';

export function createSignalScene() {
	const material = defineMaterial({
		fragment: fragmentShader,
		includes: { studio: studioShader },
		defines: studioCameraDefines,
		uniforms: {
			uReady: 0,
			uPlaying: 0,
			uInspect: [0, 0],
			uRaster: [1, 1, 0, 0],
			uBoot: 0,
			uPower: 0
		},
		textures: {
			uLabels: {
				colorSpace: 'linear',
				update: 'once',
				generateMipmaps: true,
				filter: 'linear',
				addressModeU: 'clamp-to-edge',
				addressModeV: 'clamp-to-edge'
			},
			uVideo: {
				colorSpace: 'srgb',
				update: 'perFrame',
				filter: 'linear',
				addressModeU: 'clamp-to-edge',
				addressModeV: 'clamp-to-edge'
			}
		}
	});
	return { material, passes: [createStudioPresentation()] };
}

export function reportSceneError(report: SpektralErrorReport) {
	console.error('Signal', report);
}
