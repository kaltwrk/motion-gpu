import { resolveTextureFormatCapabilities } from '../core/format-capabilities.js';
import { preprocessMaterialFragment, type MaterialLineMap } from '../core/material-preprocess.js';
import type { MaterialDefines, MaterialIncludes } from '../core/material.js';
import { managedPassBrand, selectFeedbackOwner } from '../core/pass-brand.js';
import { assertUniformName } from '../core/uniforms.js';

const FRAGMENT_FUNCTION_SIGNATURE_PATTERN =
	/\bfn[ \t\r\n]+frag[ \t\r\n]*\(([^)]*)\)[ \t\r\n]*->[ \t\r\n]*([A-Za-z_][A-Za-z0-9_<>]*)[ \t\r\n]*(?:\{|$)/m;
const FRAGMENT_FUNCTION_NAME_PATTERN = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

export interface PingPongShaderPassOptions<
	TDefineKey extends string = string,
	TIncludeKey extends string = string
> {
	/** Optional human-readable label exposed by render-graph diagnostics. */
	label?: string;
	/**
	 * Fragment WGSL source containing `fn frag(uv: vec2f) -> vec4f`.
	 *
	 * The generated shader exposes `spektralPreviousSampler` and
	 * `spektralPrevious` for reading the previous ping-pong state.
	 */
	fragment: string;
	/**
	 * Material texture key that will receive the latest ping-pong output.
	 */
	target: string;
	/**
	 * Explicit simulation texture width. If omitted, derived from canvas width * scale.
	 */
	width?: number;
	/**
	 * Explicit simulation texture height. If omitted, derived from canvas height * scale.
	 */
	height?: number;
	/**
	 * Canvas-relative scale for implicit dimensions.
	 */
	scale?: number;
	/**
	 * Ping-pong render texture format. Default: `rgba16float`.
	 */
	format?: GPUTextureFormat;
	/**
	 * Previous-state sampler filter. Default: `linear`.
	 */
	filter?: GPUFilterMode;
	/**
	 * Previous-state sampler U address mode. Default: `clamp-to-edge`.
	 */
	addressModeU?: GPUAddressMode;
	/**
	 * Previous-state sampler V address mode. Default: `clamp-to-edge`.
	 */
	addressModeV?: GPUAddressMode;
	/**
	 * Number of fragment iterations per frame. Default: 1.
	 */
	iterations?: number;
	/**
	 * Color used to initialize/reset both ping-pong textures. Default: transparent black.
	 */
	clearColor?: [number, number, number, number];
	/**
	 * Optional compile-time define constants injected before the fragment.
	 */
	defines?: MaterialDefines<TDefineKey>;
	/**
	 * Optional WGSL include chunks used by `#include <name>` directives.
	 */
	includes?: MaterialIncludes<TIncludeKey>;
	/**
	 * Enables/disables this pass.
	 */
	enabled?: boolean;
}

function normalizeSignaturePart(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function listFunctionNames(fragment: string): string[] {
	const names = new Set<string>();
	for (const match of fragment.matchAll(FRAGMENT_FUNCTION_NAME_PATTERN)) {
		const name = match[1];
		if (name) {
			names.add(name);
		}
	}

	return Array.from(names);
}

function assertFragmentContract(fragment: string): void {
	if (typeof fragment !== 'string' || fragment.trim().length === 0) {
		throw new Error('PingPongShaderPass fragment must be a non-empty WGSL string.');
	}

	const signature = fragment.match(FRAGMENT_FUNCTION_SIGNATURE_PATTERN);
	if (!signature) {
		const discoveredFunctions = listFunctionNames(fragment).slice(0, 4);
		const discoveredLabel =
			discoveredFunctions.length > 0
				? `Found: ${discoveredFunctions.map((name) => `\`${name}(...)\``).join(', ')}.`
				: 'No WGSL function declarations were found.';

		throw new Error(
			`PingPongShaderPass fragment contract mismatch: missing entrypoint \`fn frag(uv: vec2f) -> vec4f\`. ${discoveredLabel}`
		);
	}

	const params = normalizeSignaturePart(signature[1] ?? '');
	const returnType = normalizeSignaturePart(signature[2] ?? '');

	if (params !== 'uv: vec2f') {
		throw new Error(
			`PingPongShaderPass fragment contract mismatch for \`frag\`: expected parameter list \`(uv: vec2f)\`, received \`(${params || '...'})\`.`
		);
	}

	if (returnType !== 'vec4f') {
		throw new Error(
			`PingPongShaderPass fragment contract mismatch for \`frag\`: expected return type \`vec4f\`, received \`${returnType}\`.`
		);
	}
}

function assertPositiveFinite(name: string, value: number): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a finite number greater than 0`);
	}
}

function assertIterations(count: number): number {
	if (!Number.isFinite(count) || count < 1 || !Number.isInteger(count)) {
		throw new Error(`PingPongShaderPass iterations must be a positive integer >= 1, got ${count}`);
	}
	return count;
}

function assertFloatSampledFormat(format: GPUTextureFormat): GPUTextureFormat {
	const sampleType = resolveTextureFormatCapabilities(format).sampleType;
	if (sampleType !== 'float' && sampleType !== 'unfilterable-float') {
		throw new Error(
			`PingPongShaderPass format "${format}" must be float-sampled so fragment shaders can read the previous state.`
		);
	}
	return format;
}

function cloneColor(color: [number, number, number, number]): [number, number, number, number] {
	return [color[0], color[1], color[2], color[3]];
}

function resolveDimension(
	explicitValue: number | undefined,
	canvasDimension: number,
	scale: number
): number {
	if (explicitValue !== undefined) {
		assertPositiveFinite('PingPongShaderPass dimension', explicitValue);
		return Math.max(1, Math.floor(explicitValue));
	}

	return Math.max(1, Math.floor(canvasDimension * scale));
}

/**
 * Fragment-shader feedback pass for iterative GPU simulations.
 *
 * The renderer owns two render textures, alternates read/write direction per
 * iteration, then exposes the latest texture view through the declared material
 * texture slot.
 */
export class PingPongShaderPass {
	/** Internal nominal marker for renderer-managed feedback passes. */
	readonly [managedPassBrand] = 'feedback' as const;
	readonly label?: string;

	/**
	 * Enables/disables this pass without removing it from graph.
	 */
	enabled: boolean;

	/**
	 * Discriminant flag for render graph to identify fragment feedback passes.
	 */
	readonly isPingPongShader = true as const;

	private fragment: string;
	private fragmentLineMap: MaterialLineMap;
	private target: string;
	private width: number | undefined;
	private height: number | undefined;
	private scale: number;
	private format: GPUTextureFormat;
	private filter: GPUFilterMode;
	private addressModeU: GPUAddressMode;
	private addressModeV: GPUAddressMode;
	private iterations: number;
	private clearColor: [number, number, number, number];
	private state = { totalIterations: 0, resetPending: true };
	private ownerStates = new WeakMap<object, typeof this.state>();

	constructor(options: PingPongShaderPassOptions) {
		assertUniformName(options.target);
		const preprocessed = preprocessMaterialFragment({
			fragment: options.fragment,
			...(options.defines !== undefined ? { defines: options.defines } : {}),
			...(options.includes !== undefined ? { includes: options.includes } : {})
		});
		assertFragmentContract(preprocessed.fragment);
		this.fragment = preprocessed.fragment;
		if (options.label !== undefined) this.label = options.label;
		this.fragmentLineMap = preprocessed.lineMap;
		this.target = options.target;
		this.width = options.width;
		this.height = options.height;
		this.scale = options.scale ?? 1;
		assertPositiveFinite('PingPongShaderPass scale', this.scale);
		if (this.width !== undefined) {
			assertPositiveFinite('PingPongShaderPass width', this.width);
		}
		if (this.height !== undefined) {
			assertPositiveFinite('PingPongShaderPass height', this.height);
		}
		this.format = assertFloatSampledFormat(options.format ?? 'rgba16float');
		this.filter = options.filter ?? 'linear';
		this.addressModeU = options.addressModeU ?? 'clamp-to-edge';
		this.addressModeV = options.addressModeV ?? 'clamp-to-edge';
		this.iterations = assertIterations(options.iterations ?? 1);
		this.clearColor = cloneColor(options.clearColor ?? [0, 0, 0, 0]);
		this.enabled = options.enabled ?? true;
	}

	/**
	 * Replaces fragment source and updates define/include preprocessing.
	 */
	setFragment(
		fragment: string,
		options?: {
			defines?: MaterialDefines;
			includes?: MaterialIncludes;
		}
	): void {
		const preprocessed = preprocessMaterialFragment({
			fragment,
			...(options?.defines !== undefined ? { defines: options.defines } : {}),
			...(options?.includes !== undefined ? { includes: options.includes } : {})
		});
		assertFragmentContract(preprocessed.fragment);
		this.fragment = preprocessed.fragment;
		this.fragmentLineMap = preprocessed.lineMap;
	}

	/**
	 * Updates iteration count.
	 */
	setIterations(count: number): void {
		this.iterations = assertIterations(count);
	}

	/**
	 * Updates explicit dimensions. Passing `undefined` returns that axis to scale-based sizing.
	 */
	setDimensions(width?: number, height?: number): void {
		if (width !== undefined) {
			assertPositiveFinite('PingPongShaderPass width', width);
		}
		if (height !== undefined) {
			assertPositiveFinite('PingPongShaderPass height', height);
		}
		this.width = width;
		this.height = height;
		this.reset();
	}

	/**
	 * Updates canvas-relative scale used for implicit dimensions.
	 */
	setScale(scale: number): void {
		assertPositiveFinite('PingPongShaderPass scale', scale);
		this.scale = scale;
		this.reset();
	}

	/**
	 * Requests both ping-pong textures to be cleared before the next iteration.
	 */
	reset(clearColor?: [number, number, number, number]): void {
		if (clearColor) {
			this.clearColor = cloneColor(clearColor);
		}
		this.state = { totalIterations: 0, resetPending: true };
		this.ownerStates = new WeakMap();
	}

	/** @internal The texture-pair identity also resets state after reallocation. */
	[selectFeedbackOwner](owner: object): void {
		let state = this.ownerStates.get(owner);
		if (!state) {
			state = { totalIterations: 0, resetPending: true };
			this.ownerStates.set(owner, state);
		}
		this.state = state;
	}

	/**
	 * Returns and clears the pending reset color for renderer use.
	 */
	consumeResetColor(): [number, number, number, number] | null {
		if (!this.state.resetPending) {
			return null;
		}
		this.state.resetPending = false;
		return cloneColor(this.clearColor);
	}

	/**
	 * Returns the texture key holding the latest result for the last rendered owner.
	 */
	getCurrentOutput(): string {
		return this.state.totalIterations % 2 === 0 ? `${this.target}A` : `${this.target}B`;
	}

	/**
	 * Advances the iteration accumulator by the current iteration count.
	 */
	advanceFrame(): void {
		this.state.totalIterations += this.iterations;
	}

	resolveSize(canvasSize: { width: number; height: number }): { width: number; height: number } {
		return {
			width: resolveDimension(this.width, canvasSize.width, this.scale),
			height: resolveDimension(this.height, canvasSize.height, this.scale)
		};
	}

	getTarget(): string {
		return this.target;
	}

	getFragment(): string {
		return this.fragment;
	}

	getFragmentLineMap(): MaterialLineMap {
		return [...this.fragmentLineMap];
	}

	getIterations(): number {
		return this.iterations;
	}

	getFormat(): GPUTextureFormat {
		return this.format;
	}

	getFilter(): GPUFilterMode {
		return this.filter;
	}

	getAddressModeU(): GPUAddressMode {
		return this.addressModeU;
	}

	getAddressModeV(): GPUAddressMode {
		return this.addressModeV;
	}

	getClearColor(): [number, number, number, number] {
		return cloneColor(this.clearColor);
	}

	dispose(): void {
		// No-op: GPU resources are managed by the renderer.
	}
}
