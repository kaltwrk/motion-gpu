import { defineMaterial, type SpektralErrorReport } from 'spektral';
import { studioCameraDefines } from '../../demo-shared/camera';
import { createStudioPresentation } from '../../demo-shared/presentation';
import studioShader from '../../demo-shared/studio.wgsl?raw';
import fragmentShader from './shaders/fragment.wgsl?raw';
import { readNixieDigits } from './clock';
import { createNixieBloom } from './bloom';

export function createNixieScene() {
	const woodSampling = {
		update: 'once',
		generateMipmaps: true,
		filter: 'linear',
		addressModeU: 'repeat',
		addressModeV: 'repeat'
	} as const;
	const digits = readNixieDigits(new Date(), 'time');
	const a: [number, number, number, number] = [digits[0], digits[1], digits[2], digits[3]];
	const b: [number, number, number, number] = [digits[4], digits[5], 0, 0];
	const material = defineMaterial({
		fragment: fragmentShader,
		includes: { studio: studioShader },
		defines: studioCameraDefines,
		uniforms: {
			uDigitsA: a,
			uDigitsB: b,
			uPreviousA: [...a],
			uPreviousB: [...b],
			uDigitMixA: [1, 1, 1, 1],
			uDigitMixB: [1, 1, 1, 1],
			uInspect: [0, 0],
			uBrightness: 1,
			uReady: 0,
			uWoodReady: 0
		},
		textures: {
			uWoodAlbedo: { ...woodSampling, colorSpace: 'srgb' },
			uWoodNormal: { ...woodSampling, colorSpace: 'linear' },
			uWoodRoughness: { ...woodSampling, colorSpace: 'linear' },
			uStamp: {
				colorSpace: 'linear',
				update: 'once',
				generateMipmaps: true,
				filter: 'linear',
				flipY: false,
				addressModeU: 'clamp-to-edge',
				addressModeV: 'clamp-to-edge'
			},
			uCathodes: {
				colorSpace: 'linear',
				update: 'once',
				generateMipmaps: true,
				filter: 'linear',
				addressModeU: 'clamp-to-edge',
				addressModeV: 'clamp-to-edge'
			}
		}
	});
	const bloom = createNixieBloom();
	return {
		material,
		renderTargets: bloom.renderTargets,
		passes: [...bloom.passes, createStudioPresentation()]
	};
}

export function reportSceneError(report: SpektralErrorReport) {
	console.error('Nixie', report);
}
