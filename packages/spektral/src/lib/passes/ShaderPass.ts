import { SPEKTRAL_FRAGMENT_CONTEXT_WGSL } from '../core/fragment-context.js';
import type { ShaderLineMap } from '../core/shader.js';
import {
	FullscreenPass,
	type FullscreenPassOptions,
	type FullscreenShaderProgram
} from './FullscreenPass.js';

const SHADER_PASS_CONTRACT =
	/\bfn\s+shade\s*\(\s*inputColor\s*:\s*vec4f\s*,\s*uv\s*:\s*vec2f\s*\)\s*->\s*vec4f/;

export interface ShaderPassOptions extends FullscreenPassOptions {
	fragment: string;
}

function countLines(source: string, end = source.length): number {
	let count = 1;
	for (let index = 0; index < end; index += 1) {
		if (source.charCodeAt(index) === 10) count += 1;
	}
	return count;
}

/** Builds ShaderPass WGSL plus a generated-line map that never confuses wrapper code with user code. */
export function buildShaderPassProgram(fragment: string): FullscreenShaderProgram {
	if (!SHADER_PASS_CONTRACT.test(fragment)) {
		throw new Error(
			'ShaderPass fragment must declare `fn shade(inputColor: vec4f, uv: vec2f) -> vec4f`.'
		);
	}

	const prefix = `
struct SpektralVertexOut {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@group(0) @binding(0) var spektralShaderPassSampler: sampler;
@group(0) @binding(1) var spektralShaderPassTexture: texture_2d<f32>;
${SPEKTRAL_FRAGMENT_CONTEXT_WGSL}

@vertex
fn spektralShaderPassVertex(@builtin(vertex_index) index: u32) -> SpektralVertexOut {
	var positions = array<vec2f, 3>(
		vec2f(-1.0, -3.0),
		vec2f(-1.0, 1.0),
		vec2f(3.0, 1.0)
	);

	let position = positions[index];
	var out: SpektralVertexOut;
	out.position = vec4f(position, 0.0, 1.0);
	out.uv = (position + vec2f(1.0, 1.0)) * 0.5;
	return out;
}

`;
	const suffix = `
@fragment
fn spektralShaderPassFragment(in: SpektralVertexOut) -> @location(0) vec4f {
	spektralFragment.uv = in.uv;
	// Preserve shader UVs while sampling the same pixel in texture coordinates.
	let textureUv = vec2f(in.uv.x, 1.0 - in.uv.y);
	let inputColor = textureSample(spektralShaderPassTexture, spektralShaderPassSampler, textureUv);
	return shade(inputColor, in.uv);
}
`;
	const code = `${prefix}${fragment}${suffix}`;
	const lineCount = countLines(code);
	const lineMap: ShaderLineMap = new Array(lineCount + 1);
	for (let line = 1; line <= lineCount; line += 1) {
		lineMap[line] = { kind: 'wrapper', line };
	}
	const fragmentStartLine = countLines(prefix);
	const fragmentLineCount = countLines(fragment);
	for (let line = 0; line < fragmentLineCount; line += 1) {
		lineMap[fragmentStartLine + line] = { kind: 'fragment', line: line + 1 };
	}
	return { code, lineMap, fragmentSource: fragment };
}

/**
 * Fullscreen programmable shader pass.
 */
export class ShaderPass extends FullscreenPass {
	private fragment: string;
	private program: FullscreenShaderProgram;

	constructor(options: ShaderPassOptions) {
		super('ShaderPass', options);
		this.fragment = options.fragment;
		this.program = buildShaderPassProgram(options.fragment);
	}

	/**
	 * Replaces current shader fragment and invalidates pipeline cache.
	 */
	setFragment(fragment: string): void {
		const nextProgram = buildShaderPassProgram(fragment);
		this.fragment = fragment;
		this.program = nextProgram;
		this.invalidateFullscreenCache();
	}

	getFragment(): string {
		return this.fragment;
	}

	protected getProgram(): FullscreenShaderProgram {
		return this.program;
	}

	protected getVertexEntryPoint(): string {
		return 'spektralShaderPassVertex';
	}

	protected getFragmentEntryPoint(): string {
		return 'spektralShaderPassFragment';
	}
}
