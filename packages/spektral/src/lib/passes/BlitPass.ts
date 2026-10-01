import type { ShaderLineMap } from '../core/shader.js';
import {
	FullscreenPass,
	type FullscreenPassOptions,
	type FullscreenShaderProgram
} from './FullscreenPass.js';

const FULLSCREEN_BLIT_SHADER = `
struct SpektralVertexOut {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@group(0) @binding(0) var spektralBlitSampler: sampler;
@group(0) @binding(1) var spektralBlitTexture: texture_2d<f32>;

@vertex
fn spektralBlitVertex(@builtin(vertex_index) index: u32) -> SpektralVertexOut {
	var positions = array<vec2f, 3>(
		vec2f(-1.0, -3.0),
		vec2f(-1.0, 1.0),
		vec2f(3.0, 1.0)
	);

	let position = positions[index];
	var out: SpektralVertexOut;
	out.position = vec4f(position, 0.0, 1.0);
	// Clip-space Y points up; texture-space Y points down.
	out.uv = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
	return out;
}

@fragment
fn spektralBlitFragment(in: SpektralVertexOut) -> @location(0) vec4f {
	return textureSample(spektralBlitTexture, spektralBlitSampler, in.uv);
}
`;

const BLIT_LINE_MAP: ShaderLineMap = (() => {
	const lines = FULLSCREEN_BLIT_SHADER.split('\n');
	const map: ShaderLineMap = new Array(lines.length + 1);
	for (let line = 1; line <= lines.length; line += 1) map[line] = { kind: 'wrapper', line };
	return map;
})();

const FULLSCREEN_BLIT_PROGRAM: FullscreenShaderProgram = {
	code: FULLSCREEN_BLIT_SHADER,
	lineMap: BLIT_LINE_MAP,
	fragmentSource: ''
};

export type BlitPassOptions = FullscreenPassOptions;

/**
 * Fullscreen texture blit pass.
 */
export class BlitPass extends FullscreenPass {
	protected getProgram(): FullscreenShaderProgram {
		return FULLSCREEN_BLIT_PROGRAM;
	}

	constructor(options: BlitPassOptions = {}) {
		super('BlitPass', options);
	}

	protected getVertexEntryPoint(): string {
		return 'spektralBlitVertex';
	}

	protected getFragmentEntryPoint(): string {
		return 'spektralBlitFragment';
	}
}
