import { normalizeTextureDefinition } from './textures.js';
import type {
	MaterialDefines,
	MaterialIncludes,
	MaterialLineMap,
	MaterialSourceMetadata,
	PreprocessedMaterialFragment
} from './material-contracts.js';
export type {
	MaterialDefines,
	MaterialDefineVectorType,
	MaterialDefineVectorValue,
	MaterialDefineValue,
	MaterialIncludes,
	TypedMaterialDefineValue,
	TypedMaterialVectorDefineValue
} from './material-contracts.js';
import {
	assertUniformName,
	assertUniformValueForType,
	inferUniformType,
	resolveUniformLayout
} from './uniforms.js';
import {
	normalizeDefines,
	normalizeIncludes,
	preprocessMaterialFragment,
	toDefineLine
} from './material-preprocess.js';
import { assertStorageBufferDefinition, assertStorageTextureFormat } from './storage-buffers.js';
import type {
	StorageBufferDefinition,
	StorageBufferDefinitionMap,
	TextureData,
	TextureDefinition,
	TextureDefinitionMap,
	TextureValue,
	TypedUniform,
	UniformMap,
	UniformValue
} from './types.js';

/**
 * External material input accepted by {@link defineMaterial}.
 */
export interface FragMaterialInput<
	TUniformKey extends string = string,
	TTextureKey extends string = string,
	TDefineKey extends string = string,
	TIncludeKey extends string = string,
	TStorageBufferKey extends string = string
> {
	/**
	 * User WGSL source containing `frag(uv: vec2f) -> vec4f`.
	 */
	fragment: string;
	/**
	 * Initial uniform values.
	 */
	uniforms?: UniformMap<TUniformKey>;
	/**
	 * Texture definitions keyed by texture uniform name.
	 */
	textures?: TextureDefinitionMap<TTextureKey>;
	/**
	 * Optional compile-time define constants injected into WGSL.
	 */
	defines?: MaterialDefines<TDefineKey>;
	/**
	 * Optional WGSL include chunks used by `#include <name>` directives.
	 */
	includes?: MaterialIncludes<TIncludeKey>;
	/**
	 * Optional storage buffer definitions for compute shaders.
	 */
	storageBuffers?: StorageBufferDefinitionMap<TStorageBufferKey>;
}

/**
 * Normalized and immutable material declaration consumed by `FragCanvas`.
 */
export interface FragMaterial<
	TUniformKey extends string = string,
	TTextureKey extends string = string,
	TDefineKey extends string = string,
	TIncludeKey extends string = string,
	TStorageBufferKey extends string = string
> {
	/**
	 * User WGSL source containing `frag(uv: vec2f) -> vec4f`.
	 */
	readonly fragment: string;
	/**
	 * Initial uniform values.
	 */
	readonly uniforms: Readonly<UniformMap<TUniformKey>>;
	/**
	 * Texture definitions keyed by texture uniform name.
	 */
	readonly textures: Readonly<TextureDefinitionMap<TTextureKey>>;
	/**
	 * Optional compile-time define constants injected into WGSL.
	 */
	readonly defines: Readonly<MaterialDefines<TDefineKey>>;
	/**
	 * Optional WGSL include chunks used by `#include <name>` directives.
	 */
	readonly includes: Readonly<MaterialIncludes<TIncludeKey>>;
	/**
	 * Storage buffer definitions for compute shaders. Empty when not provided.
	 */
	readonly storageBuffers: Readonly<StorageBufferDefinitionMap<TStorageBufferKey>>;
}

/**
 * Fully resolved, immutable material snapshot used for renderer creation/caching.
 */
export interface ResolvedMaterial<
	TUniformKey extends string = string,
	TTextureKey extends string = string,
	TIncludeKey extends string = string,
	TStorageBufferKey extends string = string
> {
	/**
	 * Final fragment WGSL after define injection.
	 */
	readonly fragmentWgsl: string;
	/**
	 * 1-based map from generated fragment lines to user source lines.
	 */
	readonly fragmentLineMap: MaterialLineMap;
	/**
	 * Cloned uniforms.
	 */
	readonly uniforms: Readonly<UniformMap<TUniformKey>>;
	/**
	 * Cloned texture definitions.
	 */
	readonly textures: Readonly<TextureDefinitionMap<TTextureKey>>;
	/**
	 * Resolved packed uniform layout.
	 */
	readonly uniformLayout: ReturnType<typeof resolveUniformLayout>;
	/**
	 * Sorted texture keys.
	 */
	readonly textureKeys: readonly TTextureKey[];
	/**
	 * Deterministic JSON cache fingerprint. Matching storage-data hashes also
	 * require an exact byte comparison before reusing renderer resources.
	 */
	readonly signature: string;
	/**
	 * Original user fragment source before preprocessing.
	 */
	readonly fragmentSource: string;
	/**
	 * Normalized include sources map.
	 */
	readonly includeSources: Readonly<MaterialIncludes<TIncludeKey>>;
	/**
	 * Deterministic define block source used for diagnostics mapping.
	 */
	readonly defineBlockSource: string;
	/**
	 * Source metadata used for diagnostics.
	 */
	readonly source: Readonly<MaterialSourceMetadata> | null;
	/**
	 * Sorted storage buffer keys. Empty array when no storage buffers declared.
	 */
	readonly storageBufferKeys: readonly TStorageBufferKey[];
	/**
	 * Sorted storage texture keys (textures with storage: true).
	 */
	readonly storageTextureKeys: readonly TTextureKey[];
}

/**
 * Strict fragment contract used by Spektral.
 */
const FRAGMENT_FUNCTION_SIGNATURE_PATTERN =
	/\bfn[ \t\r\n]+frag[ \t\r\n]*\(([^)]*)\)[ \t\r\n]*->[ \t\r\n]*([A-Za-z_][A-Za-z0-9_<>]*)[ \t\r\n]*(?:\{|$)/m;
const FRAGMENT_FUNCTION_NAME_PATTERN = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

/**
 * Cache of resolved material snapshots keyed by immutable material instance.
 */
type AnyFragMaterial = FragMaterial<string, string, string, string, string>;
type AnyResolvedMaterial = ResolvedMaterial<string, string, string, string>;

const resolvedMaterialCache = new WeakMap<AnyFragMaterial, AnyResolvedMaterial>();
const preprocessedFragmentCache = new WeakMap<AnyFragMaterial, PreprocessedMaterialFragment>();
const materialSourceMetadataCache = new WeakMap<AnyFragMaterial, MaterialSourceMetadata | null>();

function getCachedResolvedMaterial<
	TUniformKey extends string,
	TTextureKey extends string,
	TIncludeKey extends string,
	TStorageBufferKey extends string
>(
	material: FragMaterial<TUniformKey, TTextureKey, string, TIncludeKey, TStorageBufferKey>
): ResolvedMaterial<TUniformKey, TTextureKey, TIncludeKey, TStorageBufferKey> | null {
	const cached = resolvedMaterialCache.get(material);
	if (!cached) {
		return null;
	}

	// Invariant: the cache key is the same material object used to produce this resolved payload.
	return cached as ResolvedMaterial<TUniformKey, TTextureKey, TIncludeKey, TStorageBufferKey>;
}

const STACK_TRACE_CHROME_PATTERN = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
const STACK_TRACE_FIREFOX_PATTERN = /^(.*?)@(.+?):(\d+):(\d+)$/;

function getPathBasename(path: string): string {
	const normalized = path.split(/[?#]/)[0] ?? path;
	const parts = normalized.split(/[\\/]/);
	const last = parts[parts.length - 1];
	return last && last.length > 0 ? last : path;
}

function normalizeSignaturePart(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function listFunctionNames(fragment: string): string[] {
	const names = new Set<string>();
	for (const match of fragment.matchAll(FRAGMENT_FUNCTION_NAME_PATTERN)) {
		const name = match[1];
		if (!name) {
			continue;
		}
		names.add(name);
	}

	return Array.from(names);
}

function captureMaterialSourceFromStack(): MaterialSourceMetadata | null {
	const stack = new Error().stack;
	if (!stack) {
		return null;
	}

	const stackLines = stack.split('\n').slice(1);
	for (const rawLine of stackLines) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}

		const chromeMatch = line.match(STACK_TRACE_CHROME_PATTERN);
		const firefoxMatch = line.match(STACK_TRACE_FIREFOX_PATTERN);
		const functionName = chromeMatch?.[1] ?? firefoxMatch?.[1] ?? undefined;
		const file = chromeMatch?.[2] ?? firefoxMatch?.[2];
		const lineValue = chromeMatch?.[3] ?? firefoxMatch?.[3];
		const columnValue = chromeMatch?.[4] ?? firefoxMatch?.[4];

		if (!file || !lineValue || !columnValue) {
			continue;
		}

		if (file.includes('/core/material') || file.includes('\\core\\material')) {
			continue;
		}

		const parsedLine = Number.parseInt(lineValue, 10);
		const parsedColumn = Number.parseInt(columnValue, 10);
		if (!Number.isFinite(parsedLine) || !Number.isFinite(parsedColumn)) {
			continue;
		}

		return {
			component: getPathBasename(file),
			file,
			line: parsedLine,
			column: parsedColumn,
			...(functionName ? { functionName } : {})
		};
	}

	return null;
}

function resolveSourceMetadata(
	source: MaterialSourceMetadata | undefined
): MaterialSourceMetadata | null {
	const captured = captureMaterialSourceFromStack();
	const component = source?.component ?? captured?.component;
	const file = source?.file ?? captured?.file;
	const line = source?.line ?? captured?.line;
	const column = source?.column ?? captured?.column;
	const functionName = source?.functionName ?? captured?.functionName;

	if (
		component === undefined &&
		file === undefined &&
		line === undefined &&
		column === undefined &&
		functionName === undefined
	) {
		return null;
	}

	return {
		...(component !== undefined ? { component } : {}),
		...(file !== undefined ? { file } : {}),
		...(line !== undefined ? { line } : {}),
		...(column !== undefined ? { column } : {}),
		...(functionName !== undefined ? { functionName } : {})
	};
}

/**
 * Asserts that material has been normalized by {@link defineMaterial}.
 */
function assertDefinedMaterial(material: AnyFragMaterial): void {
	if (
		!Object.isFrozen(material) ||
		!material.uniforms ||
		!material.textures ||
		!material.defines ||
		!material.includes
	) {
		throw new Error(
			'Invalid material instance. Create materials with defineMaterial(...) before passing them to <FragCanvas>.'
		);
	}
}

/**
 * Clones uniform value input to decouple material instances from external objects.
 */
function cloneUniformValue(value: UniformValue): UniformValue {
	if (typeof value === 'number') {
		return value;
	}

	if (Array.isArray(value)) {
		return Object.freeze([...value]) as UniformValue;
	}

	if (typeof value === 'object' && value !== null && 'type' in value && 'value' in value) {
		const typed = value as TypedUniform;
		const typedValue = typed.value as unknown;

		let clonedTypedValue = typedValue;
		if (typed.type === 'mat4x4f' && typedValue instanceof Float32Array) {
			clonedTypedValue = Object.freeze(Array.from(typedValue));
		} else if (typedValue instanceof Float32Array) {
			clonedTypedValue = new Float32Array(typedValue);
		} else if (Array.isArray(typedValue)) {
			clonedTypedValue = Object.freeze([...typedValue]);
		}

		return Object.freeze({
			type: typed.type,
			value: clonedTypedValue
		}) as UniformValue;
	}

	return value;
}

/**
 * Clones optional texture value payload.
 */
function cloneTextureValue(value: TextureValue | undefined): TextureValue {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value === 'object' && 'source' in value) {
		const data = value as TextureData;
		return Object.freeze({
			source: data.source,
			...(data.width !== undefined ? { width: data.width } : {}),
			...(data.height !== undefined ? { height: data.height } : {}),
			...(data.colorSpace !== undefined ? { colorSpace: data.colorSpace } : {}),
			...(data.flipY !== undefined ? { flipY: data.flipY } : {}),
			...(data.premultipliedAlpha !== undefined
				? { premultipliedAlpha: data.premultipliedAlpha }
				: {}),
			...(data.generateMipmaps !== undefined ? { generateMipmaps: data.generateMipmaps } : {}),
			...(data.update !== undefined ? { update: data.update } : {})
		});
	}

	return value;
}

/**
 * Clones and validates fragment source contract.
 */
function resolveFragment(fragment: string): string {
	if (typeof fragment !== 'string' || fragment.trim().length === 0) {
		throw new Error('Material fragment shader must be a non-empty WGSL string.');
	}

	const signature = fragment.match(FRAGMENT_FUNCTION_SIGNATURE_PATTERN);
	if (!signature) {
		const discoveredFunctions = listFunctionNames(fragment).slice(0, 4);
		const discoveredLabel =
			discoveredFunctions.length > 0
				? `Found: ${discoveredFunctions.map((name) => `\`${name}(...)\``).join(', ')}.`
				: 'No WGSL function declarations were found.';

		throw new Error(
			`Material fragment contract mismatch: missing entrypoint \`fn frag(uv: vec2f) -> vec4f\`. ${discoveredLabel}`
		);
	}

	const params = normalizeSignaturePart(signature[1] ?? '');
	const returnType = normalizeSignaturePart(signature[2] ?? '');

	if (params !== 'uv: vec2f') {
		throw new Error(
			`Material fragment contract mismatch for \`frag\`: expected parameter list \`(uv: vec2f)\`, received \`(${params || '...'})\`.`
		);
	}

	if (returnType !== 'vec4f') {
		throw new Error(
			`Material fragment contract mismatch for \`frag\`: expected return type \`vec4f\`, received \`${returnType}\`.`
		);
	}

	return fragment;
}

/**
 * Clones and validates uniform declarations.
 */
function resolveUniforms<TUniformKey extends string>(
	uniforms: UniformMap<TUniformKey> | undefined
): UniformMap<TUniformKey> {
	const resolved: UniformMap<TUniformKey> = {} as UniformMap<TUniformKey>;

	for (const [name, value] of Object.entries(uniforms ?? {}) as Array<
		[TUniformKey, UniformValue]
	>) {
		assertUniformName(name);
		const clonedValue = cloneUniformValue(value);
		const type = inferUniformType(clonedValue);
		assertUniformValueForType(type, clonedValue);
		resolved[name] = clonedValue;
	}

	resolveUniformLayout(resolved);
	return resolved;
}

/**
 * Clones and validates texture declarations.
 */
function resolveTextures<TTextureKey extends string>(
	textures: TextureDefinitionMap<TTextureKey> | undefined
): TextureDefinitionMap<TTextureKey> {
	const resolved: TextureDefinitionMap<TTextureKey> = {} as TextureDefinitionMap<TTextureKey>;

	for (const [name, definition] of Object.entries(textures ?? {}) as Array<
		[TTextureKey, TextureDefinition]
	>) {
		assertUniformName(name);
		const source = definition?.source;
		const normalizedSource = cloneTextureValue(source);

		const clonedDefinition: TextureDefinition = {
			...(definition ?? {}),
			...(source !== undefined ? { source: normalizedSource } : {})
		};

		resolved[name] = Object.freeze(clonedDefinition);
	}

	return resolved;
}

/**
 * Clones and validates define declarations.
 */
function resolveDefines<TDefineKey extends string>(
	defines: MaterialDefines<TDefineKey> | undefined
): MaterialDefines<TDefineKey> {
	return normalizeDefines(defines);
}

/**
 * Clones and validates include declarations.
 */
function resolveIncludes<TIncludeKey extends string>(
	includes: MaterialIncludes<TIncludeKey> | undefined
): MaterialIncludes<TIncludeKey> {
	return normalizeIncludes(includes);
}

/**
 * Builds a deterministic texture-config signature map used in material cache signatures.
 *
 * @param textures - Raw texture definitions from material input.
 * @param textureKeys - Sorted texture keys.
 * @returns Compact signature entries describing effective texture config per key.
 */
function buildTextureConfigSignature<TTextureKey extends string>(
	textures: Readonly<TextureDefinitionMap<TTextureKey>>,
	textureKeys: readonly TTextureKey[]
): Record<TTextureKey, string> {
	const signature = {} as Record<TTextureKey, string>;

	for (const key of textureKeys) {
		const normalized = normalizeTextureDefinition(textures[key]);
		signature[key] = [
			normalized.format,
			textures[key]?.format === undefined ? 'auto' : 'explicit',
			normalized.storage ? '1' : '0',
			normalized.colorSpace,
			normalized.flipY ? '1' : '0',
			normalized.generateMipmaps ? '1' : '0',
			normalized.premultipliedAlpha ? '1' : '0',
			normalized.update ?? '',
			normalized.anisotropy,
			normalized.filter,
			normalized.addressModeU,
			normalized.addressModeV,
			normalized.fragmentVisible ? '1' : '0',
			normalized.width ?? '',
			normalized.height ?? ''
		].join(':');
	}

	return signature;
}

function hashArrayBufferViewBytes(view: ArrayBufferView): string {
	const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	let hash = 0x811c9dc5;
	for (const byte of bytes) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

function buildInitialDataSignature(data: StorageBufferDefinition['initialData']): string {
	if (data === undefined) {
		return 'undefined';
	}

	return `${data.constructor.name}:${data.byteLength}:${hashArrayBufferViewBytes(data)}`;
}

type StorageBufferInitialData = NonNullable<StorageBufferDefinition['initialData']>;
const canonicalStorageData = new WeakMap<StorageBufferDefinition, StorageBufferInitialData>();

/** @internal Compare immutable bytes after matching compact material fingerprints. */
export function hasSameStorageBufferInitialData(
	previous: Readonly<StorageBufferDefinitionMap>,
	next: Readonly<StorageBufferDefinitionMap>,
	keys: readonly string[]
): boolean {
	if (previous === next) return true;
	for (const key of keys) {
		const a = previous[key];
		const b = next[key];
		if (a === b) continue;
		const left = a ? (canonicalStorageData.get(a) ?? a.initialData) : undefined;
		const right = b ? (canonicalStorageData.get(b) ?? b.initialData) : undefined;
		if (left === right) continue;
		if (
			!left ||
			!right ||
			left.constructor !== right.constructor ||
			left.byteLength !== right.byteLength
		)
			return false;
		const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
		const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
		for (let index = 0; index < leftBytes.length; index += 1) {
			if (leftBytes[index] !== rightBytes[index]) return false;
		}
	}
	return true;
}

function cloneStorageBufferInitialData(data: StorageBufferInitialData): StorageBufferInitialData {
	return data.slice() as StorageBufferInitialData;
}

/**
 * Creates an immutable storage-buffer descriptor without publishing its canonical bytes.
 *
 * Typed arrays cannot be frozen. The enumerable getter therefore returns a defensive copy
 * for every public read while retaining the canonical clone in this closure.
 */
function cloneStorageBufferDefinition(
	definition: StorageBufferDefinition
): StorageBufferDefinition {
	const cloned: StorageBufferDefinition = {
		size: definition.size,
		type: definition.type,
		...(definition.access !== undefined ? { access: definition.access } : {})
	};

	if (definition.initialData !== undefined) {
		const canonicalInitialData = cloneStorageBufferInitialData(definition.initialData);
		canonicalStorageData.set(cloned, canonicalInitialData);
		Object.defineProperty(cloned, 'initialData', {
			enumerable: true,
			get: () => cloneStorageBufferInitialData(canonicalInitialData)
		});
	}

	return Object.freeze(cloned);
}

function assertStorageTextureDimension(
	name: string,
	field: 'width' | 'height',
	value: unknown
): void {
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value <= 0 ||
		!Number.isInteger(value)
	) {
		throw new Error(
			`Texture "${name}" with storage:true requires an explicit positive integer \`${field}\` field.`
		);
	}
}

function assertStorageTextureDefinition(name: string, definition: TextureDefinition): void {
	if (!definition.format) {
		throw new Error(`Texture "${name}" with storage:true requires a \`format\` field.`);
	}

	assertStorageTextureFormat(name, definition.format);
	assertStorageTextureDimension(name, 'width', definition.width);
	assertStorageTextureDimension(name, 'height', definition.height);

	if (definition.source !== undefined) {
		throw new Error(
			`Texture "${name}" with storage:true is compute-managed and must not define a \`source\` field.`
		);
	}
}

/**
 * Creates a stable WGSL define block from the provided map.
 *
 * @param defines - Optional material defines.
 * @returns Joined WGSL const declarations ordered by key.
 */
export function buildDefinesBlock(defines: MaterialDefines | undefined): string {
	const normalizedDefines = normalizeDefines(defines);
	if (Object.keys(normalizedDefines).length === 0) {
		return '';
	}

	return Object.entries(normalizedDefines)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => {
			assertUniformName(key);
			return toDefineLine(key, value);
		})
		.join('\n');
}

/**
 * Prepends resolved defines to a fragment shader.
 *
 * @param fragment - Raw WGSL fragment source.
 * @param defines - Optional define map.
 * @returns Fragment source with a leading define block when defines are present.
 */
export function applyMaterialDefines(
	fragment: string,
	defines: MaterialDefines | undefined
): string {
	const defineBlock = buildDefinesBlock(defines);
	if (defineBlock.length === 0) {
		return fragment;
	}

	return `${defineBlock}\n\n${fragment}`;
}

/**
 * Creates an immutable material object with validated shader/uniform/texture contracts.
 *
 * @param input - User material declaration.
 * @returns Frozen material object safe to share and cache.
 */
export function defineMaterial<
	TUniformKey extends string = string,
	TTextureKey extends string = string,
	TDefineKey extends string = string,
	TIncludeKey extends string = string,
	TStorageBufferKey extends string = string
>(
	input: FragMaterialInput<TUniformKey, TTextureKey, TDefineKey, TIncludeKey, TStorageBufferKey>
): FragMaterial<TUniformKey, TTextureKey, TDefineKey, TIncludeKey, TStorageBufferKey> {
	const fragment = resolveFragment(input.fragment);
	const uniforms = Object.freeze(resolveUniforms(input.uniforms));
	const textures = Object.freeze(resolveTextures(input.textures));
	const defines = Object.freeze(resolveDefines(input.defines));
	const includes = Object.freeze(resolveIncludes(input.includes));
	const source = Object.freeze(resolveSourceMetadata(undefined));

	// Validate and freeze storage buffers
	const rawStorageBuffers =
		input.storageBuffers ?? ({} as StorageBufferDefinitionMap<TStorageBufferKey>);
	for (const [name, definition] of Object.entries(rawStorageBuffers) as Array<
		[string, StorageBufferDefinition]
	>) {
		assertStorageBufferDefinition(name, definition);
	}
	const storageBuffers = Object.freeze(
		Object.fromEntries(
			Object.entries(rawStorageBuffers).map(([name, definition]) => {
				return [name, cloneStorageBufferDefinition(definition as StorageBufferDefinition)];
			})
		)
	) as Readonly<StorageBufferDefinitionMap<TStorageBufferKey>>;

	// Validate storage textures
	for (const [name, definition] of Object.entries(textures) as Array<[string, TextureDefinition]>) {
		if (definition?.storage) {
			assertStorageTextureDefinition(name, definition);
		}
	}

	const preprocessed = preprocessMaterialFragment({
		fragment,
		defines,
		includes
	});

	const material: FragMaterial<
		TUniformKey,
		TTextureKey,
		TDefineKey,
		TIncludeKey,
		TStorageBufferKey
	> = Object.freeze({
		fragment,
		uniforms,
		textures,
		defines,
		includes,
		storageBuffers
	});

	preprocessedFragmentCache.set(material, preprocessed);
	materialSourceMetadataCache.set(material, source);
	return material;
}

/**
 * Resolves a material to renderer-ready data and a deterministic signature.
 *
 * @param material - Material input created via {@link defineMaterial}.
 * @returns Resolved material with packed uniform layout, sorted texture keys and cache signature.
 */
export function resolveMaterial<
	TUniformKey extends string = string,
	TTextureKey extends string = string,
	TDefineKey extends string = string,
	TIncludeKey extends string = string,
	TStorageBufferKey extends string = string
>(
	material: FragMaterial<TUniformKey, TTextureKey, TDefineKey, TIncludeKey, TStorageBufferKey>
): ResolvedMaterial<TUniformKey, TTextureKey, TIncludeKey, TStorageBufferKey> {
	const cached = getCachedResolvedMaterial(material);
	if (cached) {
		return cached;
	}

	assertDefinedMaterial(material);

	const uniforms = material.uniforms as UniformMap<TUniformKey>;
	const textures = material.textures as TextureDefinitionMap<TTextureKey>;
	const uniformLayout = resolveUniformLayout(uniforms);
	const textureKeys = Object.freeze(Object.keys(textures).sort() as TTextureKey[]);
	const preprocessed =
		preprocessedFragmentCache.get(material) ??
		preprocessMaterialFragment({
			fragment: material.fragment,
			defines: material.defines,
			includes: material.includes
		});
	const fragmentWgsl = preprocessed.fragment;
	const textureConfig = buildTextureConfigSignature(textures, textureKeys);

	const storageBufferKeys = Object.freeze(
		Object.keys(material.storageBuffers ?? {}).sort() as TStorageBufferKey[]
	);
	const storageTextureKeys = Object.freeze(
		textureKeys.filter((key) => (textures[key] as TextureDefinition)?.storage === true)
	);

	const signature = JSON.stringify({
		fragmentWgsl,
		uniforms: uniformLayout.entries.map((entry) => `${entry.name}:${entry.type}`),
		textureKeys,
		textureConfig,
		storageBufferKeys: storageBufferKeys.map((key) => {
			const def = (material.storageBuffers as StorageBufferDefinitionMap)[key];
			return `${key}:${def?.type ?? '?'}:${def?.size ?? 0}:${def?.access ?? 'read-write'}:${buildInitialDataSignature(def?.initialData)}`;
		}),
		storageTextureKeys
	});

	const resolved: ResolvedMaterial<TUniformKey, TTextureKey, TIncludeKey, TStorageBufferKey> =
		Object.freeze({
			fragmentWgsl,
			fragmentLineMap: preprocessed.lineMap,
			uniforms,
			textures,
			uniformLayout,
			textureKeys,
			signature,
			fragmentSource: material.fragment,
			includeSources: material.includes as MaterialIncludes<TIncludeKey>,
			defineBlockSource: preprocessed.defineBlockSource,
			source: materialSourceMetadataCache.get(material) ?? null,
			storageBufferKeys,
			storageTextureKeys
		});

	resolvedMaterialCache.set(material, resolved);
	return resolved;
}
