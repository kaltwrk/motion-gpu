import type { ComputeResourceResolverLimits } from '../compute-resources.js';
import { assertTextureDimensionsWithinLimit, assertTextureFormat } from '../textures.js';
import type { TextureSource } from '../types.js';
import type { RuntimeRenderTarget, RuntimeTextureBinding } from './internal-types.js';

const FRAME_BINDING = 0;
const UNIFORM_BINDING = 1;
const FIRST_TEXTURE_BINDING = 2;
const DEFAULT_MAX_COMPUTE_WORKGROUPS_PER_DIMENSION = 65_535;
const COMPUTE_DISPATCH_AXES = ['x', 'y', 'z'] as const;
const DEFAULT_MAX_TEXTURE_DIMENSION_2D = 8192;

function formatComputeDispatchValue(value: unknown): string {
	if (value === undefined) return 'undefined';
	if (typeof value === 'number') return Number.isNaN(value) ? 'NaN' : String(value);
	if (typeof value === 'string') return `"${value}"`;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

export function getMaxComputeWorkgroupsPerDimension(device: GPUDevice): number {
	const max = (device.limits as GPUSupportedLimits | undefined)?.maxComputeWorkgroupsPerDimension;
	return typeof max === 'number' && Number.isFinite(max) && max > 0
		? Math.floor(max)
		: DEFAULT_MAX_COMPUTE_WORKGROUPS_PER_DIMENSION;
}

function getMaxTextureDimension2D(device: GPUDevice): number {
	const max = (device.limits as GPUSupportedLimits | undefined)?.maxTextureDimension2D;
	return typeof max === 'number' && Number.isFinite(max) && max > 0
		? Math.floor(max)
		: DEFAULT_MAX_TEXTURE_DIMENSION_2D;
}

export function assertTextureAllocationSize(
	device: GPUDevice,
	width: number,
	height: number,
	label: string
): void {
	assertTextureDimensionsWithinLimit(width, height, getMaxTextureDimension2D(device), label);
}

function getPositiveDeviceLimit(
	device: GPUDevice,
	name: keyof ComputeResourceResolverLimits,
	fallback: number
): number {
	const value = (device.limits as unknown as Record<string, unknown> | undefined)?.[name];
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: fallback;
}

export function getComputeResourceResolverLimits(device: GPUDevice): ComputeResourceResolverLimits {
	return {
		maxBindingsPerBindGroup: getPositiveDeviceLimit(device, 'maxBindingsPerBindGroup', 1000),
		maxSampledTexturesPerShaderStage: getPositiveDeviceLimit(
			device,
			'maxSampledTexturesPerShaderStage',
			16
		),
		maxSamplersPerShaderStage: getPositiveDeviceLimit(device, 'maxSamplersPerShaderStage', 16),
		maxStorageTexturesPerShaderStage: getPositiveDeviceLimit(
			device,
			'maxStorageTexturesPerShaderStage',
			4
		),
		maxStorageBuffersPerShaderStage: getPositiveDeviceLimit(
			device,
			'maxStorageBuffersPerShaderStage',
			8
		),
		maxStorageBufferBindingSize: getPositiveDeviceLimit(
			device,
			'maxStorageBufferBindingSize',
			128 * 1024 * 1024
		)
	};
}

export function validateComputeDispatch(
	dispatch: unknown,
	maxWorkgroupsPerDimension: number,
	label: string
): [number, number, number] {
	if (!Array.isArray(dispatch)) {
		throw new Error(
			`${label} dispatch must resolve to an array [x, y, z], got ${formatComputeDispatchValue(dispatch)}.`
		);
	}
	const resolved = [dispatch[0], dispatch[1] ?? 1, dispatch[2] ?? 1] as const;
	const output: [number, number, number] = [1, 1, 1];
	for (let index = 0; index < COMPUTE_DISPATCH_AXES.length; index += 1) {
		const axis = COMPUTE_DISPATCH_AXES[index];
		const value = resolved[index];
		if (
			typeof value !== 'number' ||
			!Number.isFinite(value) ||
			!Number.isInteger(value) ||
			value < 1
		) {
			throw new Error(
				`${label} dispatch ${axis} must be a positive integer, got ${formatComputeDispatchValue(value)}.`
			);
		}
		if (value > maxWorkgroupsPerDimension) {
			throw new Error(
				`${label} dispatch ${axis} must be <= device.limits.maxComputeWorkgroupsPerDimension (${maxWorkgroupsPerDimension}), got ${value}.`
			);
		}
		output[index] = value;
	}
	return output;
}

export function getTextureBindings(index: number): {
	samplerBinding: number;
	textureBinding: number;
} {
	const samplerBinding = FIRST_TEXTURE_BINDING + index * 2;
	return { samplerBinding, textureBinding: samplerBinding + 1 };
}

export function resizeCanvas(
	canvas: HTMLCanvasElement,
	dprInput: number,
	cssSize?: { width: number; height: number }
): { width: number; height: number } {
	const dpr = Number.isFinite(dprInput) && dprInput > 0 ? dprInput : 1;
	const rect = cssSize ? null : canvas.getBoundingClientRect();
	const cssWidth = Math.max(0, cssSize?.width ?? rect?.width ?? 0);
	const cssHeight = Math.max(0, cssSize?.height ?? rect?.height ?? 0);
	const width = Math.max(1, Math.floor((cssWidth || 1) * dpr));
	const height = Math.max(1, Math.floor((cssHeight || 1) * dpr));
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	return { width, height };
}

export function uploadTextureBaseLevel(
	device: GPUDevice,
	texture: GPUTexture,
	uploadOptions: { flipY: boolean; premultipliedAlpha: boolean },
	source: TextureSource,
	width: number,
	height: number
): void {
	device.queue.copyExternalImageToTexture(
		{ source, flipY: uploadOptions.flipY },
		{ texture, mipLevel: 0, premultipliedAlpha: uploadOptions.premultipliedAlpha },
		{ width, height, depthOrArrayLayers: 1 }
	);
}

const GPU_MIPMAP_SHADER = `
struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	var positions = array<vec2f, 3>(
		vec2f(-1.0, -3.0),
		vec2f(-1.0, 1.0),
		vec2f(3.0, 1.0)
	);
	let position = positions[vertexIndex];
	var out: VertexOutput;
	out.position = vec4f(position, 0.0, 1.0);
	out.uv = position * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
	return out;
}

@group(0) @binding(0) var mipSampler: sampler;
@group(0) @binding(1) var mipSource: texture_2d<f32>;

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
	return textureSample(mipSource, mipSampler, in.uv);
}
`;

export interface GpuMipmapGenerator {
	generate: (input: {
		commandEncoder: GPUCommandEncoder;
		texture: GPUTexture;
		format: GPUTextureFormat;
		mipLevelCount: number;
	}) => void;
}

export function createGpuMipmapGenerator(device: GPUDevice): GpuMipmapGenerator {
	let sampler: GPUSampler | null = null;
	let shaderModule: GPUShaderModule | null = null;
	let bindGroupLayout: GPUBindGroupLayout | null = null;
	let pipelineLayout: GPUPipelineLayout | null = null;
	const pipelineByFormat = new Map<GPUTextureFormat, GPURenderPipeline>();
	const ensureBindGroupLayout = (): GPUBindGroupLayout => {
		bindGroupLayout ??= device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
			]
		});
		return bindGroupLayout;
	};
	const ensurePipeline = (format: GPUTextureFormat): GPURenderPipeline => {
		const cached = pipelineByFormat.get(format);
		if (cached) return cached;
		const layout = ensureBindGroupLayout();
		shaderModule ??= device.createShaderModule({ code: GPU_MIPMAP_SHADER });
		pipelineLayout ??= device.createPipelineLayout({ bindGroupLayouts: [layout] });
		const pipeline = device.createRenderPipeline({
			layout: pipelineLayout,
			vertex: { module: shaderModule, entryPoint: 'vertexMain' },
			fragment: { module: shaderModule, entryPoint: 'fragmentMain', targets: [{ format }] },
			primitive: { topology: 'triangle-list' }
		});
		pipelineByFormat.set(format, pipeline);
		return pipeline;
	};
	return {
		generate: ({ commandEncoder, texture, format, mipLevelCount }) => {
			if (mipLevelCount <= 1) return;
			sampler ??= device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
			const layout = ensureBindGroupLayout();
			const pipeline = ensurePipeline(format);
			for (let level = 1; level < mipLevelCount; level += 1) {
				const sourceView = texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 });
				const targetView = texture.createView({ baseMipLevel: level, mipLevelCount: 1 });
				const bindGroup = device.createBindGroup({
					layout,
					entries: [
						{ binding: 0, resource: sampler },
						{ binding: 1, resource: sourceView }
					]
				});
				const pass = commandEncoder.beginRenderPass({
					colorAttachments: [
						{
							view: targetView,
							clearValue: { r: 0, g: 0, b: 0, a: 0 },
							loadOp: 'clear',
							storeOp: 'store'
						}
					]
				});
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(3);
				pass.end();
			}
		}
	};
}

export function markTextureMipmapsDirty(
	binding: Pick<RuntimeTextureBinding, 'generateMipmaps' | 'mipmapsDirty'>,
	mipLevelCount: number
): void {
	binding.mipmapsDirty = binding.generateMipmaps && mipLevelCount > 1;
}

export function createBindGroupLayoutEntries(
	textureBindings: RuntimeTextureBinding[]
): GPUBindGroupLayoutEntry[] {
	const entries: GPUBindGroupLayoutEntry[] = [
		{
			binding: FRAME_BINDING,
			visibility: GPUShaderStage.FRAGMENT,
			buffer: { type: 'uniform', minBindingSize: 16 }
		},
		{
			binding: UNIFORM_BINDING,
			visibility: GPUShaderStage.FRAGMENT,
			buffer: { type: 'uniform' }
		}
	];
	for (const binding of textureBindings) {
		entries.push({
			binding: binding.samplerBinding,
			visibility: GPUShaderStage.FRAGMENT,
			sampler: { type: binding.samplerType }
		});
		entries.push({
			binding: binding.textureBinding,
			visibility: GPUShaderStage.FRAGMENT,
			texture: {
				sampleType: binding.resource.sampleType,
				viewDimension: '2d',
				multisampled: false
			}
		});
	}
	return entries;
}

const DIRTY_RANGE_MERGE_GAP = 4;
const EMPTY_DIRTY_RANGES: ReadonlyArray<{ start: number; count: number }> = [];

export function findDirtyFloatRanges(
	previous: Float32Array,
	next: Float32Array,
	mergeGapThreshold = DIRTY_RANGE_MERGE_GAP
): ReadonlyArray<{ start: number; count: number }> {
	let start = -1;
	let rangeCount = 0;
	const ranges: Array<{ start: number; count: number }> = [];
	for (let index = 0; index < next.length; index += 1) {
		if (previous[index] !== next[index]) {
			if (start === -1) start = index;
			continue;
		}
		if (start !== -1) {
			ranges.push({ start, count: index - start });
			rangeCount += 1;
			start = -1;
		}
	}
	if (start !== -1) {
		ranges.push({ start, count: next.length - start });
		rangeCount += 1;
	}
	if (rangeCount === 0) return EMPTY_DIRTY_RANGES;
	if (rangeCount <= 1) return ranges;
	const merged: Array<{ start: number; count: number }> = [ranges[0]!];
	for (let index = 1; index < rangeCount; index += 1) {
		const previousRange = merged[merged.length - 1]!;
		const currentRange = ranges[index]!;
		const gap = currentRange.start - (previousRange.start + previousRange.count);
		if (gap <= mergeGapThreshold) {
			previousRange.count = currentRange.start + currentRange.count - previousRange.start;
		} else {
			merged.push(currentRange);
		}
	}
	return merged;
}

export function createRenderTexture(
	device: GPUDevice,
	width: number,
	height: number,
	format: GPUTextureFormat
): RuntimeRenderTarget {
	assertTextureFormat(format, 'Render target');
	assertTextureAllocationSize(device, width, height, 'Render target');
	const texture = device.createTexture({
		size: { width, height, depthOrArrayLayers: 1 },
		format,
		usage:
			GPUTextureUsage.TEXTURE_BINDING |
			GPUTextureUsage.RENDER_ATTACHMENT |
			GPUTextureUsage.COPY_DST |
			GPUTextureUsage.COPY_SRC
	});
	return { texture, view: texture.createView(), width, height, format };
}

export function destroyRenderTexture(target: RuntimeRenderTarget | null): void {
	target?.texture.destroy();
}
