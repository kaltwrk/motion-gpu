import type {
	ComputeBufferReference,
	ComputeExternalResourceContext,
	ComputeExternalTextureReference,
	ComputeResourceDescriptor,
	ComputeResourceMap,
	ComputeResourceVersion,
	ComputeSamplerReference,
	ComputeTextureReference,
	ComputeTextureViewDescriptor,
	StorageBufferType
} from './types.js';
import { assertUniformName } from './uniforms.js';
import {
	attachSpektralErrorContext,
	createSpektralError,
	type SpektralErrorCode,
	type SpektralErrorContext
} from './error-report.js';
import type { RuntimeStorageBufferResource, RuntimeTextureResource } from './resource-registry.js';
import {
	resolveTextureFormatCapabilities,
	textureSampleScalarType
} from './format-capabilities.js';

const RESERVED_COMPUTE_RESOURCE_ALIASES = new Set(['spektralFrame', 'spektralUniforms']);

const TEXTURE_DESCRIPTOR_KEYS = new Set(['texture', 'access', 'view', 'version', 'pingPong']);
const BUFFER_DESCRIPTOR_KEYS = new Set(['buffer', 'access', 'version']);
const SAMPLER_DESCRIPTOR_KEYS = new Set(['sampler']);
const EXTERNAL_TEXTURE_KEYS = new Set([
	'externalTexture',
	'resourceId',
	'format',
	'usage',
	'viewDimension'
]);
const EXTERNAL_TEXTURE_VIEW_KEYS = new Set([
	'externalView',
	'resourceId',
	'format',
	'usage',
	'viewDimension',
	'mipLevelCount'
]);
const EXTERNAL_BUFFER_KEYS = new Set(['externalBuffer', 'resourceId', 'wgslType', 'size', 'usage']);
const EXTERNAL_SAMPLER_KEYS = new Set(['externalSampler', 'resourceId', 'type']);
const TEXTURE_VIEW_KEYS = new Set([
	'baseMipLevel',
	'mipLevelCount',
	'baseArrayLayer',
	'arrayLayerCount'
]);

interface ComputeResourceIdentity {
	kind: 'material' | 'external';
	value: string | symbol;
}

export interface ComputePingPongResourcePair {
	readAlias: string;
	writeAlias: string;
	texture: ComputeTextureReference;
}

export interface ResolvedTextureSubresourceRange {
	baseMipLevel: number;
	mipLevelCount: number;
	baseArrayLayer: number;
	arrayLayerCount: 1;
}

export type ResolvedComputeResourceSource = 'material' | 'external';

interface ResolvedComputeResourceBase {
	alias: string;
	binding: number;
	logicalId: string | symbol;
	physicalId: object | string | symbol;
	source: ResolvedComputeResourceSource;
	layoutEntry: GPUBindGroupLayoutEntry;
	bindingResource: GPUBindingResource;
	topologyPart: string;
}

export interface ResolvedSampledTextureResource extends ResolvedComputeResourceBase {
	kind: 'sampled-texture';
	access: 'sampled';
	format: GPUTextureFormat;
	scalarType: 'f32' | 'u32' | 'i32';
	sampleType: GPUTextureSampleType;
	version: ComputeResourceVersion;
	pingPong: 'read' | undefined;
	subresource: ResolvedTextureSubresourceRange;
	bindingResource: GPUTextureView;
}

export interface ResolvedStorageTextureResource extends ResolvedComputeResourceBase {
	kind: 'storage-texture';
	access: 'storage-write';
	format: GPUTextureFormat;
	pingPong: 'write' | undefined;
	subresource: ResolvedTextureSubresourceRange;
	bindingResource: GPUTextureView;
}

export interface ResolvedStorageBufferResource extends ResolvedComputeResourceBase {
	kind: 'storage-buffer';
	access: 'storage-read' | 'storage-read-write';
	wgslType: StorageBufferType;
	size: number;
	version: ComputeResourceVersion | undefined;
	bindingResource: GPUBufferBinding;
}

export interface ResolvedSamplerResource extends ResolvedComputeResourceBase {
	kind: 'sampler';
	samplerType: GPUSamplerBindingType;
	bindingResource: GPUSampler;
}

export type ResolvedComputeResource =
	| ResolvedSampledTextureResource
	| ResolvedStorageTextureResource
	| ResolvedStorageBufferResource
	| ResolvedSamplerResource;

export interface ResolvedComputeAccess {
	alias: string;
	resourceKind: 'texture' | 'buffer';
	logicalId: string | symbol;
	physicalId: object | string | symbol;
	/** Distinguishes same-named material and borrowed external resources. */
	source?: ResolvedComputeResourceSource;
	mode: 'read' | 'write';
	version: ComputeResourceVersion;
	subresource?: ResolvedTextureSubresourceRange;
}

export interface ResolvedComputePassResources {
	entries: readonly ResolvedComputeResource[];
	reads: readonly ResolvedComputeAccess[];
	writes: readonly ResolvedComputeAccess[];
	topologyKey: string;
	bindingCount: number;
}

export interface ComputeMaterialSamplerResource {
	logicalId: string;
	sampler: GPUSampler;
	type: GPUSamplerBindingType;
	sampleType: GPUTextureSampleType;
}

export interface ComputeResourceResolverLimits {
	maxBindingsPerBindGroup: number;
	maxSampledTexturesPerShaderStage: number;
	maxSamplersPerShaderStage: number;
	maxStorageTexturesPerShaderStage: number;
	maxStorageBuffersPerShaderStage: number;
	maxStorageBufferBindingSize: number;
}

export interface ComputeResourceResolverContext {
	passLabel: string;
	deviceFeatures: ReadonlySet<string>;
	limits: ComputeResourceResolverLimits;
	externalContext: ComputeExternalResourceContext;
	getMaterialTexture: (logicalId: string) => RuntimeTextureResource | undefined;
	getMaterialStorageBuffer: (logicalId: string) => RuntimeStorageBufferResource | undefined;
	getMaterialSampler: (logicalId: string) => ComputeMaterialSamplerResource | undefined;
	createTextureView?: (texture: GPUTexture, descriptor: GPUTextureViewDescriptor) => GPUTextureView;
	pingPong?: boolean;
	externalState?: ComputeExternalResolutionState;
	diagnosticContext?: SpektralErrorContext;
}

export interface ResolvedComputeTextureFormat {
	scalarType: 'f32' | 'u32' | 'i32';
	sampleType: GPUTextureSampleType;
}

const normalizedComputeResourceMaps = new WeakSet<object>();

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoUnknownKeys(
	label: string,
	value: Record<string, unknown>,
	allowedKeys: ReadonlySet<string>
): void {
	const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
	if (unknownKey !== undefined) {
		throw new Error(`${label} contains unsupported field "${unknownKey}".`);
	}
}

function assertResourceId(label: string, value: unknown): asserts value is string | symbol {
	if ((typeof value !== 'string' || value.length === 0) && typeof value !== 'symbol') {
		throw new Error(`${label} resourceId must be a non-empty string or symbol.`);
	}
}

function assertExternalProvider(label: string, value: unknown): void {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new Error(`${label} must provide a WebGPU object or provider function.`);
	}
}

function assertUsage(label: string, value: unknown): void {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} usage must be a non-negative integer bitmask.`);
	}
}

function assertPositiveInteger(label: string, value: unknown): asserts value is number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer.`);
	}
}

function assertTextureViewDescriptor(
	alias: string,
	view: unknown
): asserts view is ComputeTextureViewDescriptor {
	if (!isObjectRecord(view)) {
		throw new Error(`Compute resource "${alias}" view must be an object.`);
	}

	assertNoUnknownKeys(`Compute resource "${alias}" view`, view, TEXTURE_VIEW_KEYS);
	for (const key of ['baseMipLevel', 'baseArrayLayer'] as const) {
		const value = view[key];
		if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0)) {
			throw new Error(`Compute resource "${alias}" view.${key} must be a non-negative integer.`);
		}
	}
	if (view.mipLevelCount !== undefined) {
		assertPositiveInteger(`Compute resource "${alias}" view.mipLevelCount`, view.mipLevelCount);
	}
	if (view.arrayLayerCount !== undefined && view.arrayLayerCount !== 1) {
		throw new Error(`Compute resource "${alias}" view.arrayLayerCount must be 1.`);
	}
}

function assertExternalTextureReference(alias: string, reference: Record<string, unknown>): void {
	assertNoUnknownKeys(
		`Compute resource "${alias}" external texture`,
		reference,
		EXTERNAL_TEXTURE_KEYS
	);
	assertExternalProvider(`Compute resource "${alias}" externalTexture`, reference.externalTexture);
	assertResourceId(`Compute resource "${alias}"`, reference.resourceId);
	if (typeof reference.format !== 'string' || reference.format.length === 0) {
		throw new Error(`Compute resource "${alias}" format must be a non-empty string.`);
	}
	assertUsage(`Compute resource "${alias}"`, reference.usage);
	if (reference.viewDimension !== undefined && reference.viewDimension !== '2d') {
		throw new Error(`Compute resource "${alias}" viewDimension must be "2d".`);
	}
}

function assertExternalTextureViewReference(
	alias: string,
	reference: Record<string, unknown>
): void {
	assertNoUnknownKeys(
		`Compute resource "${alias}" external texture view`,
		reference,
		EXTERNAL_TEXTURE_VIEW_KEYS
	);
	assertExternalProvider(`Compute resource "${alias}" externalView`, reference.externalView);
	assertResourceId(`Compute resource "${alias}"`, reference.resourceId);
	if (typeof reference.format !== 'string' || reference.format.length === 0) {
		throw new Error(`Compute resource "${alias}" format must be a non-empty string.`);
	}
	assertUsage(`Compute resource "${alias}"`, reference.usage);
	if (reference.viewDimension !== '2d') {
		throw new Error(`Compute resource "${alias}" viewDimension must be "2d".`);
	}
	assertPositiveInteger(`Compute resource "${alias}" mipLevelCount`, reference.mipLevelCount);
}

function assertTextureReference(
	alias: string,
	reference: unknown
): asserts reference is ComputeTextureReference {
	if (typeof reference === 'string') {
		if (reference.length === 0) {
			throw new Error(`Compute resource "${alias}" texture key must not be empty.`);
		}
		return;
	}
	if (!isObjectRecord(reference)) {
		throw new Error(
			`Compute resource "${alias}" texture must be a material key or external reference.`
		);
	}

	const hasTexture = 'externalTexture' in reference;
	const hasView = 'externalView' in reference;
	if (hasTexture === hasView) {
		throw new Error(
			`Compute resource "${alias}" texture reference must provide exactly one of externalTexture or externalView.`
		);
	}
	if (hasTexture) {
		assertExternalTextureReference(alias, reference);
		return;
	}
	assertExternalTextureViewReference(alias, reference);
}

function assertBufferReference(
	alias: string,
	reference: unknown
): asserts reference is ComputeBufferReference {
	if (typeof reference === 'string') {
		if (reference.length === 0) {
			throw new Error(`Compute resource "${alias}" buffer key must not be empty.`);
		}
		return;
	}
	if (!isObjectRecord(reference)) {
		throw new Error(
			`Compute resource "${alias}" buffer must be a material key or external reference.`
		);
	}

	assertNoUnknownKeys(
		`Compute resource "${alias}" external buffer`,
		reference,
		EXTERNAL_BUFFER_KEYS
	);
	assertExternalProvider(`Compute resource "${alias}" externalBuffer`, reference.externalBuffer);
	assertResourceId(`Compute resource "${alias}"`, reference.resourceId);
	if (typeof reference.wgslType !== 'string' || reference.wgslType.length === 0) {
		throw new Error(`Compute resource "${alias}" wgslType must be a non-empty string.`);
	}
	assertPositiveInteger(`Compute resource "${alias}" size`, reference.size);
	assertUsage(`Compute resource "${alias}"`, reference.usage);
}

function assertSamplerReference(
	alias: string,
	reference: unknown
): asserts reference is ComputeSamplerReference {
	if (typeof reference === 'string') {
		if (reference.length === 0) {
			throw new Error(`Compute resource "${alias}" sampler key must not be empty.`);
		}
		return;
	}
	if (!isObjectRecord(reference)) {
		throw new Error(
			`Compute resource "${alias}" sampler must be a material key or external reference.`
		);
	}

	assertNoUnknownKeys(
		`Compute resource "${alias}" external sampler`,
		reference,
		EXTERNAL_SAMPLER_KEYS
	);
	assertExternalProvider(`Compute resource "${alias}" externalSampler`, reference.externalSampler);
	assertResourceId(`Compute resource "${alias}"`, reference.resourceId);
	if (
		reference.type !== 'filtering' &&
		reference.type !== 'non-filtering' &&
		reference.type !== 'comparison'
	) {
		throw new Error(`Compute resource "${alias}" sampler type is invalid.`);
	}
}

function assertComputeResourceDescriptor(
	alias: string,
	descriptor: unknown
): asserts descriptor is ComputeResourceDescriptor {
	if (!isObjectRecord(descriptor)) {
		throw new Error(`Compute resource "${alias}" descriptor must be an object.`);
	}

	const discriminants = ['texture', 'buffer', 'sampler'].filter((key) => key in descriptor);
	if (discriminants.length !== 1) {
		throw new Error(
			`Compute resource "${alias}" must provide exactly one of texture, buffer, or sampler.`
		);
	}

	if ('texture' in descriptor) {
		assertNoUnknownKeys(`Compute resource "${alias}"`, descriptor, TEXTURE_DESCRIPTOR_KEYS);
		assertTextureReference(alias, descriptor.texture);
		if (descriptor.access !== 'sampled' && descriptor.access !== 'storage-write') {
			throw new Error(
				`Compute resource "${alias}" texture access must be "sampled" or "storage-write".`
			);
		}
		if (descriptor.view !== undefined) {
			assertTextureViewDescriptor(alias, descriptor.view);
		}
		if (descriptor.access === 'sampled') {
			if (
				descriptor.version !== undefined &&
				descriptor.version !== 'current' &&
				descriptor.version !== 'initial'
			) {
				throw new Error(`Compute resource "${alias}" version must be "current" or "initial".`);
			}
			if (descriptor.pingPong !== undefined && descriptor.pingPong !== 'read') {
				throw new Error(`Compute resource "${alias}" sampled pingPong role must be "read".`);
			}
			return;
		}
		if ('version' in descriptor) {
			throw new Error(`Compute resource "${alias}" storage-write descriptor cannot set version.`);
		}
		if (descriptor.pingPong !== undefined && descriptor.pingPong !== 'write') {
			throw new Error(`Compute resource "${alias}" storage-write pingPong role must be "write".`);
		}
		return;
	}

	if ('buffer' in descriptor) {
		assertNoUnknownKeys(`Compute resource "${alias}"`, descriptor, BUFFER_DESCRIPTOR_KEYS);
		assertBufferReference(alias, descriptor.buffer);
		if (descriptor.access !== 'storage-read' && descriptor.access !== 'storage-read-write') {
			throw new Error(
				`Compute resource "${alias}" buffer access must be "storage-read" or "storage-read-write".`
			);
		}
		if (descriptor.access === 'storage-read') {
			if (
				descriptor.version !== undefined &&
				descriptor.version !== 'current' &&
				descriptor.version !== 'initial'
			) {
				throw new Error(`Compute resource "${alias}" version must be "current" or "initial".`);
			}
			return;
		}
		if ('version' in descriptor) {
			throw new Error(
				`Compute resource "${alias}" storage-read-write descriptor cannot set version.`
			);
		}
		return;
	}

	assertNoUnknownKeys(`Compute resource "${alias}"`, descriptor, SAMPLER_DESCRIPTOR_KEYS);
	assertSamplerReference(alias, descriptor.sampler);
}

function cloneTextureReference(reference: ComputeTextureReference): ComputeTextureReference {
	return typeof reference === 'string' ? reference : { ...reference };
}

function cloneBufferReference(reference: ComputeBufferReference): ComputeBufferReference {
	return typeof reference === 'string' ? reference : { ...reference };
}

function cloneSamplerReference(reference: ComputeSamplerReference): ComputeSamplerReference {
	return typeof reference === 'string' ? reference : { ...reference };
}

function cloneComputeResourceDescriptor(
	descriptor: ComputeResourceDescriptor
): ComputeResourceDescriptor {
	if ('texture' in descriptor) {
		return {
			...descriptor,
			texture: cloneTextureReference(descriptor.texture),
			...(descriptor.view !== undefined ? { view: { ...descriptor.view } } : {})
		};
	}
	if ('buffer' in descriptor) {
		return { ...descriptor, buffer: cloneBufferReference(descriptor.buffer) };
	}
	return { ...descriptor, sampler: cloneSamplerReference(descriptor.sampler) };
}

function freezeComputeResourceDescriptor(
	descriptor: ComputeResourceDescriptor
): ComputeResourceDescriptor {
	if ('texture' in descriptor) {
		if (typeof descriptor.texture !== 'string') {
			Object.freeze(descriptor.texture);
		}
		if (descriptor.view !== undefined) {
			Object.freeze(descriptor.view);
		}
	} else if ('buffer' in descriptor) {
		if (typeof descriptor.buffer !== 'string') {
			Object.freeze(descriptor.buffer);
		}
	} else if (typeof descriptor.sampler !== 'string') {
		Object.freeze(descriptor.sampler);
	}
	return Object.freeze(descriptor);
}

/**
 * Validates, clones and freezes a deterministic compute resource topology.
 */
export function normalizeComputeResourceMap(
	resources: ComputeResourceMap | undefined
): ComputeResourceMap {
	if (resources === undefined) {
		const normalized = Object.freeze({});
		normalizedComputeResourceMaps.add(normalized);
		return normalized;
	}
	if (!isObjectRecord(resources)) {
		throw createSpektralError(
			'COMPUTE_RESOURCE_DESCRIPTOR_INVALID',
			'Compute resources must be an object map keyed by WGSL aliases.'
		);
	}
	if (normalizedComputeResourceMaps.has(resources)) {
		return resources;
	}

	const normalized: Record<string, ComputeResourceDescriptor> = Object.create(null) as Record<
		string,
		ComputeResourceDescriptor
	>;
	for (const alias of Object.keys(resources).sort()) {
		try {
			assertUniformName(alias);
		} catch (error) {
			throw createSpektralError(
				'COMPUTE_RESOURCE_ALIAS_COLLISION',
				error instanceof Error ? error.message : `Invalid compute resource alias "${alias}".`,
				{ cause: error }
			);
		}
		if (RESERVED_COMPUTE_RESOURCE_ALIASES.has(alias)) {
			throw createSpektralError(
				'COMPUTE_RESOURCE_ALIAS_COLLISION',
				`Compute resource alias "${alias}" is reserved by Spektral.`
			);
		}
		const descriptor = resources[alias];
		try {
			assertComputeResourceDescriptor(alias, descriptor);
		} catch (error) {
			throw createSpektralError(
				'COMPUTE_RESOURCE_DESCRIPTOR_INVALID',
				error instanceof Error
					? error.message
					: `Compute resource "${alias}" descriptor is invalid.`,
				{ cause: error }
			);
		}
		normalized[alias] = freezeComputeResourceDescriptor(cloneComputeResourceDescriptor(descriptor));
	}
	const frozen = Object.freeze(normalized);
	normalizedComputeResourceMaps.add(frozen);
	return frozen;
}

/**
 * Returns a deep-enough defensive copy while preserving external GPU handles/providers.
 */
export function copyComputeResourceMap(resources: ComputeResourceMap): ComputeResourceMap {
	const copy: Record<string, ComputeResourceDescriptor> = Object.create(null) as Record<
		string,
		ComputeResourceDescriptor
	>;
	for (const alias of Object.keys(resources)) {
		const descriptor = resources[alias];
		if (descriptor !== undefined) {
			copy[alias] = cloneComputeResourceDescriptor(descriptor);
		}
	}
	return copy;
}

function textureResourceIdentity(reference: ComputeTextureReference): ComputeResourceIdentity {
	return typeof reference === 'string'
		? { kind: 'material', value: reference }
		: { kind: 'external', value: reference.resourceId };
}

function sameResourceIdentity(a: ComputeResourceIdentity, b: ComputeResourceIdentity): boolean {
	return a.kind === b.kind && Object.is(a.value, b.value);
}

/**
 * Validates and resolves the single read/write pair required by ping-pong compute.
 */
export function resolveComputePingPongResourcePair(
	resources: ComputeResourceMap
): ComputePingPongResourcePair {
	const reads: Array<[string, Extract<ComputeResourceDescriptor, { texture: unknown }>]> = [];
	const writes: Array<[string, Extract<ComputeResourceDescriptor, { texture: unknown }>]> = [];
	for (const [alias, descriptor] of Object.entries(resources)) {
		if (!('texture' in descriptor)) {
			continue;
		}
		if (descriptor.pingPong === 'read') {
			reads.push([alias, descriptor]);
		} else if (descriptor.pingPong === 'write') {
			writes.push([alias, descriptor]);
		}
	}

	if (reads.length !== 1 || writes.length !== 1) {
		throw new Error(
			'PingPongComputePass resources must contain exactly one pingPong read texture and one pingPong write texture.'
		);
	}

	const read = reads[0];
	const write = writes[0];
	if (read === undefined || write === undefined) {
		throw new Error('PingPongComputePass resource pair resolution failed.');
	}
	const [readAlias, readDescriptor] = read;
	const [writeAlias, writeDescriptor] = write;
	if (readDescriptor.access !== 'sampled' || writeDescriptor.access !== 'storage-write') {
		throw new Error(
			'PingPongComputePass read resource must be sampled and write resource must be storage-write.'
		);
	}
	if (
		!sameResourceIdentity(
			textureResourceIdentity(readDescriptor.texture),
			textureResourceIdentity(writeDescriptor.texture)
		)
	) {
		throw new Error(
			'PingPongComputePass read and write resources must reference the same texture.'
		);
	}

	return { readAlias, writeAlias, texture: readDescriptor.texture };
}

function computeShaderVisibility(): GPUShaderStageFlags {
	return typeof GPUShaderStage === 'object' ? GPUShaderStage.COMPUTE : (4 as GPUShaderStageFlags);
}

function textureBindingUsage(): GPUTextureUsageFlags {
	return typeof GPUTextureUsage === 'object' ? GPUTextureUsage.TEXTURE_BINDING : 4;
}

function storageTextureBindingUsage(): GPUTextureUsageFlags {
	return typeof GPUTextureUsage === 'object' ? GPUTextureUsage.STORAGE_BINDING : 8;
}

function storageBufferBindingUsage(): GPUBufferUsageFlags {
	return typeof GPUBufferUsage === 'object' ? GPUBufferUsage.STORAGE : 128;
}

interface ResolvedTextureReference {
	logicalId: string | symbol;
	physicalId: object | string | symbol;
	source: ResolvedComputeResourceSource;
	format: GPUTextureFormat;
	usage: GPUTextureUsageFlags;
	mipLevelCount: number;
	baseView: GPUTextureView;
	texture: GPUTexture | null;
	isExternalView: boolean;
}

interface ResolvedBufferReference {
	logicalId: string | symbol;
	physicalId: object | string | symbol;
	source: ResolvedComputeResourceSource;
	buffer: GPUBuffer;
	size: number;
	wgslType: StorageBufferType;
	usage: GPUBufferUsageFlags;
	materialAccess: 'read' | 'read-write' | undefined;
}

interface ResolvedSamplerReference {
	logicalId: string | symbol;
	physicalId: object | string | symbol;
	source: ResolvedComputeResourceSource;
	sampler: GPUSampler;
	type: GPUSamplerBindingType;
	materialSampleType: GPUTextureSampleType | undefined;
}

export interface ComputeExternalResolutionState {
	providerResults: Map<object, object>;
	resourceIdByObject: Map<object, string | symbol>;
	metadataByResourceId: Map<string | symbol, string>;
	textureByResourceId: Map<string | symbol, object>;
	bufferByResourceId: Map<string | symbol, object>;
	samplerByResourceId: Map<string | symbol, object>;
}

export function createComputeExternalResolutionState(): ComputeExternalResolutionState {
	return {
		providerResults: new Map(),
		resourceIdByObject: new Map(),
		metadataByResourceId: new Map(),
		textureByResourceId: new Map(),
		bufferByResourceId: new Map(),
		samplerByResourceId: new Map()
	};
}

function resourceError(
	context: ComputeResourceResolverContext,
	alias: string,
	message: string,
	code: SpektralErrorCode = 'COMPUTE_RESOURCE_INCOMPATIBLE'
): Error {
	const error = createSpektralError(code, `${context.passLabel} resource "${alias}" ${message}`);
	return context.diagnosticContext
		? attachSpektralErrorContext(error, context.diagnosticContext)
		: error;
}

function externalResourceError(
	context: ComputeResourceResolverContext,
	alias: string,
	message: string
): Error {
	return resourceError(context, alias, message, 'COMPUTE_EXTERNAL_RESOURCE_INVALID');
}

function hasUsage(usage: number, required: number): boolean {
	return (usage & required) === required;
}

function identityLabel(identity: string | symbol): string {
	return typeof identity === 'symbol' ? (identity.description ?? identity.toString()) : identity;
}

function resolveProvider<T extends object>(
	provider: T | ((context: ComputeExternalResourceContext) => T),
	context: ComputeResourceResolverContext,
	alias: string,
	state: ComputeExternalResolutionState
): T {
	if (typeof provider !== 'function') {
		return provider;
	}
	const cached = state.providerResults.get(provider);
	if (cached) {
		return cached as T;
	}
	let result: T;
	try {
		result = provider(context.externalContext);
	} catch (error) {
		const detail = error instanceof Error ? `: ${error.message}` : '.';
		throw externalResourceError(context, alias, `external provider failed${detail}`);
	}
	if (typeof result !== 'object' || result === null) {
		throw externalResourceError(
			context,
			alias,
			'external provider returned an invalid WebGPU object.'
		);
	}
	state.providerResults.set(provider, result);
	return result;
}

function registerExternalIdentity(
	object: object,
	resourceId: string | symbol,
	context: ComputeResourceResolverContext,
	alias: string,
	state: ComputeExternalResolutionState,
	kind?: 'texture' | 'buffer' | 'sampler'
): void {
	const existing = state.resourceIdByObject.get(object);
	if (existing !== undefined && !Object.is(existing, resourceId)) {
		throw externalResourceError(
			context,
			alias,
			`uses external object identity "${identityLabel(resourceId)}" but the same object was already declared as "${identityLabel(existing)}".`
		);
	}
	state.resourceIdByObject.set(object, resourceId);
	if (kind) {
		const objects =
			kind === 'texture'
				? state.textureByResourceId
				: kind === 'buffer'
					? state.bufferByResourceId
					: state.samplerByResourceId;
		const existingObject = objects.get(resourceId);
		if (existingObject !== undefined && existingObject !== object) {
			throw externalResourceError(
				context,
				alias,
				`external ${kind} identity "${identityLabel(resourceId)}" resolved to multiple physical objects in one frame.`
			);
		}
		objects.set(resourceId, object);
	}
}

function registerExternalMetadata(
	resourceId: string | symbol,
	metadata: string,
	context: ComputeResourceResolverContext,
	alias: string,
	state: ComputeExternalResolutionState
): void {
	const existing = state.metadataByResourceId.get(resourceId);
	if (existing !== undefined && existing !== metadata) {
		throw externalResourceError(
			context,
			alias,
			`declares metadata "${metadata}" for external identity "${identityLabel(resourceId)}", previously declared as "${existing}".`
		);
	}
	state.metadataByResourceId.set(resourceId, metadata);
}

/** Immutable registration retained with a cached physical resolution plan. */
export interface ComputeExternalRegistration {
	object: object;
	resourceId: string | symbol;
	alias: string;
	metadata: string;
	kind: 'texture' | 'buffer' | 'sampler' | undefined;
}

/** Revalidates frame-wide invariants without rebuilding resource descriptors. */
export function registerComputeExternalResource(
	registration: ComputeExternalRegistration,
	context: ComputeResourceResolverContext,
	state: ComputeExternalResolutionState
): void {
	registerExternalIdentity(
		registration.object,
		registration.resourceId,
		context,
		registration.alias,
		state,
		registration.kind
	);
	registerExternalMetadata(
		registration.resourceId,
		registration.metadata,
		context,
		registration.alias,
		state
	);
}

/**
 * Maps a supported 2D color texture format to its compute sampled contract.
 */
export function resolveComputeTextureFormat(
	format: GPUTextureFormat,
	deviceFeatures: ReadonlySet<string>
): ResolvedComputeTextureFormat {
	const capabilities = resolveTextureFormatCapabilities(format, deviceFeatures);
	const scalarType = textureSampleScalarType(format);
	if (scalarType === 'depth' || format === 'stencil8') {
		throw new Error(`Texture format "${format}" is not a supported 2D color format.`);
	}
	if (!capabilities.supported) {
		throw new Error(
			`Texture format "${format}" requires device feature "${capabilities.requiredFeatures.format}".`
		);
	}
	return {
		scalarType: scalarType as 'f32' | 'u32' | 'i32',
		sampleType: capabilities.sampleType!
	};
}

function resolveTextureRange(
	descriptor: ComputeTextureViewDescriptor | undefined,
	availableMipLevelCount: number,
	access: 'sampled' | 'storage-write',
	context: ComputeResourceResolverContext,
	alias: string
): ResolvedTextureSubresourceRange {
	const baseMipLevel = descriptor?.baseMipLevel ?? 0;
	const defaultMipLevelCount =
		access === 'storage-write' ? 1 : availableMipLevelCount - baseMipLevel;
	const mipLevelCount = descriptor?.mipLevelCount ?? defaultMipLevelCount;
	const baseArrayLayer = descriptor?.baseArrayLayer ?? 0;
	const arrayLayerCount = descriptor?.arrayLayerCount ?? 1;

	if (
		baseMipLevel < 0 ||
		mipLevelCount < 1 ||
		baseMipLevel + mipLevelCount > availableMipLevelCount
	) {
		throw resourceError(
			context,
			alias,
			`selects mip range ${baseMipLevel}..${baseMipLevel + mipLevelCount - 1}, outside ${availableMipLevelCount} available mip level(s).`
		);
	}
	if (access === 'storage-write' && mipLevelCount !== 1) {
		throw resourceError(context, alias, 'storage-write view must expose exactly one mip level.');
	}
	if (baseArrayLayer !== 0 || arrayLayerCount !== 1) {
		throw resourceError(
			context,
			alias,
			'only one 2D array layer at baseArrayLayer 0 is supported.'
		);
	}
	return { baseMipLevel, mipLevelCount, baseArrayLayer, arrayLayerCount: 1 };
}

function createTextureView(
	texture: GPUTexture,
	range: ResolvedTextureSubresourceRange,
	context: ComputeResourceResolverContext,
	alias: string
): GPUTextureView {
	const descriptor: GPUTextureViewDescriptor = {
		dimension: '2d',
		baseMipLevel: range.baseMipLevel,
		mipLevelCount: range.mipLevelCount,
		baseArrayLayer: range.baseArrayLayer,
		arrayLayerCount: range.arrayLayerCount
	};
	if (context.createTextureView) {
		return context.createTextureView(texture, descriptor);
	}
	if (typeof texture.createView !== 'function') {
		throw resourceError(context, alias, 'cannot create the requested texture view.');
	}
	return texture.createView(descriptor);
}

function isFullTextureRange(
	range: ResolvedTextureSubresourceRange,
	mipLevelCount: number
): boolean {
	return (
		range.baseMipLevel === 0 &&
		range.mipLevelCount === mipLevelCount &&
		range.baseArrayLayer === 0 &&
		range.arrayLayerCount === 1
	);
}

function validateExternalTextureMetadata(
	texture: GPUTexture,
	reference: ComputeExternalTextureReference,
	context: ComputeResourceResolverContext,
	alias: string
): number {
	if (texture.format !== undefined && texture.format !== reference.format) {
		throw externalResourceError(
			context,
			alias,
			`declares format "${reference.format}" but the external texture reports "${texture.format}".`
		);
	}
	if (texture.usage !== undefined && texture.usage !== reference.usage) {
		throw externalResourceError(
			context,
			alias,
			`declares usage ${reference.usage} but the external texture reports ${texture.usage}.`
		);
	}
	if (texture.dimension !== undefined && texture.dimension !== '2d') {
		throw externalResourceError(context, alias, `external texture dimension must be "2d".`);
	}
	if (texture.sampleCount !== undefined && texture.sampleCount !== 1) {
		throw externalResourceError(
			context,
			alias,
			'multisampled external textures are not supported.'
		);
	}
	if (texture.depthOrArrayLayers !== undefined && texture.depthOrArrayLayers !== 1) {
		throw externalResourceError(
			context,
			alias,
			'array, cube, and 3D external textures are not supported.'
		);
	}
	return texture.mipLevelCount ?? 1;
}

function resolveTextureReferenceForAccess(
	reference: ComputeTextureReference,
	access: 'sampled' | 'storage-write',
	viewDescriptor: ComputeTextureViewDescriptor | undefined,
	context: ComputeResourceResolverContext,
	alias: string,
	state: ComputeExternalResolutionState
): { reference: ResolvedTextureReference; range: ResolvedTextureSubresourceRange } {
	if (typeof reference === 'string') {
		const resource = context.getMaterialTexture(reference);
		if (!resource) {
			throw resourceError(
				context,
				alias,
				`references unknown material texture "${reference}".`,
				'COMPUTE_RESOURCE_UNKNOWN'
			);
		}
		const requiredUsage =
			access === 'sampled' ? textureBindingUsage() : storageTextureBindingUsage();
		if (!hasUsage(resource.usage, requiredUsage)) {
			const usageName = access === 'sampled' ? 'TEXTURE_BINDING' : 'STORAGE_BINDING';
			throw resourceError(
				context,
				alias,
				`references material texture "${reference}" without GPUTextureUsage.${usageName}.`
			);
		}
		const range = resolveTextureRange(
			viewDescriptor,
			resource.mipLevelCount,
			access,
			context,
			alias
		);
		let baseView: GPUTextureView;
		if (access === 'sampled' && isFullTextureRange(range, resource.mipLevelCount)) {
			baseView = resource.publishedView;
		} else if (access === 'storage-write' && range.baseMipLevel === 0 && resource.storageView) {
			baseView = resource.storageView;
		} else if (resource.ownedTexture) {
			baseView = createTextureView(resource.ownedTexture, range, context, alias);
		} else {
			throw resourceError(
				context,
				alias,
				`cannot create the requested view for material texture "${reference}" without an allocated texture.`
			);
		}

		return {
			reference: {
				logicalId: resource.logicalId,
				physicalId: resource.ownedTexture ?? resource.publishedView,
				source: 'material',
				format: resource.format,
				usage: resource.usage,
				mipLevelCount: resource.mipLevelCount,
				baseView,
				texture: resource.ownedTexture,
				isExternalView: false
			},
			range
		};
	}

	if ('externalTexture' in reference) {
		const texture = resolveProvider(reference.externalTexture, context, alias, state);
		registerExternalIdentity(texture, reference.resourceId, context, alias, state, 'texture');
		registerExternalMetadata(
			reference.resourceId,
			`texture:${reference.format}:${reference.usage}`,
			context,
			alias,
			state
		);
		const mipLevelCount = validateExternalTextureMetadata(texture, reference, context, alias);
		const requiredUsage =
			access === 'sampled' ? textureBindingUsage() : storageTextureBindingUsage();
		if (!hasUsage(reference.usage, requiredUsage)) {
			const usageName = access === 'sampled' ? 'TEXTURE_BINDING' : 'STORAGE_BINDING';
			throw externalResourceError(
				context,
				alias,
				`external texture "${identityLabel(reference.resourceId)}" lacks GPUTextureUsage.${usageName}.`
			);
		}
		const range = resolveTextureRange(viewDescriptor, mipLevelCount, access, context, alias);
		return {
			reference: {
				logicalId: reference.resourceId,
				physicalId: texture,
				source: 'external',
				format: reference.format,
				usage: reference.usage,
				mipLevelCount,
				baseView: createTextureView(texture, range, context, alias),
				texture,
				isExternalView: false
			},
			range
		};
	}

	const view = resolveProvider(reference.externalView, context, alias, state);
	registerExternalIdentity(view, reference.resourceId, context, alias, state);
	registerExternalMetadata(
		reference.resourceId,
		`texture:${reference.format}:${reference.usage}`,
		context,
		alias,
		state
	);
	const requiredUsage = access === 'sampled' ? textureBindingUsage() : storageTextureBindingUsage();
	if (!hasUsage(reference.usage, requiredUsage)) {
		const usageName = access === 'sampled' ? 'TEXTURE_BINDING' : 'STORAGE_BINDING';
		throw externalResourceError(
			context,
			alias,
			`external texture view "${identityLabel(reference.resourceId)}" lacks GPUTextureUsage.${usageName}.`
		);
	}
	const range = resolveTextureRange(
		viewDescriptor,
		reference.mipLevelCount,
		access,
		context,
		alias
	);
	if (!isFullTextureRange(range, reference.mipLevelCount)) {
		throw externalResourceError(
			context,
			alias,
			'externalView already represents a fixed view and cannot be narrowed by a view descriptor.'
		);
	}
	return {
		reference: {
			logicalId: reference.resourceId,
			physicalId: view,
			source: 'external',
			format: reference.format,
			usage: reference.usage,
			mipLevelCount: reference.mipLevelCount,
			baseView: view,
			texture: null,
			isExternalView: true
		},
		range
	};
}

function resolveBufferReferenceForAccess(
	reference: ComputeBufferReference,
	context: ComputeResourceResolverContext,
	alias: string,
	state: ComputeExternalResolutionState
): ResolvedBufferReference {
	if (typeof reference === 'string') {
		const resource = context.getMaterialStorageBuffer(reference);
		if (!resource) {
			throw resourceError(
				context,
				alias,
				`references unknown material storage buffer "${reference}".`,
				'COMPUTE_RESOURCE_UNKNOWN'
			);
		}
		return {
			logicalId: resource.logicalId,
			physicalId: resource.buffer,
			source: 'material',
			buffer: resource.buffer,
			size: resource.size,
			wgslType: resource.wgslType,
			usage: resource.usage,
			materialAccess: resource.access
		};
	}

	const buffer = resolveProvider(reference.externalBuffer, context, alias, state);
	registerExternalIdentity(buffer, reference.resourceId, context, alias, state, 'buffer');
	registerExternalMetadata(
		reference.resourceId,
		`buffer:${reference.wgslType}:${reference.size}:${reference.usage}`,
		context,
		alias,
		state
	);
	if (buffer.size !== undefined && buffer.size !== reference.size) {
		throw externalResourceError(
			context,
			alias,
			`declares size ${reference.size} but the external buffer reports ${buffer.size}.`
		);
	}
	if (buffer.usage !== undefined && buffer.usage !== reference.usage) {
		throw externalResourceError(
			context,
			alias,
			`declares usage ${reference.usage} but the external buffer reports ${buffer.usage}.`
		);
	}
	return {
		logicalId: reference.resourceId,
		physicalId: buffer,
		source: 'external',
		buffer,
		size: reference.size,
		wgslType: reference.wgslType,
		usage: reference.usage,
		materialAccess: undefined
	};
}

function resolveSamplerReferenceForBinding(
	reference: ComputeSamplerReference,
	context: ComputeResourceResolverContext,
	alias: string,
	state: ComputeExternalResolutionState
): ResolvedSamplerReference {
	if (typeof reference === 'string') {
		const resource = context.getMaterialSampler(reference);
		if (!resource) {
			throw resourceError(
				context,
				alias,
				`references unknown material sampler "${reference}".`,
				'COMPUTE_RESOURCE_UNKNOWN'
			);
		}
		return {
			logicalId: resource.logicalId,
			physicalId: resource.sampler,
			source: 'material',
			sampler: resource.sampler,
			type: resource.type,
			materialSampleType: resource.sampleType
		};
	}

	const sampler = resolveProvider(reference.externalSampler, context, alias, state);
	registerExternalIdentity(sampler, reference.resourceId, context, alias, state, 'sampler');
	registerExternalMetadata(
		reference.resourceId,
		`sampler:${reference.type}`,
		context,
		alias,
		state
	);
	return {
		logicalId: reference.resourceId,
		physicalId: sampler,
		source: 'external',
		sampler,
		type: reference.type,
		materialSampleType: undefined
	};
}

function textureRangesOverlap(
	a: ResolvedTextureSubresourceRange,
	b: ResolvedTextureSubresourceRange
): boolean {
	const mipsOverlap =
		a.baseMipLevel < b.baseMipLevel + b.mipLevelCount &&
		b.baseMipLevel < a.baseMipLevel + a.mipLevelCount;
	const layersOverlap =
		a.baseArrayLayer < b.baseArrayLayer + b.arrayLayerCount &&
		b.baseArrayLayer < a.baseArrayLayer + a.arrayLayerCount;
	return mipsOverlap && layersOverlap;
}

function formatRange(range: ResolvedTextureSubresourceRange): string {
	return `mip ${range.baseMipLevel}..${range.baseMipLevel + range.mipLevelCount - 1}`;
}

function freezeResolvedEntry<T extends ResolvedComputeResource>(entry: T): T {
	if ('subresource' in entry) {
		Object.freeze(entry.subresource);
	}
	if (entry.layoutEntry.texture) Object.freeze(entry.layoutEntry.texture);
	if (entry.layoutEntry.storageTexture) Object.freeze(entry.layoutEntry.storageTexture);
	if (entry.layoutEntry.buffer) Object.freeze(entry.layoutEntry.buffer);
	if (entry.layoutEntry.sampler) Object.freeze(entry.layoutEntry.sampler);
	Object.freeze(entry.layoutEntry);
	return Object.freeze(entry);
}

function validateResolvedResourceHazards(
	entries: readonly ResolvedComputeResource[],
	context: ComputeResourceResolverContext,
	pingPongPair: ComputePingPongResourcePair | null
): void {
	for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
		const left = entries[leftIndex];
		if (!left) continue;
		for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
			const right = entries[rightIndex];
			if (
				!right ||
				(!Object.is(left.physicalId, right.physicalId) &&
					!(
						left.source === 'external' &&
						right.source === 'external' &&
						Object.is(left.logicalId, right.logicalId)
					))
			) {
				continue;
			}

			if (
				(left.kind === 'sampled-texture' || left.kind === 'storage-texture') &&
				(right.kind === 'sampled-texture' || right.kind === 'storage-texture')
			) {
				if (!textureRangesOverlap(left.subresource, right.subresource)) continue;
				const isStructuralPingPongPair =
					pingPongPair !== null &&
					((left.alias === pingPongPair.readAlias && right.alias === pingPongPair.writeAlias) ||
						(left.alias === pingPongPair.writeAlias && right.alias === pingPongPair.readAlias));
				if (isStructuralPingPongPair) continue;
				if (left.kind === 'sampled-texture' && right.kind === 'sampled-texture') continue;
				throw resourceError(
					context,
					right.alias,
					`overlaps ${context.passLabel} resource "${left.alias}" on ${formatRange(right.subresource)} while at least one alias is writable.`,
					'COMPUTE_RESOURCE_HAZARD'
				);
			}

			if (left.kind === 'storage-buffer' && right.kind === 'storage-buffer') {
				if (left.access === 'storage-read' && right.access === 'storage-read') continue;
				throw resourceError(
					context,
					right.alias,
					`aliases the same storage buffer as ${context.passLabel} resource "${left.alias}" with an incompatible writable access.`,
					'COMPUTE_RESOURCE_HAZARD'
				);
			}
		}
	}
}

function validateResolvedResourceLimits(
	entries: readonly ResolvedComputeResource[],
	context: ComputeResourceResolverContext
): void {
	const { limits } = context;
	const counts = {
		bindings: entries.length,
		sampledTextures: entries.filter((entry) => entry.kind === 'sampled-texture').length,
		samplers: entries.filter((entry) => entry.kind === 'sampler').length,
		storageTextures: entries.filter((entry) => entry.kind === 'storage-texture').length,
		storageBuffers: entries.filter((entry) => entry.kind === 'storage-buffer').length
	};
	const checks: Array<[number, number, string]> = [
		[counts.bindings, limits.maxBindingsPerBindGroup, 'maxBindingsPerBindGroup'],
		[
			counts.sampledTextures,
			limits.maxSampledTexturesPerShaderStage,
			'maxSampledTexturesPerShaderStage'
		],
		[counts.samplers, limits.maxSamplersPerShaderStage, 'maxSamplersPerShaderStage'],
		[
			counts.storageTextures,
			limits.maxStorageTexturesPerShaderStage,
			'maxStorageTexturesPerShaderStage'
		],
		[
			counts.storageBuffers,
			limits.maxStorageBuffersPerShaderStage,
			'maxStorageBuffersPerShaderStage'
		]
	];
	for (const [required, limit, name] of checks) {
		if (required > limit) {
			const error = createSpektralError(
				'COMPUTE_RESOURCE_LIMIT_EXCEEDED',
				`${context.passLabel} requires ${required} ${name}, device limit is ${limit}.`
			);
			throw context.diagnosticContext
				? attachSpektralErrorContext(error, context.diagnosticContext)
				: error;
		}
	}
	for (const entry of entries) {
		if (entry.kind === 'storage-buffer' && entry.size > limits.maxStorageBufferBindingSize) {
			throw resourceError(
				context,
				entry.alias,
				`requires ${entry.size} bytes, exceeding maxStorageBufferBindingSize ${limits.maxStorageBufferBindingSize}.`,
				'COMPUTE_RESOURCE_LIMIT_EXCEEDED'
			);
		}
	}
}

function toTextureAccess(
	entry: ResolvedSampledTextureResource | ResolvedStorageTextureResource,
	mode: 'read' | 'write',
	version: ComputeResourceVersion
): ResolvedComputeAccess {
	return {
		alias: entry.alias,
		resourceKind: 'texture',
		logicalId: entry.logicalId,
		physicalId: entry.physicalId,
		source: entry.source,
		mode,
		version,
		subresource: entry.subresource
	};
}

function toBufferAccess(
	entry: ResolvedStorageBufferResource,
	mode: 'read' | 'write',
	version: ComputeResourceVersion
): ResolvedComputeAccess {
	return {
		alias: entry.alias,
		resourceKind: 'buffer',
		logicalId: entry.logicalId,
		physicalId: entry.physicalId,
		source: entry.source,
		mode,
		version
	};
}

/**
 * Resolves one immutable public resource map into the single model consumed by
 * shader generation, layouts, bind groups, graph planning, and dispatch.
 */
export function resolveComputePassResources(
	resources: ComputeResourceMap,
	context: ComputeResourceResolverContext
): ResolvedComputePassResources {
	const normalized = normalizeComputeResourceMap(resources);
	return resolveTrustedComputePassResources(normalized, Object.keys(normalized), context);
}

/**
 * Resolves a pass-owned, already-normalized topology without re-entering the
 * public validation/copy boundary.
 *
 * @internal Renderer cache only.
 */
export function resolveTrustedComputePassResources(
	resources: ComputeResourceMap,
	aliases: readonly string[],
	context: ComputeResourceResolverContext
): ResolvedComputePassResources {
	const pingPongPair = context.pingPong ? resolveComputePingPongResourcePair(resources) : null;
	if (!context.pingPong) {
		for (const alias of aliases) {
			const descriptor = resources[alias]!;
			if ('texture' in descriptor && descriptor.pingPong !== undefined) {
				throw resourceError(context, alias, 'declares a pingPong role on a normal ComputePass.');
			}
		}
	}

	const state = context.externalState ?? createComputeExternalResolutionState();
	const entries: ResolvedComputeResource[] = [];
	const reads: ResolvedComputeAccess[] = [];
	const writes: ResolvedComputeAccess[] = [];

	for (const alias of aliases) {
		const descriptor = resources[alias]!;
		const binding = entries.length;
		if ('texture' in descriptor) {
			const resolved = resolveTextureReferenceForAccess(
				descriptor.texture,
				descriptor.access,
				descriptor.view,
				context,
				alias,
				state
			);
			if (descriptor.access === 'sampled') {
				let format: ResolvedComputeTextureFormat;
				try {
					format = resolveComputeTextureFormat(resolved.reference.format, context.deviceFeatures);
				} catch (error) {
					throw resourceError(
						context,
						alias,
						error instanceof Error ? error.message : 'has an unsupported sampled format.'
					);
				}
				const version = descriptor.version ?? 'current';
				const entry = freezeResolvedEntry<ResolvedSampledTextureResource>({
					kind: 'sampled-texture',
					alias,
					binding,
					logicalId: resolved.reference.logicalId,
					physicalId: resolved.reference.physicalId,
					source: resolved.reference.source,
					access: 'sampled',
					format: resolved.reference.format,
					scalarType: format.scalarType,
					sampleType: format.sampleType,
					version,
					pingPong: descriptor.pingPong,
					subresource: resolved.range,
					layoutEntry: {
						binding,
						visibility: computeShaderVisibility(),
						texture: {
							sampleType: format.sampleType,
							viewDimension: '2d',
							multisampled: false
						}
					},
					bindingResource: resolved.reference.baseView,
					topologyPart: `${alias}:${binding}:sampled:${format.scalarType}:${format.sampleType}:${resolved.range.baseMipLevel}:${resolved.range.mipLevelCount}`
				});
				entries.push(entry);
				reads.push(toTextureAccess(entry, 'read', version));
				continue;
			}

			const storageCapabilities = resolveTextureFormatCapabilities(
				resolved.reference.format,
				context.deviceFeatures
			);
			if (!storageCapabilities.storageAccess.includes('write-only')) {
				const requiredFeature =
					storageCapabilities.requiredFeatures.format ??
					storageCapabilities.requiredFeatures.storageAccess?.['write-only'];
				throw resourceError(
					context,
					alias,
					requiredFeature
						? `uses format "${resolved.reference.format}" which requires device feature "${requiredFeature}" for storage-write access.`
						: `uses format "${resolved.reference.format}" which is not storage-write compatible.`
				);
			}
			const entry = freezeResolvedEntry<ResolvedStorageTextureResource>({
				kind: 'storage-texture',
				alias,
				binding,
				logicalId: resolved.reference.logicalId,
				physicalId: resolved.reference.physicalId,
				source: resolved.reference.source,
				access: 'storage-write',
				format: resolved.reference.format,
				pingPong: descriptor.pingPong,
				subresource: resolved.range,
				layoutEntry: {
					binding,
					visibility: computeShaderVisibility(),
					storageTexture: {
						access: 'write-only',
						format: resolved.reference.format,
						viewDimension: '2d'
					}
				},
				bindingResource: resolved.reference.baseView,
				topologyPart: `${alias}:${binding}:storage-write:${resolved.reference.format}:${resolved.range.baseMipLevel}`
			});
			entries.push(entry);
			writes.push(toTextureAccess(entry, 'write', 'current'));
			continue;
		}

		if ('buffer' in descriptor) {
			const resolved = resolveBufferReferenceForAccess(descriptor.buffer, context, alias, state);
			if (!hasUsage(resolved.usage, storageBufferBindingUsage())) {
				throw resourceError(
					context,
					alias,
					`storage buffer "${identityLabel(resolved.logicalId)}" lacks GPUBufferUsage.STORAGE.`
				);
			}
			if (descriptor.access === 'storage-read-write' && resolved.materialAccess === 'read') {
				throw resourceError(
					context,
					alias,
					`cannot write material storage buffer "${identityLabel(resolved.logicalId)}" declared with access "read".`
				);
			}
			const version =
				descriptor.access === 'storage-read' ? (descriptor.version ?? 'current') : undefined;
			const entry = freezeResolvedEntry<ResolvedStorageBufferResource>({
				kind: 'storage-buffer',
				alias,
				binding,
				logicalId: resolved.logicalId,
				physicalId: resolved.physicalId,
				source: resolved.source,
				access: descriptor.access,
				wgslType: resolved.wgslType,
				size: resolved.size,
				version,
				layoutEntry: {
					binding,
					visibility: computeShaderVisibility(),
					buffer: {
						type: descriptor.access === 'storage-read' ? 'read-only-storage' : 'storage'
					}
				},
				bindingResource: Object.freeze({ buffer: resolved.buffer, size: resolved.size }),
				topologyPart: `${alias}:${binding}:${descriptor.access}:${resolved.wgslType}`
			});
			entries.push(entry);
			reads.push(toBufferAccess(entry, 'read', version ?? 'initial'));
			if (descriptor.access === 'storage-read-write') {
				writes.push(toBufferAccess(entry, 'write', 'current'));
			}
			continue;
		}

		const resolved = resolveSamplerReferenceForBinding(descriptor.sampler, context, alias, state);
		if (resolved.type === 'comparison') {
			throw resourceError(
				context,
				alias,
				'comparison samplers are outside the color texture contract.'
			);
		}
		if (resolved.type === 'filtering' && resolved.materialSampleType !== undefined) {
			if (resolved.materialSampleType !== 'float') {
				throw resourceError(
					context,
					alias,
					`filtering sampler is incompatible with ${resolved.materialSampleType} material texture sampling.`
				);
			}
		}
		const entry = freezeResolvedEntry<ResolvedSamplerResource>({
			kind: 'sampler',
			alias,
			binding,
			logicalId: resolved.logicalId,
			physicalId: resolved.physicalId,
			source: resolved.source,
			samplerType: resolved.type,
			layoutEntry: {
				binding,
				visibility: computeShaderVisibility(),
				sampler: { type: resolved.type }
			},
			bindingResource: resolved.sampler,
			topologyPart: `${alias}:${binding}:sampler:${resolved.type}`
		});
		entries.push(entry);
	}

	validateResolvedResourceHazards(entries, context, pingPongPair);
	validateResolvedResourceLimits(entries, context);
	return Object.freeze({
		entries: Object.freeze(entries),
		reads: Object.freeze(reads.map((access) => Object.freeze(access))),
		writes: Object.freeze(writes.map((access) => Object.freeze(access))),
		topologyKey: entries.map((entry) => entry.topologyPart).join('|'),
		bindingCount: entries.length
	});
}
