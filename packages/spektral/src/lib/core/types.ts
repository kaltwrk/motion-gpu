/**
 * Core runtime and API contracts used by Spektral's renderer, hooks and scheduler.
 */

import type { MaterialLineMap } from './material-contracts.js';
import { managedPassBrand } from './pass-brand.js';

/**
 * WGSL-compatible uniform primitive and aggregate types supported by Spektral.
 */
export type UniformType = 'f32' | 'vec2f' | 'vec3f' | 'vec4f' | 'mat4x4f';

type NumericTypedArray = Float32Array | Uint32Array | Int32Array;
type TypedArrayMutator = 'copyWithin' | 'fill' | 'reverse' | 'set' | 'sort';

/**
 * Read-only structural view accepted from a mutable typed array without exposing its mutators.
 * `subarray` is narrowed as well because it aliases the same backing storage.
 */
type ReadonlyTypedArrayView<T extends NumericTypedArray> = Omit<
	Readonly<T>,
	TypedArrayMutator | 'subarray'
> & {
	readonly subarray: (begin?: number, end?: number) => ReadonlyTypedArrayView<T>;
};

/**
 * Explicitly typed uniform declaration.
 *
 * @typeParam TType - WGSL type tag.
 * @typeParam TValue - Runtime value shape for the selected type.
 */
/**
 * Accepted matrix value formats for `mat4x4f` uniforms.
 */
export type UniformMat4Value = readonly number[] | ReadonlyTypedArrayView<Float32Array>;

type ReadonlyUniformValue<TValue> = TValue extends NumericTypedArray
	? ReadonlyTypedArrayView<TValue>
	: TValue extends readonly number[]
		? Readonly<TValue>
		: TValue;

/**
 * Runtime value shape by WGSL uniform type tag.
 */
export interface UniformValueByType {
	f32: number;
	vec2f: readonly [number, number];
	vec3f: readonly [number, number, number];
	vec4f: readonly [number, number, number, number];
	mat4x4f: UniformMat4Value;
}

export interface TypedUniform<
	TType extends UniformType = UniformType,
	TValue extends UniformValueByType[TType] = UniformValueByType[TType]
> {
	/**
	 * WGSL type tag.
	 */
	readonly type: TType;
	/**
	 * Runtime value matching {@link type}.
	 */
	readonly value: ReadonlyUniformValue<TValue>;
}

/**
 * Supported uniform input shapes accepted by material and render APIs.
 */
export type UniformValue =
	| number
	| readonly [number, number]
	| readonly [number, number, number]
	| readonly [number, number, number, number]
	| TypedUniform<'f32'>
	| TypedUniform<'vec2f'>
	| TypedUniform<'vec3f'>
	| TypedUniform<'vec4f'>
	| TypedUniform<'mat4x4f'>;

/**
 * Uniform map keyed by WGSL identifier names.
 */
export type UniformMap<TKey extends string = string> = Record<TKey, UniformValue>;

/**
 * Resolved layout metadata for a single uniform field inside the packed uniform buffer.
 */
export interface UniformLayoutEntry {
	/**
	 * Uniform field name.
	 */
	readonly name: string;
	/**
	 * WGSL field type.
	 */
	readonly type: UniformType;
	/**
	 * Byte offset within packed uniform buffer.
	 */
	readonly offset: number;
	/**
	 * Field byte size without trailing alignment padding.
	 */
	readonly size: number;
}

/**
 * GPU uniform buffer layout resolved from a {@link UniformMap} using WGSL alignment rules.
 */
export interface UniformLayout {
	/**
	 * Layout entries sorted by uniform name.
	 */
	readonly entries: readonly UniformLayoutEntry[];
	/**
	 * Fast lookup table by uniform name.
	 */
	readonly byName: Readonly<Record<string, UniformLayoutEntry>>;
	/**
	 * Final uniform buffer size in bytes.
	 */
	readonly byteLength: number;
}

/**
 * Supported runtime texture source types accepted by WebGPU uploads.
 */
export type TextureSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

/**
 * Texture payload with optional explicit dimensions.
 */
export interface TextureData {
	/**
	 * GPU-uploadable image source.
	 */
	readonly source: TextureSource;
	/**
	 * Optional explicit width override.
	 */
	readonly width?: number;
	/**
	 * Optional explicit height override.
	 */
	readonly height?: number;
	/**
	 * Optional runtime color space override.
	 */
	readonly colorSpace?: 'srgb' | 'linear';
	/**
	 * Optional runtime flip-y override.
	 */
	readonly flipY?: boolean;
	/**
	 * Optional runtime premultiplied-alpha override.
	 */
	readonly premultipliedAlpha?: boolean;
	/**
	 * Optional runtime mipmap generation override.
	 */
	readonly generateMipmaps?: boolean;
	/**
	 * Runtime update strategy override.
	 */
	readonly update?: TextureUpdateMode;
}

/**
 * Texture input accepted by renderer state APIs.
 */
export type TextureValue = TextureData | TextureSource | null;

/**
 * Texture update strategy for dynamic sources.
 */
export type TextureUpdateMode = 'once' | 'onInvalidate' | 'perFrame';

/**
 * Per-texture sampling and upload configuration.
 */
export interface TextureDefinition {
	/**
	 * Default/initial texture value for this slot.
	 *
	 * Unsupported when `storage` is true; storage textures are allocated from
	 * explicit dimensions and updated by compute passes.
	 */
	readonly source?: TextureValue;
	/**
	 * Source color space used for format/decode decisions when `format` is omitted.
	 */
	readonly colorSpace?: 'srgb' | 'linear';
	/**
	 * Vertical flip during upload.
	 */
	readonly flipY?: boolean;
	/**
	 * Enables mipmap generation.
	 */
	readonly generateMipmaps?: boolean;
	/**
	 * Enables premultiplied-alpha upload mode.
	 */
	readonly premultipliedAlpha?: boolean;
	/**
	 * Dynamic source update strategy.
	 */
	readonly update?: TextureUpdateMode;
	/**
	 * Sampler anisotropy level (clamped internally).
	 */
	readonly anisotropy?: number;
	/**
	 * Min/mag filter mode.
	 */
	readonly filter?: GPUFilterMode;
	/**
	 * U axis address mode.
	 */
	readonly addressModeU?: GPUAddressMode;
	/**
	 * V axis address mode.
	 */
	readonly addressModeV?: GPUAddressMode;
	/**
	 * When true, this texture is also writable by compute passes.
	 */
	readonly storage?: boolean;
	/**
	 * Required when storage is true. Must be a storage-compatible format.
	 * For sampled textures, an explicit format takes precedence over source `colorSpace`.
	 */
	readonly format?: GPUTextureFormat;
	/**
	 * Explicit texture width. Required when `storage` is true.
	 */
	readonly width?: number;
	/**
	 * Explicit texture height. Required when `storage` is true.
	 */
	readonly height?: number;
	/**
	 * When true, texture is visible (sampled) in fragment shader.
	 *
	 * Default: `true` for float-sampled formats, `false` for `*uint`/`*sint`
	 * storage formats (the fragment shader uses `texture_2d<f32>` and would
	 * fail WebGPU validation against integer sample types). Setting this to
	 * `true` for an integer storage format throws at material resolution.
	 */
	readonly fragmentVisible?: boolean;
}

/**
 * Texture definition map keyed by uniform-compatible texture names.
 */
export type TextureDefinitionMap<TKey extends string = string> = Record<TKey, TextureDefinition>;

/**
 * Runtime texture value map keyed by texture uniform names.
 */
export type TextureMap<TKey extends string = string> = Record<TKey, TextureValue>;

// ── Storage buffer types ────────────────────────────────────────────────────

/**
 * Access mode for storage buffers in compute shaders.
 */
export type StorageBufferAccess = 'read' | 'read-write';

/**
 * WGSL storage buffer element type.
 */
export type StorageBufferType =
	| 'array<f32>'
	| 'array<vec2f>'
	| 'array<vec3f>'
	| 'array<vec4f>'
	| 'array<u32>'
	| 'array<i32>'
	| 'array<vec4u>'
	| 'array<vec4i>';

/**
 * Definition of a single storage buffer resource.
 */
export interface StorageBufferDefinition {
	/**
	 * Buffer size in bytes. Must be > 0 and multiple of 4.
	 */
	readonly size: number;
	/**
	 * WGSL type annotation for codegen.
	 */
	readonly type: StorageBufferType;
	/**
	 * Access mode in compute shader. Default: 'read-write'.
	 */
	readonly access?: StorageBufferAccess;
	/**
	 * Initial data uploaded on creation.
	 */
	readonly initialData?:
		| ReadonlyTypedArrayView<Float32Array>
		| ReadonlyTypedArrayView<Uint32Array>
		| ReadonlyTypedArrayView<Int32Array>;
}

/**
 * Map of named storage buffer definitions.
 */
export type StorageBufferDefinitionMap<TKey extends string = string> = Record<
	TKey,
	StorageBufferDefinition
>;

// ── Compute resources ──────────────────────────────────────────────────────

/**
 * Resource version read by a read-only compute binding.
 *
 * `current` consumes the output of the resource's writer in the current frame.
 * `initial` consumes the value imported at the start of the frame.
 */
export type ComputeResourceVersion = 'current' | 'initial';

/**
 * Frame and device state passed to dynamic external-resource providers.
 */
export interface ComputeExternalResourceContext {
	/** GPU device owned by the active renderer. */
	device: GPUDevice;
	/** Current render width in physical pixels. */
	width: number;
	/** Current render height in physical pixels. */
	height: number;
	/** Elapsed frame time in seconds. */
	time: number;
	/** Delta from the previous rendered frame in seconds. */
	delta: number;
}

/**
 * Static external resource or a provider resolved once per rendered frame.
 */
export type ComputeExternalProvider<T> = T | ((context: ComputeExternalResourceContext) => T);

/**
 * Supported 2D texture subresource selection for compute bindings.
 */
export interface ComputeTextureViewDescriptor {
	/** First mip level exposed through the binding. Default: `0`. */
	baseMipLevel?: number;
	/** Number of exposed mip levels. Sampled bindings default to the remaining range. */
	mipLevelCount?: number;
	/** First array layer exposed through the binding. Default: `0`. */
	baseArrayLayer?: number;
	/** Spektral currently supports exactly one 2D array layer. */
	arrayLayerCount?: 1;
}

/**
 * Borrowed `GPUTexture` reference. Spektral never destroys the supplied texture.
 */
export interface ComputeExternalTextureReference {
	/** Static texture or provider returning the texture for the current frame. */
	externalTexture: ComputeExternalProvider<GPUTexture>;
	/** Stable logical identity shared by every reference to the same resource. */
	resourceId: string | symbol;
	/** Texture format used for WGSL and bind-group-layout resolution. */
	format: GPUTextureFormat;
	/** Usage flags declared when the texture was created. */
	usage: GPUTextureUsageFlags;
	/** Texture view dimension. Only `2d` is supported by this contract. */
	viewDimension?: '2d';
}

/**
 * Borrowed `GPUTextureView` reference with explicit parent-resource metadata.
 */
export interface ComputeExternalTextureViewReference {
	/** Static view or provider returning the view for the current frame. */
	externalView: ComputeExternalProvider<GPUTextureView>;
	/** Stable identity of the parent texture resource. */
	resourceId: string | symbol;
	/** Format of the supplied view. */
	format: GPUTextureFormat;
	/** Usage flags of the parent texture. */
	usage: GPUTextureUsageFlags;
	/** Texture view dimension. */
	viewDimension: '2d';
	/** Number of mip levels exposed by the supplied view. */
	mipLevelCount: number;
}

/**
 * Borrowed `GPUBuffer` reference. Spektral never destroys the supplied buffer.
 */
export interface ComputeExternalBufferReference {
	/** Static buffer or provider returning the buffer for the current frame. */
	externalBuffer: ComputeExternalProvider<GPUBuffer>;
	/** Stable logical identity shared by every reference to the same resource. */
	resourceId: string | symbol;
	/** WGSL storage-buffer type used for generated declarations. */
	wgslType: StorageBufferType;
	/** Available binding size in bytes. */
	size: number;
	/** Usage flags declared when the buffer was created. */
	usage: GPUBufferUsageFlags;
}

/**
 * Borrowed `GPUSampler` reference. Spektral never owns the supplied sampler.
 */
export interface ComputeExternalSamplerReference {
	/** Static sampler or provider returning the sampler for the current frame. */
	externalSampler: ComputeExternalProvider<GPUSampler>;
	/** Stable identity used by resource and bind-group caches. */
	resourceId: string | symbol;
	/** Binding type required by the sampler's descriptor. */
	type: GPUSamplerBindingType;
}

/** Material texture key or a borrowed WebGPU texture/view reference. */
export type ComputeTextureReference =
	| string
	| ComputeExternalTextureReference
	| ComputeExternalTextureViewReference;

/** Material storage-buffer key or a borrowed WebGPU buffer reference. */
export type ComputeBufferReference = string | ComputeExternalBufferReference;

/** Material texture key or a borrowed WebGPU sampler reference. */
export type ComputeSamplerReference = string | ComputeExternalSamplerReference;

/**
 * Read-only sampled texture exposed to one compute pass.
 */
export interface ComputeSampledTextureResource {
	texture: ComputeTextureReference;
	access: 'sampled';
	view?: ComputeTextureViewDescriptor;
	version?: ComputeResourceVersion;
	pingPong?: 'read';
}

/**
 * Write-only storage texture exposed to one compute pass.
 */
export interface ComputeStorageTextureResource {
	texture: ComputeTextureReference;
	access: 'storage-write';
	view?: ComputeTextureViewDescriptor;
	pingPong?: 'write';
}

/**
 * Read-only storage buffer exposed to one compute pass.
 */
export interface ComputeStorageBufferReadResource {
	buffer: ComputeBufferReference;
	access: 'storage-read';
	version?: ComputeResourceVersion;
}

/**
 * Read-write storage buffer exposed to one compute pass.
 */
export interface ComputeStorageBufferReadWriteResource {
	buffer: ComputeBufferReference;
	access: 'storage-read-write';
}

/**
 * Sampler exposed to one compute pass under an explicit WGSL alias.
 */
export interface ComputeSamplerResource {
	sampler: ComputeSamplerReference;
}

/**
 * Resource binding supported by compute pass descriptors.
 */
export type ComputeResourceDescriptor =
	| ComputeSampledTextureResource
	| ComputeStorageTextureResource
	| ComputeStorageBufferReadResource
	| ComputeStorageBufferReadWriteResource
	| ComputeSamplerResource;

/**
 * Immutable compute resource map keyed by WGSL binding aliases.
 */
export type ComputeResourceMap<TAlias extends string = string> = Readonly<
	Record<TAlias, ComputeResourceDescriptor>
>;

/**
 * Final output encoding applied before canvas presentation.
 */
export type OutputEncoding = 'srgb' | 'linear';

/**
 * Final tone mapper applied by the private presentation pass.
 */
export type ToneMapping =
	| 'none'
	| 'khronos-pbr-neutral'
	| 'uncharted2-filmic'
	| 'aces-hill'
	| 'gran-turismo';

/**
 * Requested display dynamic range for final canvas presentation.
 */
export type OutputDynamicRange = 'sdr' | 'hdr' | 'auto';

/**
 * Canvas color space requested during WebGPU context configuration.
 */
export type CanvasColorSpace = 'srgb' | 'display-p3';

/**
 * High-level color pipeline configuration for `FragCanvas`.
 */
export interface ColorPipelineOptions {
	/**
	 * Final output encoding. `srgb` applies linear-to-sRGB encoding; `linear` leaves values unchanged.
	 */
	outputEncoding?: OutputEncoding;
	/**
	 * Final tone mapper. Tone mapping converts HDR linear input to SDR output.
	 */
	toneMapping?: ToneMapping;
	/**
	 * Display dynamic range. `auto` attempts HDR canvas presentation and falls back to SDR.
	 */
	dynamicRange?: OutputDynamicRange;
	/**
	 * Canvas presentation color space.
	 */
	canvasColorSpace?: CanvasColorSpace;
	/**
	 * Internal scene/pass render target format. `auto` selects `rgba16float` for HDR/tone mapping.
	 */
	workingFormat?: 'auto' | GPUTextureFormat;
}

/**
 * Declarative render target definition for post-processing or multi-pass pipelines.
 */
export interface RenderTargetDefinition {
	/**
	 * Explicit target width. If omitted, derived from `scale * canvasWidth`.
	 */
	width?: number;
	/**
	 * Explicit target height. If omitted, derived from `scale * canvasHeight`.
	 */
	height?: number;
	/**
	 * Canvas-relative scale for implicit dimensions.
	 */
	scale?: number;
	/**
	 * Texture format override.
	 */
	format?: GPUTextureFormat;
}

/**
 * Runtime render target handle exposed to render passes.
 */
export interface RenderTarget {
	/**
	 * Backing GPU texture.
	 */
	texture: GPUTexture;
	/**
	 * Default texture view.
	 */
	view: GPUTextureView;
	/**
	 * Width in pixels.
	 */
	width: number;
	/**
	 * Height in pixels.
	 */
	height: number;
	/**
	 * GPU texture format.
	 */
	format: GPUTextureFormat;
}

/**
 * Named render target definitions keyed by output slot names.
 */
export type RenderTargetDefinitionMap<TKey extends string = string> = Record<
	TKey,
	RenderTargetDefinition
>;

/**
 * User-defined render slot name (mapped to `renderTargets` keys).
 */
export type RenderPassNamedSlot = string & {};

/**
 * Built-in render graph source slots.
 */
export type RenderPassInputSlot = 'source' | 'target' | RenderPassNamedSlot;

/**
 * Built-in render graph output slots.
 */
export type RenderPassOutputSlot = 'source' | 'target' | 'canvas' | RenderPassNamedSlot;

/**
 * Per-pass render flags controlling attachment behavior.
 */
export interface RenderPassFlags {
	/**
	 * Clears output attachment before drawing.
	 */
	clear?: boolean;
	/**
	 * Clear color used when {@link clear} is enabled.
	 */
	clearColor?: [number, number, number, number];
	/**
	 * Stores output attachment contents after rendering.
	 */
	preserve?: boolean;
}

/**
 * Execution context passed to formal render passes.
 */
export interface RenderPassContext extends Required<RenderPassFlags> {
	/**
	 * Active GPU device.
	 */
	device: GPUDevice;
	/**
	 * Shared command encoder for this frame.
	 */
	commandEncoder: GPUCommandEncoder;
	/**
	 * Current source slot surface.
	 */
	source: RenderTarget;
	/**
	 * Current ping-pong target slot surface.
	 */
	target: RenderTarget;
	/**
	 * Current frame canvas surface.
	 */
	canvas: RenderTarget;
	/**
	 * Resolved pass input surface.
	 */
	input: RenderTarget;
	/**
	 * Resolved pass output surface.
	 */
	output: RenderTarget;
	/**
	 * Runtime render targets snapshot.
	 */
	targets: Readonly<Record<string, RenderTarget>>;
	/**
	 * Frame timestamp in seconds.
	 */
	time: number;
	/**
	 * Frame delta in seconds.
	 */
	delta: number;
	/**
	 * Frame width in pixels.
	 */
	width: number;
	/**
	 * Frame height in pixels.
	 */
	height: number;
	/**
	 * Begins a color render pass targeting current output (or provided view).
	 */
	beginRenderPass: (options?: {
		view?: GPUTextureView;
		clear?: boolean;
		clearColor?: [number, number, number, number];
		preserve?: boolean;
	}) => GPURenderPassEncoder;
}

/**
 * Reserved low-level context shape for compute integrations.
 *
 * @deprecated Compute passes are renderer-managed pre-scene workloads. Use
 * `ComputePass`, `PingPongComputePass`, and `ComputeDispatchContext`; custom
 * compute `render(context)` callbacks are not part of the public runtime contract.
 */
export interface ComputePassContext {
	/**
	 * Active GPU device.
	 */
	device: GPUDevice;
	/**
	 * Shared command encoder for this frame.
	 */
	commandEncoder: GPUCommandEncoder;
	/**
	 * Frame width in pixels.
	 */
	width: number;
	/**
	 * Frame height in pixels.
	 */
	height: number;
	/**
	 * Frame timestamp in seconds.
	 */
	time: number;
	/**
	 * Frame delta in seconds.
	 */
	delta: number;
	/**
	 * Begins a compute pass on the shared command encoder.
	 */
	beginComputePass: () => GPUComputePassEncoder;
}

/**
 * Formal render pass contract used by Spektral render graph.
 */
export interface RenderPass extends RenderPassFlags {
	/** Reserved for renderer-managed compute passes. */
	readonly isCompute?: never;
	/** Reserved for renderer-managed feedback passes. */
	readonly isPingPongShader?: never;
	/** Optional human-readable label exposed by render-graph diagnostics. */
	readonly label?: string;
	/**
	 * Enables/disables this pass without removing it from graph.
	 */
	enabled?: boolean;
	/**
	 * Triggers source/target ping-pong swap after render.
	 */
	needsSwap?: boolean;
	/**
	 * Input slot used by this pass.
	 */
	input?: RenderPassInputSlot;
	/**
	 * Output slot written by this pass.
	 */
	output?: RenderPassOutputSlot;
	/**
	 * Called on resize events (canvas size * DPR changes).
	 */
	setSize?: (width: number, height: number) => void;
	/**
	 * Executes pass commands for current frame.
	 */
	render: (context: RenderPassContext) => void;
	/**
	 * Releases pass-owned resources.
	 */
	dispose?: () => void;
}

/**
 * Nominal contract implemented only by renderer-managed pre-scene compute passes.
 * Custom compute passes are not part of the public runtime contract.
 */
export interface ComputePassLike {
	readonly [managedPassBrand]: 'compute';
	readonly isCompute: true;
	readonly isPingPong?: true;
	readonly label?: string;
	enabled: boolean;
	setSize?: (width: number, height: number) => void;
	dispose: () => void;
	getCompute: () => string;
	getResources: () => ComputeResourceMap;
	getWorkgroupSize: () => [number, number, number];
	resolveDispatch: (context: {
		width: number;
		height: number;
		time: number;
		delta: number;
		workgroupSize: [number, number, number];
	}) => [number, number, number];
	getIterations?: () => number;
}

/**
 * Nominal contract for renderer-managed pre-scene fragment feedback passes.
 * These passes render into private ping-pong textures and do not participate in
 * post-scene render-pass slot routing.
 */
export interface PingPongShaderPassLike {
	readonly [managedPassBrand]: 'feedback';
	readonly isPingPongShader: true;
	readonly label?: string;
	enabled: boolean;
	setSize?: (width: number, height: number) => void;
	dispose: () => void;
	getTarget: () => string;
	getFragment: () => string;
	getFragmentLineMap: () => MaterialLineMap;
	resolveSize: (canvasSize: { width: number; height: number }) => {
		width: number;
		height: number;
	};
	getIterations: () => number;
	getFormat: () => GPUTextureFormat;
	getFilter: () => GPUFilterMode;
	getAddressModeU: () => GPUAddressMode;
	getAddressModeV: () => GPUAddressMode;
	getClearColor: () => [number, number, number, number];
	getCurrentOutput: () => string;
	advanceFrame: () => void;
	consumeResetColor: () => [number, number, number, number] | null;
}

/**
 * Union type for all pass types accepted by the render graph.
 */
export type AnyPass = RenderPass | ComputePassLike | PingPongShaderPassLike;

/**
 * Frame submission strategy for the scheduler.
 */
export type RenderMode = 'always' | 'on-demand' | 'manual';

/**
 * Token identifying an invalidation source.
 */
export type FrameInvalidationToken = string | number | symbol;

/**
 * Mutable per-frame state passed to frame callbacks.
 */
export interface FrameState {
	/**
	 * Elapsed time in seconds.
	 */
	time: number;
	/**
	 * Delta time in seconds.
	 */
	delta: number;
	/**
	 * Sets a uniform value for current/next frame.
	 */
	setUniform: (name: string, value: UniformValue) => void;
	/**
	 * Sets a texture value for current/next frame.
	 */
	setTexture: (name: string, value: TextureValue) => void;
	/**
	 * Queues an owned byte copy for a named storage buffer.
	 */
	writeStorageBuffer: (name: string, data: ArrayBufferView, options?: { offset?: number }) => void;
	/**
	 * Flushes queued writes for the named buffer, then reads its data back asynchronously.
	 */
	readStorageBuffer: (name: string) => Promise<ArrayBuffer>;
	/**
	 * Invalidates frame for on-demand rendering.
	 */
	invalidate: (token?: FrameInvalidationToken) => void;
	/**
	 * Requests a single render in manual mode.
	 */
	advance: () => void;
	/**
	 * Current render mode.
	 */
	renderMode: RenderMode;
	/**
	 * Whether automatic rendering is enabled.
	 */
	autoRender: boolean;
	/**
	 * Active canvas element.
	 */
	canvas: HTMLCanvasElement;
}

/**
 * Internal renderer construction options resolved from material/context state.
 */
/**
 * Pending storage buffer write queued from FrameState.
 */
export interface PendingStorageWrite {
	/** Storage buffer name. */
	name: string;
	/** Owned byte copy to write. */
	data: ArrayBufferView;
	/** Byte offset into the storage buffer. */
	offset: number;
}

/** Minimal renderer-facing graph publication sink. @internal */
export interface RendererGraphUpdater {
	setSnapshot(snapshot: object): void;
	reset(): void;
}

export interface RendererOptions {
	/**
	 * Target canvas.
	 */
	canvas: HTMLCanvasElement;
	/**
	 * Resolved fragment WGSL.
	 */
	fragmentWgsl: string;
	/**
	 * 1-based source map for preprocessed fragment lines.
	 */
	fragmentLineMap: MaterialLineMap;
	/**
	 * Original material fragment source before preprocessing.
	 */
	fragmentSource: string;
	/**
	 * Include sources used while preprocessing material fragment.
	 */
	includeSources: Readonly<Record<string, string>>;
	/**
	 * Deterministic define block source used for diagnostics mapping.
	 */
	defineBlockSource?: string;
	/**
	 * Optional material callsite/source metadata for diagnostics.
	 */
	materialSource?: {
		component?: string;
		file?: string;
		line?: number;
		column?: number;
		functionName?: string;
	} | null;
	/**
	 * Stable material signature captured during resolution.
	 */
	materialSignature?: string;
	/**
	 * Resolved uniform layout.
	 */
	uniformLayout: UniformLayout;
	/**
	 * Sorted texture keys.
	 */
	textureKeys: readonly string[];
	/**
	 * Texture definitions by key.
	 */
	textureDefinitions: Readonly<TextureDefinitionMap>;
	/**
	 * Sorted storage buffer keys.
	 */
	storageBufferKeys?: readonly string[];
	/**
	 * Storage buffer definitions by key.
	 */
	storageBufferDefinitions?: Readonly<Record<string, StorageBufferDefinition>>;
	/**
	 * Sorted storage texture keys (textures with storage:true).
	 */
	storageTextureKeys?: readonly string[];
	/**
	 * Static render target definitions.
	 */
	renderTargets?: RenderTargetDefinitionMap;
	/**
	 * Static render, compute, and fragment-feedback passes.
	 */
	passes?: AnyPass[];
	/**
	 * Dynamic render targets provider.
	 */
	getRenderTargets?: () => RenderTargetDefinitionMap | undefined;
	/**
	 * Dynamic render, compute, and fragment-feedback passes provider.
	 */
	getPasses?: () => AnyPass[] | undefined;
	/**
	 * Color pipeline and HDR presentation options.
	 */
	color?: ColorPipelineOptions;
	/**
	 * Function returning current clear color.
	 */
	getClearColor: () => [number, number, number, number];
	/**
	 * Function returning current DPR multiplier.
	 */
	getDpr: () => number;
	/**
	 * Optional adapter request options.
	 */
	adapterOptions?: GPURequestAdapterOptions | undefined;
	/**
	 * Optional device descriptor.
	 */
	deviceDescriptor?: GPUDeviceDescriptor | undefined;
	/**
	 * Optional callback the renderer invokes when asynchronous pipeline work
	 * changes what the next frame can render. This includes compute validation,
	 * dynamically prepared fullscreen passes, and successful ShaderPass recovery.
	 * Hosts should treat it as a hint to schedule another render pass.
	 */
	requestRender?: (() => void) | undefined;
	/**
	 * Internal runtime channel for recoverable errors discovered after renderer initialization.
	 *
	 * @internal
	 */
	reportAsyncError?: ((error: Error) => void) | undefined;
	/** Renderer-facing graph snapshot bridge. @internal */
	graphUpdater?: RendererGraphUpdater | undefined;
	/**
	 * Internal test hook invoked when an initialization cleanup is registered.
	 *
	 * @internal
	 */
	__onInitializationCleanupRegistered?: (() => void) | undefined;
}

/**
 * Low-level renderer lifecycle contract used by `FragCanvas`.
 */
export interface Renderer {
	/**
	 * Renders one frame.
	 */
	render: (input: {
		time: number;
		delta: number;
		renderMode: RenderMode;
		uniforms: UniformMap;
		textures: TextureMap;
		canvasSize?: {
			width: number;
			height: number;
		};
		pendingStorageWrites?: PendingStorageWrite[] | undefined;
	}) => void;
	/**
	 * Applies queued storage buffer writes without issuing a draw call.
	 */
	flushStorageWrites: (writes: PendingStorageWrite[]) => void;
	/**
	 * Returns the GPU buffer for a named storage buffer, if allocated.
	 */
	getStorageBuffer?: (name: string) => GPUBuffer | undefined;
	/**
	 * Returns the active GPU device (for readback operations).
	 */
	getDevice?: () => GPUDevice;
	/**
	 * Releases GPU resources and subscriptions.
	 */
	destroy: () => void;
}
