import {
	getShaderCompilationDiagnostics,
	type ShaderCompilationDiagnostic
} from './error-diagnostics.js';
import { formatShaderSourceLocation } from './shader.js';

/**
 * Runtime phase in which an error occurred.
 */
export type SpektralErrorPhase = 'initialization' | 'render';

/**
 * Stable machine-readable error category code.
 */
export type SpektralErrorCode =
	| 'WEBGPU_UNAVAILABLE'
	| 'WEBGPU_ADAPTER_UNAVAILABLE'
	| 'WEBGPU_CONTEXT_UNAVAILABLE'
	| 'WGSL_COMPILATION_FAILED'
	| 'MATERIAL_PREPROCESS_FAILED'
	| 'WEBGPU_DEVICE_LOST'
	| 'WEBGPU_UNCAPTURED_ERROR'
	| 'BIND_GROUP_MISMATCH'
	| 'RUNTIME_RESOURCE_MISSING'
	| 'RESOURCE_REGISTRY_DUPLICATE'
	| 'RESOURCE_REGISTRY_TEXTURE_MISSING'
	| 'RESOURCE_REGISTRY_STORAGE_BUFFER_MISSING'
	| 'UNIFORM_VALUE_INVALID'
	| 'STORAGE_BUFFER_OUT_OF_BOUNDS'
	| 'STORAGE_BUFFER_READ_FAILED'
	| 'RENDER_GRAPH_INVALID'
	| 'PINGPONG_CONFIGURATION_INVALID'
	| 'TEXTURE_USAGE_INVALID'
	| 'FORMAT_CAPABILITY_MISSING'
	| 'TEXTURE_REQUEST_FAILED'
	| 'TEXTURE_DECODE_UNAVAILABLE'
	| 'TEXTURE_REQUEST_ABORTED'
	| 'COMPUTE_COMPILATION_FAILED'
	| 'COMPUTE_CONTRACT_INVALID'
	| 'COMPUTE_RESOURCE_DESCRIPTOR_INVALID'
	| 'COMPUTE_RESOURCE_UNKNOWN'
	| 'COMPUTE_RESOURCE_INCOMPATIBLE'
	| 'COMPUTE_RESOURCE_ALIAS_COLLISION'
	| 'COMPUTE_RESOURCE_HAZARD'
	| 'COMPUTE_GRAPH_MULTIPLE_WRITERS'
	| 'COMPUTE_GRAPH_CYCLE'
	| 'COMPUTE_RESOURCE_LIMIT_EXCEEDED'
	| 'COMPUTE_EXTERNAL_RESOURCE_INVALID'
	| 'SPEKTRAL_RUNTIME_ERROR';

/**
 * Severity level for user-facing diagnostics.
 */
export type SpektralErrorSeverity = 'error' | 'fatal';

/**
 * One source-code line displayed in diagnostics snippet.
 */
export interface SpektralErrorSourceLine {
	readonly number: number;
	readonly code: string;
	readonly highlight: boolean;
}

/**
 * Structured source context displayed for shader compilation errors.
 */
export interface SpektralErrorSource {
	readonly component: string;
	readonly location: string;
	readonly line: number;
	readonly column?: number;
	readonly snippet: readonly SpektralErrorSourceLine[];
}

export type SpektralShaderErrorSourceKind = 'user' | 'wrapper';

/** Compact shader/pass metadata suitable for framework-neutral diagnostics UIs. */
export interface SpektralShaderErrorMetadata {
	readonly passKind?: string;
	readonly passLabel?: string;
	readonly stage: 'fragment' | 'compute';
	readonly inputFormat?: GPUTextureFormat;
	readonly outputFormat?: GPUTextureFormat;
	readonly sourceKind: SpektralShaderErrorSourceKind;
	readonly line?: number;
	readonly column?: number;
}

/**
 * Optional runtime context captured with diagnostics payload.
 */
export interface SpektralErrorContext {
	readonly materialSignature?: string;
	readonly passGraph?: {
		readonly passCount: number;
		readonly enabledPassCount: number;
		readonly inputs: readonly string[];
		readonly outputs: readonly string[];
	};
	readonly activeRenderTargets: readonly string[];
}

/**
 * Structured error payload used by UI diagnostics.
 */
export interface SpektralErrorReport {
	/**
	 * Stable machine-readable category code.
	 */
	readonly code: SpektralErrorCode;
	/**
	 * Severity level used by diagnostics UIs and telemetry.
	 */
	readonly severity: SpektralErrorSeverity;
	/**
	 * Whether runtime may recover without full renderer re-creation.
	 */
	readonly recoverable: boolean;
	/**
	 * Short category title.
	 */
	readonly title: string;
	/**
	 * Primary human-readable message.
	 */
	readonly message: string;
	/**
	 * Suggested remediation hint.
	 */
	readonly hint: string;
	/**
	 * Additional parsed details (for example WGSL line errors).
	 */
	readonly details: readonly string[];
	/**
	 * Stack trace lines when available.
	 */
	readonly stack: readonly string[];
	/**
	 * Original unmodified message.
	 */
	readonly rawMessage: string;
	/**
	 * Runtime phase where the error occurred.
	 */
	readonly phase: SpektralErrorPhase;
	/**
	 * Optional source context for shader-related diagnostics.
	 */
	readonly source: SpektralErrorSource | null;
	/**
	 * Optional runtime context snapshot (material/pass graph/render targets).
	 */
	readonly context: SpektralErrorContext | null;
	/** Optional shader/pass metadata without generated wrapper source disclosure. */
	readonly shader: SpektralShaderErrorMetadata | null;
}

type SpektralClassifiedError = Error & {
	spektralCode?: SpektralErrorCode;
	spektralContext?: SpektralErrorContext;
};

/** Creates an error carrying a stable Spektral diagnostic code. */
export function createSpektralError(
	code: SpektralErrorCode,
	message: string,
	options?: ErrorOptions
): Error {
	const error = new Error(message, options) as SpektralClassifiedError;
	error.spektralCode = code;
	return error;
}

/** Attaches renderer context without replacing a more specific error or stack. */
export function attachSpektralErrorContext(error: unknown, context: SpektralErrorContext): Error {
	const normalized = (
		error instanceof Error
			? error
			: new Error(typeof error === 'string' ? error : 'Unknown FragCanvas error')
	) as SpektralClassifiedError;
	if (normalized.spektralContext === undefined) {
		normalized.spektralContext = context;
	}
	return normalized;
}

function classifyErrorCode(
	code: SpektralErrorCode
): Pick<SpektralErrorReport, 'code' | 'severity' | 'recoverable' | 'title' | 'hint'> | null {
	const common = { code, severity: 'error' as const, recoverable: true };
	switch (code) {
		case 'COMPUTE_RESOURCE_DESCRIPTOR_INVALID':
			return {
				...common,
				title: 'Compute resource descriptor is invalid',
				hint: 'Check the descriptor discriminant, access mode, resource metadata and view range.'
			};
		case 'COMPUTE_RESOURCE_UNKNOWN':
			return {
				...common,
				title: 'Compute resource is unknown',
				hint: 'Declare the referenced texture, sampler or storage buffer on the active material.'
			};
		case 'COMPUTE_RESOURCE_INCOMPATIBLE':
			return {
				...common,
				title: 'Compute resource is incompatible',
				hint: 'Match access, usage flags, texture format, sample type and buffer access to the shader.'
			};
		case 'COMPUTE_RESOURCE_ALIAS_COLLISION':
			return {
				...common,
				title: 'Compute resource alias is invalid',
				hint: 'Use a unique WGSL identifier that is not reserved by Spektral.'
			};
		case 'COMPUTE_RESOURCE_HAZARD':
			return {
				...common,
				title: 'Compute dispatch has a resource hazard',
				hint: 'Do not bind overlapping writable and readable subresources in one dispatch.'
			};
		case 'COMPUTE_GRAPH_MULTIPLE_WRITERS':
			return {
				...common,
				title: 'Compute graph has multiple writers',
				hint: 'Choose one writer for each logical resource inside a compute graph segment.'
			};
		case 'COMPUTE_GRAPH_CYCLE':
			return {
				...common,
				title: 'Compute dependency cycle detected',
				hint: 'Break the cycle or mark a read as version "initial" when it needs pre-frame data.'
			};
		case 'COMPUTE_RESOURCE_LIMIT_EXCEEDED':
			return {
				...common,
				title: 'Compute resources exceed device limits',
				hint: 'Reduce bindings per pass or split the work into multiple compute passes.'
			};
		case 'COMPUTE_EXTERNAL_RESOURCE_INVALID':
			return {
				...common,
				title: 'External compute resource is stale or incompatible',
				hint: 'Return a live resource from the current device and keep resourceId, format, usage and size metadata accurate.'
			};
		case 'FORMAT_CAPABILITY_MISSING':
			return {
				...common,
				title: 'Texture format capability is missing',
				hint: 'Use a compatible format, select a custom typed pass, or enable the required GPU device feature.'
			};
		case 'RESOURCE_REGISTRY_DUPLICATE':
			return {
				...common,
				title: 'Material resource is already registered',
				hint: 'Register each logical material texture or storage buffer key only once.'
			};
		case 'RESOURCE_REGISTRY_TEXTURE_MISSING':
			return {
				...common,
				title: 'Material texture resource is missing',
				hint: 'Declare the texture on the active material before resolving or publishing it.'
			};
		case 'RESOURCE_REGISTRY_STORAGE_BUFFER_MISSING':
			return {
				...common,
				title: 'Material storage buffer resource is missing',
				hint: 'Declare the storage buffer on the active material before resolving or updating it.'
			};
		default:
			return null;
	}
}

/**
 * Splits multi-line values into trimmed non-empty lines.
 */
function splitLines(value: string): string[] {
	return value
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function toDisplayName(path: string): string {
	const normalized = path.split(/[?#]/)[0] ?? path;
	const chunks = normalized.split(/[\\/]/);
	const last = chunks[chunks.length - 1];
	return last && last.length > 0 ? last : path;
}

function toSnippet(source: string, line: number, radius = 3): SpektralErrorSourceLine[] {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	if (lines.length === 0) {
		return [];
	}

	const targetLine = Math.min(Math.max(1, line), lines.length);
	const start = Math.max(1, targetLine - radius);
	const end = Math.min(lines.length, targetLine + radius);
	const snippet: SpektralErrorSourceLine[] = [];

	for (let index = start; index <= end; index += 1) {
		snippet.push({
			number: index,
			code: lines[index - 1] ?? '',
			highlight: index === targetLine
		});
	}

	return snippet;
}

function buildSourceFromDiagnostics(error: unknown): SpektralErrorSource | null {
	const diagnostics = getShaderCompilationDiagnostics(error);
	if (!diagnostics || diagnostics.diagnostics.length === 0) {
		return null;
	}

	const primary = diagnostics.diagnostics[0];
	if (!primary?.sourceLocation) {
		return null;
	}

	const location = primary.sourceLocation;
	const column = primary.linePos && primary.linePos > 0 ? primary.linePos : undefined;
	if (location.kind === 'wrapper') {
		return null;
	}

	if (location.kind === 'fragment') {
		const component =
			diagnostics.materialSource?.component ??
			(diagnostics.materialSource?.file
				? toDisplayName(diagnostics.materialSource.file)
				: 'User shader fragment');
		const locationLabel = formatShaderSourceLocation(location) ?? `fragment line ${location.line}`;
		return {
			component,
			location: `${component} (${locationLabel})`,
			line: location.line,
			...(column !== undefined ? { column } : {}),
			snippet: toSnippet(diagnostics.fragmentSource, location.line)
		};
	}

	if (location.kind === 'include') {
		const includeName = location.include ?? 'unknown';
		const includeSource = diagnostics.includeSources[includeName] ?? '';
		const component = `#include <${includeName}>`;
		const locationLabel = formatShaderSourceLocation(location) ?? `include <${includeName}>`;
		return {
			component,
			location: `${component} (${locationLabel})`,
			line: location.line,
			...(column !== undefined ? { column } : {}),
			snippet: toSnippet(includeSource, location.line)
		};
	}

	if (location.kind === 'compute') {
		const computeSource = diagnostics.computeSource ?? diagnostics.fragmentSource;
		const component = 'Compute shader';
		const locationLabel = formatShaderSourceLocation(location) ?? `compute line ${location.line}`;
		return {
			component,
			location: `${component} (${locationLabel})`,
			line: location.line,
			...(column !== undefined ? { column } : {}),
			snippet: toSnippet(computeSource, location.line)
		};
	}

	const defineName = location.define ?? 'unknown';
	const defineLine = Math.max(1, location.line);
	const component = `#define ${defineName}`;
	const locationLabel =
		formatShaderSourceLocation(location) ?? `define "${defineName}" line ${defineLine}`;
	return {
		component,
		location: `${component} (${locationLabel})`,
		line: defineLine,
		...(column !== undefined ? { column } : {}),
		snippet: toSnippet(diagnostics.defineBlockSource ?? '', defineLine, 2)
	};
}

function buildShaderMetadata(error: unknown): SpektralShaderErrorMetadata | null {
	const diagnostics = getShaderCompilationDiagnostics(error);
	const primary = diagnostics?.diagnostics[0];
	if (!diagnostics || !primary) return null;
	const location = primary.sourceLocation;
	const sourceKind: SpektralShaderErrorSourceKind =
		location === null || location.kind === 'wrapper' ? 'wrapper' : 'user';
	const line =
		sourceKind === 'user'
			? location?.line
			: primary.generatedLine > 0
				? primary.generatedLine
				: undefined;
	const column = primary.linePos && primary.linePos > 0 ? primary.linePos : undefined;
	return {
		...(diagnostics.pipeline?.passKind !== undefined
			? { passKind: diagnostics.pipeline.passKind }
			: {}),
		...(diagnostics.pipeline?.passLabel !== undefined
			? { passLabel: diagnostics.pipeline.passLabel }
			: {}),
		stage: diagnostics.shaderStage ?? (location?.kind === 'compute' ? 'compute' : 'fragment'),
		...(diagnostics.pipeline?.inputFormat !== undefined
			? { inputFormat: diagnostics.pipeline.inputFormat }
			: {}),
		...(diagnostics.pipeline?.outputFormat !== undefined
			? { outputFormat: diagnostics.pipeline.outputFormat }
			: {}),
		sourceKind,
		...(line !== undefined ? { line } : {}),
		...(column !== undefined ? { column } : {})
	};
}

function formatDiagnosticMessage(entry: ShaderCompilationDiagnostic): string {
	const sourceLabel = formatShaderSourceLocation(entry.sourceLocation);
	const generatedLineLabel =
		entry.generatedLine > 0 ? `generated WGSL line ${entry.generatedLine}` : null;
	const labels = [sourceLabel, generatedLineLabel].filter((value) => Boolean(value));
	if (labels.length === 0) {
		return entry.message;
	}

	return `[${labels.join(' | ')}] ${entry.message}`;
}

/**
 * Maps known WebGPU/WGSL error patterns to a user-facing title and hint.
 */
function classifyErrorMessage(
	message: string
): Pick<SpektralErrorReport, 'code' | 'severity' | 'recoverable' | 'title' | 'hint'> {
	if (message.includes('WebGPU is not available in this browser')) {
		return {
			code: 'WEBGPU_UNAVAILABLE',
			severity: 'fatal',
			recoverable: false,
			title: 'WebGPU unavailable',
			hint: 'Use a browser with WebGPU enabled (latest Chrome/Edge/Safari TP) and secure context.'
		};
	}

	if (message.includes('Unable to acquire WebGPU adapter')) {
		return {
			code: 'WEBGPU_ADAPTER_UNAVAILABLE',
			severity: 'fatal',
			recoverable: false,
			title: 'WebGPU adapter unavailable',
			hint: 'GPU adapter request failed. Check browser permissions, flags and device support.'
		};
	}

	if (message.includes('Canvas does not support webgpu context')) {
		return {
			code: 'WEBGPU_CONTEXT_UNAVAILABLE',
			severity: 'error',
			recoverable: true,
			title: 'Canvas cannot create WebGPU context',
			hint: 'Make sure this canvas is attached to DOM and not using an unsupported context option.'
		};
	}

	if (message.includes('WGSL compilation failed')) {
		return {
			code: 'WGSL_COMPILATION_FAILED',
			severity: 'error',
			recoverable: true,
			title: 'WGSL compilation failed',
			hint: 'Check WGSL line numbers below and verify struct/binding/function signatures.'
		};
	}

	if (
		message.includes('Invalid include directive in fragment shader.') ||
		message.includes('Unknown include "') ||
		message.includes('Circular include detected for "') ||
		message.includes('Invalid define value for "') ||
		message.includes('Invalid include "')
	) {
		return {
			code: 'MATERIAL_PREPROCESS_FAILED',
			severity: 'error',
			recoverable: true,
			title: 'Material preprocess failed',
			hint: 'Validate #include keys, define values and include expansion order before retrying.'
		};
	}

	if (message.includes('Compute shader compilation failed')) {
		return {
			code: 'COMPUTE_COMPILATION_FAILED',
			severity: 'error',
			recoverable: true,
			title: 'Compute shader compilation failed',
			hint: 'Check WGSL compute shader sources below and verify storage bindings.'
		};
	}

	if (
		message.includes(
			'Compute shader must declare `@compute @workgroup_size(...) fn compute(...)`.'
		) ||
		message.includes('Compute shader must include a `@builtin(global_invocation_id)` parameter.') ||
		message.includes('Could not extract @workgroup_size from compute shader source.') ||
		message.includes('@workgroup_size dimensions must be integers in range') ||
		message.includes('Unsupported storage buffer access mode "')
	) {
		return {
			code: 'COMPUTE_CONTRACT_INVALID',
			severity: 'error',
			recoverable: true,
			title: 'Compute contract is invalid',
			hint: 'Ensure compute shader contract (@compute, @workgroup_size, global_invocation_id, storage access) is valid.'
		};
	}

	if (message.includes('WebGPU device lost') || message.includes('Device Lost')) {
		return {
			code: 'WEBGPU_DEVICE_LOST',
			severity: 'fatal',
			recoverable: false,
			title: 'WebGPU device lost',
			hint: 'GPU device/context was lost. Recreate the renderer and check OS/GPU stability.'
		};
	}

	if (
		message.includes('Dispatch workgroup count') &&
		message.includes('max compute workgroups per dimension')
	) {
		return {
			code: 'WEBGPU_UNCAPTURED_ERROR',
			severity: 'error',
			recoverable: true,
			title: 'Compute dispatch exceeds device limit',
			hint: 'Reduce dispatch counts or split compute work into multiple dispatches/chunks.'
		};
	}

	if (
		message.includes('maximum storage buffer binding size') ||
		message.includes('maxStorageBufferBindingSize')
	) {
		return {
			code: 'WEBGPU_UNCAPTURED_ERROR',
			severity: 'error',
			recoverable: true,
			title: 'Storage buffer exceeds binding limit',
			hint: 'Keep each storage buffer binding below adapter limits or shard data across multiple buffers.'
		};
	}

	if (message.includes('WebGPU uncaptured error')) {
		return {
			code: 'WEBGPU_UNCAPTURED_ERROR',
			severity: 'error',
			recoverable: true,
			title: 'WebGPU uncaptured error',
			hint: 'A GPU command failed asynchronously. Review details and validate resource/state usage.'
		};
	}

	if (message.includes('CreateBindGroup') || message.includes('bind group layout')) {
		return {
			code: 'BIND_GROUP_MISMATCH',
			severity: 'error',
			recoverable: true,
			title: 'Bind group mismatch',
			hint: 'Bindings in shader and runtime resources are out of sync. Verify uniforms/textures layout.'
		};
	}

	if (message.includes('Storage buffer "') && message.includes('write out of bounds:')) {
		return {
			code: 'STORAGE_BUFFER_OUT_OF_BOUNDS',
			severity: 'error',
			recoverable: true,
			title: 'Storage buffer write out of bounds',
			hint: 'Ensure offset + write byte length does not exceed declared storage buffer size.'
		};
	}

	if (
		message.includes('Cannot read storage buffer "') ||
		message.includes('Cannot read storage buffer: GPU device unavailable.') ||
		message.includes('not allocated on GPU.')
	) {
		return {
			code: 'STORAGE_BUFFER_READ_FAILED',
			severity: 'error',
			recoverable: true,
			title: 'Storage buffer read failed',
			hint: 'Readbacks require an initialized renderer, allocated GPU buffer and active device.'
		};
	}

	if (
		message.includes('Unknown uniform "') ||
		message.includes('Unknown uniform type for "') ||
		message.includes('Unknown texture "') ||
		message.includes('Unknown storage buffer "') ||
		message.includes('Missing definition for storage buffer "') ||
		message.includes('Missing texture definition for "') ||
		(message.includes('Storage buffer "') && message.includes('" not allocated.')) ||
		(message.includes('Storage texture "') && message.includes('" not allocated.'))
	) {
		return {
			code: 'RUNTIME_RESOURCE_MISSING',
			severity: 'error',
			recoverable: true,
			title: 'Runtime resource binding failed',
			hint: 'Check material declarations and runtime keys for uniforms, textures and storage resources.'
		};
	}

	if (message.includes('Uniform ') && message.includes(' value must')) {
		return {
			code: 'UNIFORM_VALUE_INVALID',
			severity: 'error',
			recoverable: true,
			title: 'Uniform value is invalid',
			hint: 'Provide finite values with tuple/matrix sizes matching the uniform type.'
		};
	}

	if (
		message.includes('Render pass #') ||
		message.includes('Render graph references unknown runtime target')
	) {
		return {
			code: 'RENDER_GRAPH_INVALID',
			severity: 'error',
			recoverable: true,
			title: 'Render graph configuration is invalid',
			hint: 'Verify pass inputs/outputs, declared render targets and execution order.'
		};
	}

	if (message.includes('PingPongShaderPass')) {
		return {
			code: 'PINGPONG_CONFIGURATION_INVALID',
			severity: 'error',
			recoverable: true,
			title: 'Ping-pong shader pass is misconfigured',
			hint: 'Verify PingPongShaderPass target texture, dimensions, iterations, format and fragment contract.'
		};
	}

	if (message.includes('PingPongComputePass')) {
		return {
			code: 'PINGPONG_CONFIGURATION_INVALID',
			severity: 'error',
			recoverable: true,
			title: 'Ping-pong compute pass is misconfigured',
			hint: 'Configure a valid target texture key for PingPongComputePass.'
		};
	}

	if (message.includes('Destination texture needs to have CopyDst')) {
		return {
			code: 'TEXTURE_USAGE_INVALID',
			severity: 'error',
			recoverable: true,
			title: 'Invalid texture usage flags',
			hint: 'Texture used as upload destination must include CopyDst (and often RenderAttachment).'
		};
	}

	if (message.includes('Texture request failed')) {
		return {
			code: 'TEXTURE_REQUEST_FAILED',
			severity: 'error',
			recoverable: true,
			title: 'Texture request failed',
			hint: 'Verify texture URL, CORS policy and response status before retrying.'
		};
	}

	if (message.includes('createImageBitmap is not available in this runtime')) {
		return {
			code: 'TEXTURE_DECODE_UNAVAILABLE',
			severity: 'fatal',
			recoverable: false,
			title: 'Texture decode unavailable',
			hint: 'Runtime lacks createImageBitmap support. Use a browser/runtime with image bitmap decoding.'
		};
	}

	if (message.toLowerCase().includes('texture request was aborted')) {
		return {
			code: 'TEXTURE_REQUEST_ABORTED',
			severity: 'error',
			recoverable: true,
			title: 'Texture request aborted',
			hint: 'Texture load was cancelled. Retry the request when source inputs stabilize.'
		};
	}

	return {
		code: 'SPEKTRAL_RUNTIME_ERROR',
		severity: 'error',
		recoverable: true,
		title: 'Spektral render error',
		hint: 'Review technical details below. If issue persists, isolate shader/uniform/texture changes.'
	};
}

function cloneAndFreezeSource(source: SpektralErrorSource | null): SpektralErrorSource | null {
	if (!source) {
		return null;
	}

	const snippet = Object.freeze(
		source.snippet.map((line) =>
			Object.freeze({
				number: line.number,
				code: line.code,
				highlight: line.highlight
			})
		)
	);
	return Object.freeze({
		component: source.component,
		location: source.location,
		line: source.line,
		...(source.column !== undefined ? { column: source.column } : {}),
		snippet
	});
}

function cloneAndFreezeContext(context: SpektralErrorContext | null): SpektralErrorContext | null {
	if (!context) {
		return null;
	}

	const passGraph = context.passGraph
		? Object.freeze({
				passCount: context.passGraph.passCount,
				enabledPassCount: context.passGraph.enabledPassCount,
				inputs: Object.freeze([...context.passGraph.inputs]),
				outputs: Object.freeze([...context.passGraph.outputs])
			})
		: undefined;
	return Object.freeze({
		...(context.materialSignature !== undefined
			? { materialSignature: context.materialSignature }
			: {}),
		...(passGraph ? { passGraph } : {}),
		activeRenderTargets: Object.freeze([...context.activeRenderTargets])
	});
}

function cloneAndFreezeShader(
	shader: SpektralShaderErrorMetadata | null
): SpektralShaderErrorMetadata | null {
	if (!shader) return null;
	return Object.freeze({
		...(shader.passKind !== undefined ? { passKind: shader.passKind } : {}),
		...(shader.passLabel !== undefined ? { passLabel: shader.passLabel } : {}),
		stage: shader.stage,
		...(shader.inputFormat !== undefined ? { inputFormat: shader.inputFormat } : {}),
		...(shader.outputFormat !== undefined ? { outputFormat: shader.outputFormat } : {}),
		sourceKind: shader.sourceKind,
		...(shader.line !== undefined ? { line: shader.line } : {}),
		...(shader.column !== undefined ? { column: shader.column } : {})
	});
}

/**
 * Converts unknown errors to a consistent, display-ready error report.
 *
 * @param error - Unknown thrown value.
 * @param phase - Phase during which error occurred.
 * @returns Normalized error report.
 */
export function toSpektralErrorReport(
	error: unknown,
	phase: SpektralErrorPhase
): SpektralErrorReport {
	const shaderDiagnostics = getShaderCompilationDiagnostics(error);
	const rawMessage =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: 'Unknown FragCanvas error';
	const rawLines = splitLines(rawMessage);
	const defaultMessage = rawLines[0] ?? rawMessage;
	const defaultDetails = rawLines.slice(1);
	const source = buildSourceFromDiagnostics(error);
	const shader = buildShaderMetadata(error);
	const classifiedError = error instanceof Error ? (error as SpektralClassifiedError) : null;
	const context = classifiedError?.spektralContext ?? shaderDiagnostics?.runtimeContext ?? null;
	const message =
		shaderDiagnostics && shaderDiagnostics.diagnostics[0]
			? formatDiagnosticMessage(shaderDiagnostics.diagnostics[0])
			: defaultMessage;
	const details = shaderDiagnostics
		? shaderDiagnostics.diagnostics.slice(1).map((entry) => formatDiagnosticMessage(entry))
		: defaultDetails;
	const stack =
		error instanceof Error && error.stack
			? splitLines(error.stack).filter((line) => line !== message)
			: [];
	let classification =
		(classifiedError?.spektralCode ? classifyErrorCode(classifiedError.spektralCode) : null) ??
		(classifiedError?.spektralCode
			? { ...classifyErrorMessage(rawMessage), code: classifiedError.spektralCode }
			: classifyErrorMessage(rawMessage));
	if (
		shaderDiagnostics?.shaderStage === 'compute' &&
		classification.code === 'WGSL_COMPILATION_FAILED'
	) {
		classification = {
			code: 'COMPUTE_COMPILATION_FAILED',
			severity: 'error',
			recoverable: true,
			title: 'Compute shader compilation failed',
			hint: 'Check WGSL compute shader sources below and verify storage bindings.'
		};
	}

	return Object.freeze({
		code: classification.code,
		severity: classification.severity,
		recoverable: classification.recoverable,
		title: classification.title,
		message,
		hint: classification.hint,
		details: Object.freeze([...details]),
		stack: Object.freeze([...stack]),
		rawMessage,
		phase,
		source: cloneAndFreezeSource(source),
		context: cloneAndFreezeContext(context),
		shader: cloneAndFreezeShader(shader)
	});
}
