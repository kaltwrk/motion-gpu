import { ShaderPass, type ColorPipelineOptions } from 'spektral';
import presentationShader from './presentation.wgsl?raw';

// The studio pass encodes SDR itself so dithering happens after tone mapping and sRGB.
// Keep intermediate radiance in float buffers and disable the canvas's second transform.
export const studioColor = {
	toneMapping: 'none',
	outputEncoding: 'linear',
	dynamicRange: 'sdr',
	workingFormat: 'rgba16float'
} satisfies ColorPipelineOptions;

export function createStudioPresentation() {
	return new ShaderPass({
		label: 'Studio presentation',
		fragment: presentationShader,
		input: 'source',
		output: 'target',
		needsSwap: true
	});
}
