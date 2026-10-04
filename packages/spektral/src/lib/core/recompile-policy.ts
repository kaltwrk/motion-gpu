import type { ColorPipelineOptions } from './types.js';

/**
 * Inputs that affect renderer pipeline compilation.
 */
export interface RendererPipelineSignatureInput {
	/**
	 * Material pipeline signature (fragment preprocess + uniform/texture layout).
	 */
	materialSignature: string;
	/**
	 * Color pipeline and HDR presentation options.
	 */
	color?: ColorPipelineOptions;
	/**
	 * Adapter request options that affect the selected WebGPU adapter.
	 */
	adapterOptions?: GPURequestAdapterOptions;
	/**
	 * Device descriptor that affects the requested GPUDevice.
	 */
	deviceDescriptor?: GPUDeviceDescriptor;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function stableSignatureValue(value: unknown): unknown {
	if (value === undefined) {
		return undefined;
	}
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		return Number.isNaN(value) ? 'NaN' : value;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => stableSignatureValue(entry));
	}
	if (value instanceof Set) {
		return Array.from(value)
			.map((entry) => stableSignatureValue(entry))
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	}
	if (!isPlainRecord(value)) {
		return String(value);
	}

	const normalized: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
		const next = stableSignatureValue(value[key]);
		if (next !== undefined) {
			normalized[key] = next;
		}
	}
	return normalized;
}

function normalizeRequiredFeatures(
	features: GPUDeviceDescriptor['requiredFeatures']
): string[] | undefined {
	if (features === undefined) {
		return undefined;
	}

	return Array.from(features)
		.map((feature) => String(feature))
		.sort((a, b) => a.localeCompare(b));
}

function normalizeAdapterOptions(options: GPURequestAdapterOptions | undefined): unknown {
	return stableSignatureValue(options ?? {});
}

function normalizeDeviceDescriptor(descriptor: GPUDeviceDescriptor | undefined): unknown {
	if (!descriptor) {
		return {};
	}

	const normalized: Record<string, unknown> = {};
	const source = descriptor as Record<string, unknown>;
	for (const key of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
		if (key === 'requiredFeatures') {
			continue;
		}
		const next = stableSignatureValue(source[key]);
		if (next !== undefined) {
			normalized[key] = next;
		}
	}

	const requiredFeatures = normalizeRequiredFeatures(descriptor.requiredFeatures);
	if (requiredFeatures !== undefined) {
		normalized.requiredFeatures = requiredFeatures;
	}

	return normalized;
}

/**
 * Returns deterministic renderer pipeline signature.
 *
 * Rebuild triggers:
 * - material signature changes (shader/layout related)
 * - color pipeline, output encoding, or HDR presentation options change
 * - adapter request options or device descriptor changes
 *
 * Non-triggers:
 * - runtime uniform values
 * - runtime texture sources
 * - clear color changes
 */
export function buildRendererPipelineSignature(input: RendererPipelineSignatureInput): string {
	return JSON.stringify({
		materialSignature: input.materialSignature,
		color: stableSignatureValue(input.color ?? {}),
		adapterOptions: normalizeAdapterOptions(input.adapterOptions),
		deviceDescriptor: normalizeDeviceDescriptor(input.deviceDescriptor)
	});
}

/** Per-runtime signature cache; mutable options are still normalized on every check. */
export function createRendererPipelineSignatureResolver(): (
	input: RendererPipelineSignatureInput,
	storageRevision: number
) => string {
	let material: string | undefined;
	let configuration: string | undefined;
	let revision = -1;
	let signature = '';
	return (input, storageRevision) => {
		const nextConfiguration = buildRendererPipelineSignature({ ...input, materialSignature: '' });
		if (
			material !== input.materialSignature ||
			configuration !== nextConfiguration ||
			revision !== storageRevision
		) {
			material = input.materialSignature;
			configuration = nextConfiguration;
			revision = storageRevision;
			signature = JSON.stringify({ materialSignature: material, configuration, storageRevision });
		}
		return signature;
	};
}
