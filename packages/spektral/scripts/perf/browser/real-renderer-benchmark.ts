import { defineMaterial, resolveMaterial } from '../../../src/lib/core/material';
import { createRenderer } from '../../../src/lib/core/renderer';
import type { AnyPass, Renderer } from '../../../src/lib/core/types';
import { ComputePass } from '../../../src/lib/passes/ComputePass';
import { ShaderPass } from '../../../src/lib/passes/ShaderPass';
import { PingPongShaderPass } from '../../../src/lib/passes/PingPongShaderPass';
import { PingPongComputePass } from '../../../src/lib/passes/PingPongComputePass';
import {
	assertSteadyStateAllocations,
	type SteadyStateAllocations,
	summarizeSamples
} from '../real-renderer-results';

export interface Stats {
	samples: number[];
	median: number;
	p95: number;
	p99: number;
	min: number;
	max: number;
	coefficientOfVariationPct: number;
}

export interface CorrectnessSink {
	before: number;
	after: number;
	pixelCount: number;
	rgbRangeBefore: number;
	rgbRangeAfter: number;
	computeSentinelBefore: number | null;
	computeSentinelAfter: number | null;
}

export interface ScenarioResult {
	name: string;
	passCount: number;
	allocations: SteadyStateAllocations;
	cpuSubmitMs: Stats;
	queueCompletionMs: Stats;
	gpuFrameNs: Stats;
	correctness: CorrectnessSink;
}

export interface RealRendererBrowserResult {
	adapter: {
		vendor: string;
		architecture: string;
		device: string;
		description: string;
		backend: string;
		type: string;
		driver: string;
		isFallbackAdapter: boolean;
	};
	features: string[];
	config: {
		width: number;
		height: number;
		crossOriginIsolated: true;
		performanceNowResolutionMs: number;
		warmupFrames: number;
		sampleFrames: number;
		cpuSampleBatches: number;
		cpuFramesPerBatch: number;
		cpuInterval: 'amortized-renderer.render-call';
		gpuInterval: 'pre-marker-end-to-post-marker-begin';
		completionInterval: 'before-render-to-onSubmittedWorkDone';
		managedPipelinePreparation: 'async-readiness-callback';
	};
	scenarios: ScenarioResult[];
}

const WIDTH = 512;
const HEIGHT = 512;
const WARMUP_FRAMES = 16;
const SAMPLE_FRAMES = 100;
const CPU_SAMPLE_BATCHES = 30;
const CPU_FRAMES_PER_BATCH = 25;

function measurePerformanceNowResolution(): number {
	let previous = performance.now();
	let minimum = Number.POSITIVE_INFINITY;
	for (let sample = 0; sample < 100; sample += 1) {
		let current = performance.now();
		while (current === previous) {
			current = performance.now();
		}
		minimum = Math.min(minimum, current - previous);
		previous = current;
	}
	return minimum;
}

async function readComputeSentinel(renderer: Renderer, device: GPUDevice): Promise<number | null> {
	const storage = renderer.getStorageBuffer?.('data');
	if (!storage) {
		return null;
	}
	const readback = device.createBuffer({
		size: 4,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
	});
	try {
		const encoder = device.createCommandEncoder();
		encoder.copyBufferToBuffer(storage, 0, readback, 0, 4);
		device.queue.submit([encoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const value = new Float32Array(readback.getMappedRange())[0] ?? Number.NaN;
		readback.unmap();
		return value;
	} finally {
		readback.destroy();
	}
}

function installCanvasReadback(canvas: HTMLCanvasElement): {
	checksum: (device: GPUDevice) => Promise<{ checksum: number; rgbRange: number }>;
} {
	const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
	if (!context) {
		throw new Error('Canvas does not support WebGPU readback instrumentation');
	}
	let currentTexture: GPUTexture | null = null;
	const configure = context.configure.bind(context);
	const getCurrentTexture = context.getCurrentTexture.bind(context);
	context.configure = (configuration) => {
		configure({
			...configuration,
			usage: (configuration.usage ?? GPUTextureUsage.RENDER_ATTACHMENT) | GPUTextureUsage.COPY_SRC
		});
	};
	context.getCurrentTexture = () => {
		currentTexture = getCurrentTexture();
		return currentTexture;
	};

	return {
		checksum: async (device) => {
			if (!currentTexture) {
				throw new Error('Renderer did not acquire a canvas texture');
			}
			const bytesPerRow = WIDTH * 4;
			const buffer = device.createBuffer({
				size: bytesPerRow * HEIGHT,
				usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
			});
			try {
				const encoder = device.createCommandEncoder();
				encoder.copyTextureToBuffer(
					{ texture: currentTexture },
					{ buffer, bytesPerRow, rowsPerImage: HEIGHT },
					{ width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 }
				);
				device.queue.submit([encoder.finish()]);
				await buffer.mapAsync(GPUMapMode.READ);
				const pixels = new Uint8Array(buffer.getMappedRange());
				let checksum = 2_166_136_261;
				let opaquePixels = 0;
				let rgbMin = 255;
				let rgbMax = 0;
				for (let index = 0; index < pixels.length; index += 4) {
					for (let channel = 0; channel < 4; channel += 1) {
						const value = pixels[index + channel] ?? 0;
						checksum ^= value;
						checksum = Math.imul(checksum, 16_777_619) >>> 0;
						if (channel < 3) {
							rgbMin = Math.min(rgbMin, value);
							rgbMax = Math.max(rgbMax, value);
						}
					}
					if ((pixels[index + 3] ?? 0) > 0) {
						opaquePixels += 1;
					}
				}
				buffer.unmap();
				const rgbRange = rgbMax - rgbMin;
				if (opaquePixels !== WIDTH * HEIGHT || checksum === 0 || rgbRange < 16) {
					throw new Error(
						`Renderer correctness sink failed (opaquePixels=${opaquePixels}, checksum=${checksum}, rgbRange=${rgbRange})`
					);
				}
				return { checksum, rgbRange };
			} finally {
				buffer.destroy();
			}
		}
	};
}

type ScenarioName =
	| 'no-pass'
	| 'sixteen-pass'
	| 'compute'
	| 'feedback-shader-odd'
	| 'feedback-shader-even'
	| 'feedback-compute-odd'
	| 'feedback-compute-even'
	| 'dynamic-mipmaps';

function createPasses(kind: ScenarioName): AnyPass[] {
	const iterations = kind.endsWith('even') ? 2 : 1;
	if (kind.startsWith('feedback-shader'))
		return [
			new PingPongShaderPass({
				target: 'sim',
				iterations,
				format: 'rgba8unorm',
				fragment:
					'fn frag(uv: vec2f) -> vec4f { return vec4f(0.15 + uv.x * 0.7, 0.2 + uv.y * 0.6, 0.45, 1.0); }'
			})
		];
	if (kind.startsWith('feedback-compute'))
		return [
			new PingPongComputePass({
				iterations,
				resources: {
					previous: { texture: 'sim', access: 'sampled', pingPong: 'read' },
					next: { texture: 'sim', access: 'storage-write', pingPong: 'write' }
				},
				compute: `@compute @workgroup_size(8, 8) fn compute(@builtin(global_invocation_id) id: vec3u) {
			let size = textureDimensions(next);
			if (id.x < size.x && id.y < size.y) { let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(size); textureStore(next, vec2i(id.xy), vec4f(0.15 + uv.x * 0.7, 0.2 + uv.y * 0.6, 0.45, 1.0)); }
		}`,
				dispatch: [WIDTH / 8, HEIGHT / 8, 1]
			})
		];
	if (kind === 'sixteen-pass') {
		return Array.from(
			{ length: 16 },
			() =>
				new ShaderPass({
					fragment: `
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	return vec4f(inputColor.rgb * 0.999 + vec3f(uv, 0.5) * 0.001, inputColor.a);
}
`
				})
		);
	}
	if (kind === 'compute') {
		return [
			new ComputePass({
				compute: `
@compute @workgroup_size(64)
fn compute(@builtin(global_invocation_id) id: vec3u) {
	if (id.x < 16384u) {
		data[id.x] = data[id.x] + vec4f(0.000001, 0.0, 0.0, 0.0);
	}
}
`,
				resources: { data: { buffer: 'data', access: 'storage-read-write' } },
				dispatch: [256, 1, 1]
			})
		];
	}
	return [];
}

async function createScenarioRenderer(
	name: ScenarioName,
	canvas: HTMLCanvasElement,
	requestRender: () => void
): Promise<{ renderer: Renderer; passes: AnyPass[] }> {
	const withCompute = name === 'compute';
	const textured = name.startsWith('feedback-') || name === 'dynamic-mipmaps';
	const source = document.createElement('canvas');
	source.width = source.height = 1024;
	if (name === 'dynamic-mipmaps') {
		const context = source.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, 1024, 1024);
		gradient.addColorStop(0, '#204080');
		gradient.addColorStop(1, '#e0a040');
		context.fillStyle = gradient;
		context.fillRect(0, 0, 1024, 1024);
	}
	const material = defineMaterial({
		fragment: textured
			? 'fn frag(uv: vec2f) -> vec4f { return textureSample(sim, simSampler, uv); }'
			: `
fn frag(uv: vec2f) -> vec4f {
	return vec4f(0.15 + uv.x * 0.7, 0.2 + uv.y * 0.6, 0.45, 1.0);
}
`,
		...(textured
			? {
					textures: {
						sim:
							name === 'dynamic-mipmaps'
								? {
										source,
										generateMipmaps: true,
										update: 'perFrame' as const,
										colorSpace: 'linear' as const
									}
								: name.startsWith('feedback-compute')
									? { storage: true, format: 'rgba8unorm' as const, width: WIDTH, height: HEIGHT }
									: { format: 'rgba8unorm' as const }
					}
				}
			: {}),
		...(withCompute
			? {
					storageBuffers: {
						data: {
							size: 262144,
							type: 'array<vec4f>' as const,
							initialData: new Float32Array(65536)
						}
					}
				}
			: {})
	});
	const resolved = resolveMaterial(material);
	const passes = createPasses(name);
	const renderer = await createRenderer({
		canvas,
		requestRender,
		fragmentWgsl: resolved.fragmentWgsl,
		fragmentLineMap: resolved.fragmentLineMap,
		fragmentSource: resolved.fragmentSource,
		includeSources: resolved.includeSources,
		defineBlockSource: resolved.defineBlockSource,
		materialSource: resolved.source,
		materialSignature: resolved.signature,
		uniformLayout: resolved.uniformLayout,
		textureKeys: resolved.textureKeys,
		textureDefinitions: resolved.textures,
		storageBufferKeys: resolved.storageBufferKeys,
		storageBufferDefinitions: material.storageBuffers,
		storageTextureKeys: resolved.storageTextureKeys,
		passes,
		getClearColor: () => [0, 0, 0, 1],
		getDpr: () => 1,
		adapterOptions: { powerPreference: 'high-performance' },
		deviceDescriptor: { requiredFeatures: ['timestamp-query'] }
	});
	return { renderer, passes };
}

function createTimestampMarker(device: GPUDevice): {
	mark: (index: 0 | 1, resolveResults: boolean) => GPUCommandBuffer;
	read: () => Promise<number>;
	destroy: () => void;
} {
	const querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
	const resolveBuffer = device.createBuffer({
		size: 16,
		usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
	});
	const readBuffer = device.createBuffer({
		size: 16,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
	});
	const texture = device.createTexture({
		size: [1, 1, 1],
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT
	});
	const view = texture.createView();
	return {
		mark: (index, resolveResults) => {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view,
						loadOp: 'clear',
						storeOp: 'store',
						clearValue: { r: 0, g: 0, b: 0, a: 1 }
					}
				],
				timestampWrites:
					index === 0
						? { querySet, endOfPassWriteIndex: index }
						: { querySet, beginningOfPassWriteIndex: index }
			});
			pass.end();
			if (resolveResults) {
				encoder.resolveQuerySet(querySet, 0, 2, resolveBuffer, 0);
				encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, 16);
			}
			return encoder.finish();
		},
		read: async () => {
			await readBuffer.mapAsync(GPUMapMode.READ);
			const values = new BigUint64Array(readBuffer.getMappedRange().slice(0));
			const elapsed = Number((values[1] ?? 0n) - (values[0] ?? 0n));
			readBuffer.unmap();
			return elapsed;
		},
		destroy: () => {
			querySet.destroy();
			resolveBuffer.destroy();
			readBuffer.destroy();
			texture.destroy();
		}
	};
}

function sampleAllocations(device: GPUDevice, render: () => void): SteadyStateAllocations {
	const counts: SteadyStateAllocations = {
		frames: 100,
		bindGroups: 0,
		textureViews: 0,
		pipelines: 0
	};
	const bindGroup = device.createBindGroup;
	const renderPipeline = device.createRenderPipeline;
	const renderPipelineAsync = device.createRenderPipelineAsync;
	const computePipeline = device.createComputePipeline;
	const computePipelineAsync = device.createComputePipelineAsync;
	const createView = GPUTexture.prototype.createView;
	device.createBindGroup = function (descriptor) {
		counts.bindGroups++;
		return bindGroup.call(this, descriptor);
	};
	device.createRenderPipeline = function (descriptor) {
		counts.pipelines++;
		return renderPipeline.call(this, descriptor);
	};
	device.createRenderPipelineAsync = function (descriptor) {
		counts.pipelines++;
		return renderPipelineAsync.call(this, descriptor);
	};
	device.createComputePipeline = function (descriptor) {
		counts.pipelines++;
		return computePipeline.call(this, descriptor);
	};
	device.createComputePipelineAsync = function (descriptor) {
		counts.pipelines++;
		return computePipelineAsync.call(this, descriptor);
	};
	GPUTexture.prototype.createView = function (descriptor) {
		// Swapchain views are per-frame by contract; count owned sampled/storage resources.
		if ((this.usage & (GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING)) !== 0)
			counts.textureViews++;
		return createView.call(this, descriptor);
	};
	try {
		for (let frame = 0; frame < counts.frames; frame++) render();
	} finally {
		device.createBindGroup = bindGroup;
		device.createRenderPipeline = renderPipeline;
		device.createRenderPipelineAsync = renderPipelineAsync;
		device.createComputePipeline = computePipeline;
		device.createComputePipelineAsync = computePipelineAsync;
		GPUTexture.prototype.createView = createView;
	}
	assertSteadyStateAllocations(counts);
	return counts;
}

async function runScenario(name: ScenarioName): Promise<ScenarioResult> {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	document.body.replaceChildren(canvas);
	const readback = installCanvasReadback(canvas);
	let signalReady!: () => void;
	const ready = new Promise<void>((resolve) => {
		signalReady = resolve;
	});
	const scenario = await createScenarioRenderer(name, canvas, signalReady);
	const { renderer, passes } = scenario;
	const device = renderer.getDevice?.();
	if (!device) {
		renderer.destroy();
		throw new Error('Renderer did not expose its active GPUDevice');
	}
	const marker = createTimestampMarker(device);
	const render = (): void => {
		renderer.render({
			time: 1,
			delta: 1 / 60,
			renderMode: 'manual',
			uniforms: {},
			textures: {},
			canvasSize: { width: WIDTH, height: HEIGHT }
		});
	};
	try {
		if (name === 'compute' || name.startsWith('feedback-')) {
			// Each of these scenarios prepares one managed pipeline. Its readiness
			// callback waits for compilation and validation before warmup starts.
			let pipelineCalls = 0;
			const methods = [
				'createComputePipeline',
				'createComputePipelineAsync',
				'createRenderPipeline',
				'createRenderPipelineAsync'
			] as const;
			const restore: Array<() => void> = [];
			for (const method of methods) {
				const original = device[method];
				Reflect.set(device, method, (...args: unknown[]) => {
					pipelineCalls++;
					return Reflect.apply(original, device, args);
				});
				restore.push(() => {
					Reflect.set(device, method, original);
				});
			}
			try {
				render();
			} finally {
				for (const reset of restore) reset();
			}
			if (pipelineCalls !== 0)
				throw new Error(`Managed pipeline compilation ran inside render(): ${name}`);
			let timeout: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					ready,
					new Promise<never>((_, reject) => {
						timeout = setTimeout(
							() => reject(new Error(`Pipeline readiness timed out: ${name}`)),
							15_000
						);
					})
				]);
			} finally {
				clearTimeout(timeout);
			}
		}
		for (let index = 0; index < WARMUP_FRAMES; index += 1) {
			render();
			await device.queue.onSubmittedWorkDone();
		}
		render();
		const before = await readback.checksum(device);
		const computeSentinelBefore = await readComputeSentinel(renderer, device);
		const cpuSubmitSamples: number[] = [];
		for (let sample = 0; sample < CPU_SAMPLE_BATCHES; sample += 1) {
			const startedAt = performance.now();
			for (let frame = 0; frame < CPU_FRAMES_PER_BATCH; frame += 1) {
				render();
			}
			cpuSubmitSamples.push((performance.now() - startedAt) / CPU_FRAMES_PER_BATCH);
			await device.queue.onSubmittedWorkDone();
		}
		const queueCompletionSamples: number[] = [];
		const gpuFrameSamples: number[] = [];
		for (let index = 0; index < SAMPLE_FRAMES; index += 1) {
			device.queue.submit([marker.mark(0, false)]);
			const startedAt = performance.now();
			render();
			const rendererCompletion = device.queue.onSubmittedWorkDone();
			device.queue.submit([marker.mark(1, true)]);
			await rendererCompletion;
			queueCompletionSamples.push(performance.now() - startedAt);
			gpuFrameSamples.push(await marker.read());
		}
		render();
		const after = await readback.checksum(device);
		const computeSentinelAfter = await readComputeSentinel(renderer, device);
		if (before.checksum !== after.checksum || before.rgbRange !== after.rgbRange) {
			throw new Error(
				`Renderer correctness output changed: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`
			);
		}
		if (
			computeSentinelBefore !== null &&
			(computeSentinelAfter === null || computeSentinelAfter <= computeSentinelBefore)
		) {
			throw new Error(
				`Compute correctness sentinel did not advance: before=${computeSentinelBefore}, after=${String(computeSentinelAfter)}`
			);
		}
		const allocations = sampleAllocations(device, render);
		await device.queue.onSubmittedWorkDone();
		return {
			name,
			allocations,
			passCount: passes.length,
			cpuSubmitMs: summarizeSamples(cpuSubmitSamples),
			queueCompletionMs: summarizeSamples(queueCompletionSamples),
			gpuFrameNs: summarizeSamples(gpuFrameSamples),
			correctness: {
				before: before.checksum,
				after: after.checksum,
				pixelCount: WIDTH * HEIGHT,
				rgbRangeBefore: before.rgbRange,
				rgbRangeAfter: after.rgbRange,
				computeSentinelBefore,
				computeSentinelAfter
			}
		};
	} finally {
		marker.destroy();
		renderer.destroy();
	}
}

async function run(): Promise<RealRendererBrowserResult> {
	if (!crossOriginIsolated) {
		throw new Error('Cross-origin isolation is required for high-resolution CPU submit timing');
	}
	const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
	if (!adapter) {
		throw new Error('Unable to acquire a WebGPU adapter');
	}
	const info = adapter.info as GPUAdapterInfo & {
		backend?: string;
		type?: string;
		driver?: string;
	};
	const softwareIdentity = [
		info.vendor,
		info.architecture,
		info.device,
		info.description,
		info.backend,
		info.type,
		info.driver
	]
		.join(' ')
		.toLowerCase();
	const isSoftware = /swiftshader|llvmpipe|software|(?:^|[^a-z])(?:cpu|null)(?:[^a-z]|$)/u.test(
		softwareIdentity
	);
	const isFallbackAdapter = info.isFallbackAdapter ?? false;
	if (isFallbackAdapter || isSoftware) {
		throw new Error(`Physical GPU required; received ${softwareIdentity}`);
	}
	if (!adapter.features.has('timestamp-query')) {
		throw new Error('Physical GPU adapter does not support timestamp-query');
	}

	return {
		adapter: {
			vendor: info.vendor ?? '',
			architecture: info.architecture ?? '',
			device: info.device ?? '',
			description: info.description ?? '',
			backend: info.backend ?? '',
			type: info.type ?? '',
			driver: info.driver ?? '',
			isFallbackAdapter
		},
		features: [...adapter.features].sort(),
		config: {
			width: WIDTH,
			height: HEIGHT,
			crossOriginIsolated: true,
			performanceNowResolutionMs: measurePerformanceNowResolution(),
			warmupFrames: WARMUP_FRAMES,
			sampleFrames: SAMPLE_FRAMES,
			cpuSampleBatches: CPU_SAMPLE_BATCHES,
			cpuFramesPerBatch: CPU_FRAMES_PER_BATCH,
			cpuInterval: 'amortized-renderer.render-call',
			gpuInterval: 'pre-marker-end-to-post-marker-begin',
			completionInterval: 'before-render-to-onSubmittedWorkDone',
			managedPipelinePreparation: 'async-readiness-callback'
		},
		scenarios: [
			await runScenario('no-pass'),
			await runScenario('sixteen-pass'),
			await runScenario('compute'),
			await runScenario('feedback-shader-odd'),
			await runScenario('feedback-shader-even'),
			await runScenario('feedback-compute-odd'),
			await runScenario('feedback-compute-even'),
			await runScenario('dynamic-mipmaps')
		]
	};
}

declare global {
	interface Window {
		__SPEKTRAL_REAL_RENDERER_BENCHMARK__?: () => Promise<RealRendererBrowserResult>;
	}
}

window.__SPEKTRAL_REAL_RENDERER_BENCHMARK__ = run;
