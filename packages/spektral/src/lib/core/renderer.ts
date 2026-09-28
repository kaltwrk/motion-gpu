import { buildRenderTargetSignature, resolveRenderTargetDefinitions } from './render-targets.js';
import {
	hasSameRenderGraphPhysicalAccessSignature,
	planRenderGraph,
	type RenderGraphPlan
} from './render-graph.js';
import { createRenderGraphSnapshotBuilder } from './render-graph-snapshot.js';
import { buildPingPongShaderSourceWithMap, buildShaderSourceWithMap } from './shader.js';
import { attachSpektralErrorContext, createSpektralError } from './error-report.js';
import {
	getTextureMipLevelCount,
	normalizeTextureDefinitions,
	resolveTextureSamplingLayout,
	resolveTextureUpdateMode,
	resolveTextureSize,
	toTextureData
} from './textures.js';
import { packUniformsIntoFast } from './uniforms.js';
import { buildComputeShaderSourceWithMap } from './compute-shader.js';
import {
	createComputeBindGroupCache,
	type ComputeBindGroupCache
} from './compute-bindgroup-cache.js';
import type { ResolvedComputePassResources, ResolvedComputeResource } from './compute-resources.js';
import {
	ComputeSampledFallbackTexturePool,
	toComputeSampledFallbackClass
} from './compute-fallback-textures.js';
import { MaterialResourceRegistry, type RuntimeTextureResource } from './resource-registry.js';
import { normalizeStorageBufferDefinition } from './storage-buffers.js';
import {
	isManagedComputePass,
	isManagedFeedbackPass,
	isPreparedFullscreenPass
} from './pass-contract.js';
import {
	validateBuiltInRenderPassFormats,
	validatePresentationSourceFormat,
	validateRenderTargetFormats,
	validateWorkingFormat,
	resolvePresentationSourceSlot,
	type RenderTargetFormatMap
} from './render-format-validation.js';
import {
	assertFloatRenderableFormat,
	assertFloatSampledFormat,
	assertStorageTextureAccess,
	assertTextureFormatSupported
} from './format-capabilities.js';
import {
	buildCanvasConfiguration,
	resolveColorPipeline,
	shouldConvertLinearToSrgb,
	type EffectiveDynamicRange
} from './color-pipeline.js';
import type {
	RenderGraphPassSnapshot,
	RuntimeRenderTarget,
	RuntimeTextureBinding
} from './renderer/internal-types.js';
import {
	assertCompilation,
	assertComputeCompilationAsync,
	buildShaderCompilationRuntimeContext,
	toComputeCompilationError
} from './renderer/pipeline-compilation.js';
import {
	createPresentationPipeline,
	presentToCanvas,
	toClearValue,
	toPremultipliedCanvasClearValue
} from './renderer/presentation.js';
import {
	executePostSceneRenderGraph,
	isRenderGraphPlanCacheValid,
	updateRenderGraphPassSnapshots
} from './renderer/render-graph-execution.js';
import {
	isFullscreenPassPreparationReady,
	prepareActiveFullscreenPasses,
	prepareResolvedFullscreenPass,
	resolveFullscreenPassPreparation,
	releasePreparedFullscreenPass
} from './renderer/fullscreen-pass-preparation.js';
import {
	assertTextureAllocationSize,
	createBindGroupLayoutEntries,
	createGpuMipmapGenerator,
	createRenderTexture,
	destroyRenderTexture,
	findDirtyFloatRanges,
	getComputeResourceResolverLimits,
	getMaxComputeWorkgroupsPerDimension,
	getTextureBindings,
	markTextureMipmapsDirty,
	resizeCanvas,
	uploadTextureBaseLevel,
	validateComputeDispatch
} from './renderer/resource-synchronization.js';
import { createComputePassResourceResolutionCache } from './renderer/compute-resource-resolution.js';
import type {
	AnyPass,
	ComputePassLike,
	PingPongShaderPassLike,
	RenderPassInputSlot,
	RenderMode,
	RenderTarget,
	Renderer,
	RendererOptions,
	TextureValue
} from './types.js';

export { findDirtyFloatRanges } from './renderer/resource-synchronization.js';

// A runtime constructs the replacement renderer before destroying the previous
// one. Track updater ownership outside a renderer instance so old teardown cannot
// clear a snapshot already owned by its successor.
const graphUpdaterOwners = new WeakMap<object, object>();

/**
 * Binding index for frame uniforms (`time`, `delta`, `resolution`).
 */
const FRAME_BINDING = 0;

/**
 * Binding index for material uniform buffer.
 */
const UNIFORM_BINDING = 1;

/**
 * Runtime ping-pong storage textures for a single logical target key.
 */
interface PingPongTexturePair {
	logicalId: string;
	format: GPUTextureFormat;
	width: number;
	height: number;
	textureA: GPUTexture;
	viewA: GPUTextureView;
	textureB: GPUTexture;
	viewB: GPUTextureView;
	readFromA: boolean;
}

/**
 * Runtime fragment-feedback textures for a single pass instance.
 */
interface PingPongShaderTexturePair {
	frameBuffer: GPUBuffer;
	target: string;
	format: GPUTextureFormat;
	width: number;
	height: number;
	filter: GPUFilterMode;
	addressModeU: GPUAddressMode;
	addressModeV: GPUAddressMode;
	sampleType: GPUTextureSampleType;
	samplerType: GPUSamplerBindingType;
	effectiveFilter: GPUFilterMode;
	textureA: GPUTexture;
	viewA: GPUTextureView;
	textureB: GPUTexture;
	viewB: GPUTextureView;
	sampler: GPUSampler;
	previousBindGroupLayout: GPUBindGroupLayout | null;
	readABindGroup: GPUBindGroup | null;
	readBBindGroup: GPUBindGroup | null;
	needsClear: boolean;
}

/**
 * Creates the WebGPU renderer used by `FragCanvas`.
 *
 * @param options - Renderer creation options resolved from material/context state.
 * @returns Renderer instance with `render` and `destroy`.
 * @throws {Error} On WebGPU unavailability, shader compilation issues, or runtime setup failures.
 */
export async function createRenderer(options: RendererOptions): Promise<Renderer> {
	if (!navigator.gpu) {
		throw new Error('WebGPU is not available in this browser');
	}

	const context = options.canvas.getContext('webgpu') as GPUCanvasContext | null;
	if (!context) {
		throw new Error('Canvas does not support webgpu context');
	}

	const preferredCanvasFormat = navigator.gpu.getPreferredCanvasFormat();
	const colorPipeline = resolveColorPipeline({
		color: options.color,
		preferredCanvasFormat
	});
	const workingFormat = colorPipeline.workingFormat;
	const scenePipelineFormat = colorPipeline.requiresPresentationPass
		? workingFormat
		: colorPipeline.canvasFormat;
	let effectiveCanvasFormat = colorPipeline.canvasFormat;
	let effectiveDynamicRange: EffectiveDynamicRange =
		colorPipeline.dynamicRange === 'auto' ? 'hdr' : colorPipeline.dynamicRange;
	const adapter = await navigator.gpu.requestAdapter(options.adapterOptions);
	if (!adapter) {
		throw new Error('Unable to acquire WebGPU adapter');
	}

	const device = await adapter.requestDevice(options.deviceDescriptor);
	const graphUpdaterOwner = {};
	const graphSnapshotBuilder = createRenderGraphSnapshotBuilder();
	const ownsGraphUpdater = (): boolean =>
		options.graphUpdater !== undefined &&
		graphUpdaterOwners.get(options.graphUpdater as object) === graphUpdaterOwner;
	const maxComputeWorkgroupsPerDimension = getMaxComputeWorkgroupsPerDimension(device);
	let isDestroyed = false;
	let deviceLostMessage: string | null = null;
	const uncapturedErrorMessages: string[] = [];
	const initializationCleanups: Array<() => void> = [];
	let acceptInitializationCleanups = true;
	const MAX_UNCAPTURED_ERROR_MESSAGES = 12;
	const destroyDevice = (): void => {
		try {
			device.destroy();
		} catch {
			// Best-effort GPUDevice teardown.
		}
	};

	const isDerivativeUncapturedMessage = (message: string): boolean => {
		const normalized = message.toLowerCase();
		// "is invalid due to a previous error" is the canonical Dawn/WebGPU
		// cascade marker emitted from setPipeline / commandEncoder.finish /
		// queue.submit when a prior shader/pipeline failed validation. The
		// authoritative error already lives in our compute-pipeline error cache
		// (or in another uncaptured message), so suppress these from the user
		// channel — they only add noise like "[Invalid CommandBuffer] is
		// invalid due to a previous error".
		return (
			normalized.includes('is invalid due to a previous error') ||
			normalized.includes('too many warnings, no more warnings will be reported')
		);
	};

	const consumeUncapturedErrorMessage = (): string | null => {
		if (uncapturedErrorMessages.length === 0) {
			return null;
		}

		const uniqueMessages: string[] = [];
		for (const message of uncapturedErrorMessages) {
			if (!uniqueMessages.includes(message)) {
				uniqueMessages.push(message);
			}
		}
		uncapturedErrorMessages.length = 0;

		const primaryIndex = uniqueMessages.findIndex(
			(message) => !isDerivativeUncapturedMessage(message)
		);
		// When every queued message is derivative cascade noise we have nothing
		// of substance to surface — return null so the host can fall through to
		// the structured diagnostics path (e.g. a cached compute compilation
		// error) instead of throwing an unhelpful "[Invalid X] is invalid due
		// to a previous error".
		if (primaryIndex === -1) {
			return null;
		}
		const primaryMessage = uniqueMessages[primaryIndex];
		if (!primaryMessage) {
			return null;
		}

		const relatedMessages = uniqueMessages.filter((_, index) => index !== primaryIndex);
		if (relatedMessages.length === 0) {
			return `WebGPU uncaptured error: ${primaryMessage}`;
		}

		return [
			`WebGPU uncaptured error: ${primaryMessage}`,
			`Additional uncaptured WebGPU errors (${relatedMessages.length}):`,
			...relatedMessages.map((message, index) => `[${index + 1}] ${message}`)
		].join('\n');
	};

	const registerInitializationCleanup = (cleanup: () => void): void => {
		if (!acceptInitializationCleanups) {
			return;
		}
		options.__onInitializationCleanupRegistered?.();
		initializationCleanups.push(cleanup);
	};
	const fullscreenPassOwner = {};
	const preparedFullscreenPasses = new Set<Parameters<typeof releasePreparedFullscreenPass>[0]>();
	const pendingDynamicFullscreenPasses = new Map<
		Parameters<typeof releasePreparedFullscreenPass>[0],
		string
	>();
	const failedDynamicFullscreenPasses = new Map<
		Parameters<typeof releasePreparedFullscreenPass>[0],
		string
	>();

	const runInitializationCleanups = (): void => {
		for (let index = initializationCleanups.length - 1; index >= 0; index -= 1) {
			try {
				initializationCleanups[index]?.();
			} catch {
				// Best-effort cleanup on failed renderer initialization.
			}
		}
		initializationCleanups.length = 0;
	};

	void device.lost.then((info) => {
		if (isDestroyed) {
			return;
		}

		const reason = info.reason ? ` (${info.reason})` : '';
		const details = info.message?.trim();
		deviceLostMessage = details
			? `WebGPU device lost: ${details}${reason}`
			: `WebGPU device lost${reason}`;
		options.requestRender?.();
	});

	const handleUncapturedError = (event: GPUUncapturedErrorEvent): void => {
		if (isDestroyed) {
			return;
		}

		const message =
			event.error instanceof Error
				? event.error.message
				: String((event.error as { message?: string })?.message ?? event.error);
		const trimmedMessage = message.trim();
		const normalizedMessage =
			trimmedMessage.length > 0 ? trimmedMessage : 'Unknown GPU validation error';
		const lastMessage = uncapturedErrorMessages[uncapturedErrorMessages.length - 1];
		if (lastMessage === normalizedMessage) {
			return;
		}

		uncapturedErrorMessages.push(normalizedMessage);
		if (uncapturedErrorMessages.length > MAX_UNCAPTURED_ERROR_MESSAGES) {
			uncapturedErrorMessages.splice(
				0,
				uncapturedErrorMessages.length - MAX_UNCAPTURED_ERROR_MESSAGES
			);
		}
		options.requestRender?.();
	};

	device.addEventListener('uncapturederror', handleUncapturedError);
	try {
		validateWorkingFormat(workingFormat, device.features);
		const presentationSamplingLayout = resolveTextureSamplingLayout({
			format: workingFormat,
			filter: 'linear',
			deviceFeatures: device.features
		});
		const initialPasses = options.getPasses?.() ?? options.passes ?? [];
		const initialRenderTargets = options.getRenderTargets?.() ?? options.renderTargets;
		const initialRenderTargetFormats = validateRenderTargetFormats(
			initialRenderTargets,
			workingFormat,
			device.features
		);
		validateBuiltInRenderPassFormats({
			passes: initialPasses,
			workingFormat,
			namedFormats: initialRenderTargetFormats,
			deviceFeatures: device.features
		});
		const presentationSourceSlot = resolvePresentationSourceSlot(initialPasses);
		if (presentationSourceSlot !== null) {
			validatePresentationSourceFormat({
				slot: presentationSourceSlot,
				workingFormat,
				namedFormats: initialRenderTargetFormats,
				deviceFeatures: device.features,
				requiresFilterableInput: presentationSamplingLayout.samplerType === 'filtering'
			});
		}
		registerInitializationCleanup(() => {
			for (const pass of preparedFullscreenPasses) {
				releasePreparedFullscreenPass(pass, device, fullscreenPassOwner);
			}
			preparedFullscreenPasses.clear();
		});
		await prepareActiveFullscreenPasses({
			passes: initialPasses,
			device,
			owner: fullscreenPassOwner,
			workingFormat,
			namedFormats: initialRenderTargetFormats,
			preparedPasses: preparedFullscreenPasses,
			...(options.reportAsyncError !== undefined
				? { reportRecoverableError: options.reportAsyncError }
				: {}),
			...(options.requestRender !== undefined ? { requestRender: options.requestRender } : {})
		});
		const runtimeContext = buildShaderCompilationRuntimeContext(options, {
			passes: initialPasses,
			renderTargets: initialRenderTargets
		});
		const convertLinearToSrgb =
			!colorPipeline.requiresPresentationPass &&
			shouldConvertLinearToSrgb(colorPipeline.outputEncoding, colorPipeline.canvasFormat, 'sdr');
		const fragmentTextureKeys = options.textureKeys.filter(
			(key) => options.textureDefinitions[key]?.fragmentVisible !== false
		);
		const buildSceneShader = (directToCanvas: boolean) =>
			buildShaderSourceWithMap(options.fragmentWgsl, options.uniformLayout, fragmentTextureKeys, {
				convertLinearToSrgb: directToCanvas && convertLinearToSrgb,
				premultiplyOutputAlpha: directToCanvas,
				fragmentLineMap: options.fragmentLineMap,
				...(options.storageBufferKeys !== undefined
					? { storageBufferKeys: options.storageBufferKeys }
					: {}),
				...(options.storageBufferDefinitions !== undefined
					? { storageBufferDefinitions: options.storageBufferDefinitions }
					: {})
			});
		const builtShader = buildSceneShader(false);
		const shaderModule = device.createShaderModule({ code: builtShader.code });
		const assertSceneShaderCompilation = (
			module: GPUShaderModule,
			builtSource: typeof builtShader
		) =>
			assertCompilation(module, {
				lineMap: builtSource.lineMap,
				fragmentSource: options.fragmentSource,
				includeSources: options.includeSources,
				...(options.defineBlockSource !== undefined
					? { defineBlockSource: options.defineBlockSource }
					: {}),
				materialSource: options.materialSource ?? null,
				runtimeContext
			});
		await assertSceneShaderCompilation(shaderModule, builtShader);
		const builtDirectCanvasShader = !colorPipeline.requiresPresentationPass
			? buildSceneShader(true)
			: null;
		const directCanvasShaderModule = builtDirectCanvasShader
			? device.createShaderModule({ code: builtDirectCanvasShader.code })
			: null;
		if (directCanvasShaderModule && builtDirectCanvasShader) {
			await assertSceneShaderCompilation(directCanvasShaderModule, builtDirectCanvasShader);
		}

		const normalizedTextureDefinitions = normalizeTextureDefinitions(
			options.textureDefinitions,
			options.textureKeys
		);
		for (const key of options.textureKeys) {
			const definition = normalizedTextureDefinitions[key];
			if (!definition) continue;
			assertTextureFormatSupported({
				format: definition.format,
				target: key,
				pass: 'Material texture allocation',
				deviceFeatures: device.features
			});
			if (definition.fragmentVisible) {
				assertFloatSampledFormat({
					format: definition.format,
					target: key,
					pass: 'Material fragment texture',
					deviceFeatures: device.features
				});
			}
			if (definition.storage) {
				assertStorageTextureAccess({
					format: definition.format,
					target: key,
					pass: 'Material storage texture allocation',
					access: 'write-only',
					deviceFeatures: device.features
				});
			}
		}
		const storageBufferKeys = options.storageBufferKeys ?? [];
		const storageBufferDefinitions = options.storageBufferDefinitions ?? {};
		const storageTextureKeys = options.storageTextureKeys ?? [];
		const storageTextureKeySet = new Set(storageTextureKeys);
		const resourceRegistry = new MaterialResourceRegistry();
		const sampledFallbackPool = new ComputeSampledFallbackTexturePool(device);
		registerInitializationCleanup(() => sampledFallbackPool.destroy());
		const sampledFallbackUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
		const fragmentTextureIndexByKey = new Map(
			fragmentTextureKeys.map((key, index) => [key, index] as const)
		);
		const textureBindings = options.textureKeys.map((key): RuntimeTextureBinding => {
			const config = normalizedTextureDefinitions[key];
			if (!config) {
				throw new Error(`Missing texture definition for "${key}"`);
			}

			const fragmentTextureIndex = fragmentTextureIndexByKey.get(key);
			const fragmentVisible = fragmentTextureIndex !== undefined;
			const { samplerBinding, textureBinding } = getTextureBindings(fragmentTextureIndex ?? 0);
			const samplingLayout = resolveTextureSamplingLayout({
				format: config.format,
				filter: config.filter,
				deviceFeatures: device.features
			});
			if (config.generateMipmaps && samplingLayout.sampleType !== 'float') {
				throw new Error(
					`Texture "${key}" with format "${config.format}" cannot generate mipmaps because it is not filterable on this device.`
				);
			}
			const sampler = device.createSampler({
				magFilter: samplingLayout.effectiveFilter,
				minFilter: samplingLayout.effectiveFilter,
				mipmapFilter: config.generateMipmaps ? samplingLayout.effectiveFilter : 'nearest',
				addressModeU: config.addressModeU,
				addressModeV: config.addressModeV,
				maxAnisotropy:
					samplingLayout.samplerType === 'filtering' && samplingLayout.effectiveFilter === 'linear'
						? config.anisotropy
						: 1
			});
			let fallbackView: GPUTextureView;
			let resource: RuntimeTextureResource;
			if (config.storage) {
				if (!config.width || !config.height) {
					throw new Error(`Storage texture "${key}" requires explicit positive width and height.`);
				}
				assertTextureAllocationSize(device, config.width, config.height, `Texture "${key}"`);
				const storageUsage =
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.STORAGE_BINDING |
					GPUTextureUsage.COPY_DST;
				const storageTexture = device.createTexture({
					size: { width: config.width, height: config.height, depthOrArrayLayers: 1 },
					format: config.format,
					usage: storageUsage
				});
				registerInitializationCleanup(() => storageTexture.destroy());
				fallbackView = storageTexture.createView();
				resource = resourceRegistry.registerTexture({
					logicalId: key,
					ownedTexture: storageTexture,
					storageView: fallbackView,
					sampledView: fallbackView,
					format: config.format,
					width: config.width,
					height: config.height,
					mipLevelCount: 1,
					sampleType: samplingLayout.sampleType,
					usage: storageUsage
				});
			} else {
				fallbackView = sampledFallbackPool.get(
					toComputeSampledFallbackClass(samplingLayout.sampleType)
				).view;
				resource = resourceRegistry.registerTexture({
					logicalId: key,
					sampledView: fallbackView,
					format: config.format,
					mipLevelCount: 1,
					sampleType: samplingLayout.sampleType,
					usage: sampledFallbackUsage
				});
			}

			const runtimeBinding: RuntimeTextureBinding = {
				key,
				resource,
				samplerBinding,
				textureBinding,
				fragmentVisible,
				sampler,
				fallbackView,
				source: null,
				samplerType: samplingLayout.samplerType,
				effectiveFilter: samplingLayout.effectiveFilter,
				colorSpace: config.colorSpace,
				defaultColorSpace: config.colorSpace,
				flipY: config.flipY,
				defaultFlipY: config.flipY,
				generateMipmaps: config.generateMipmaps,
				defaultGenerateMipmaps: config.generateMipmaps,
				premultipliedAlpha: config.premultipliedAlpha,
				defaultPremultipliedAlpha: config.premultipliedAlpha,
				update: config.update ?? 'once',
				lastToken: null,
				mipmapsDirty: false,
				feedbackViewActive: false
			};

			if (config.update !== undefined) {
				runtimeBinding.defaultUpdate = config.update;
			}

			return runtimeBinding;
		});
		const textureBindingByKey = new Map(textureBindings.map((binding) => [binding.key, binding]));
		const fragmentTextureBindings = textureBindings.filter((binding) => binding.fragmentVisible);

		const bindGroupLayout = device.createBindGroupLayout({
			entries: createBindGroupLayoutEntries(fragmentTextureBindings)
		});
		const fragmentStorageBindGroupLayout =
			storageBufferKeys.length > 0
				? device.createBindGroupLayout({
						entries: storageBufferKeys.map((_, index) => ({
							binding: index,
							visibility: GPUShaderStage.FRAGMENT,
							buffer: { type: 'read-only-storage' as GPUBufferBindingType }
						}))
					})
				: null;
		const pipelineLayout = device.createPipelineLayout({
			bindGroupLayouts: fragmentStorageBindGroupLayout
				? [bindGroupLayout, fragmentStorageBindGroupLayout]
				: [bindGroupLayout]
		});

		const pipeline = device.createRenderPipeline({
			layout: pipelineLayout,
			vertex: {
				module: shaderModule,
				entryPoint: 'spektralVertex'
			},
			fragment: {
				module: shaderModule,
				entryPoint: 'spektralFragmentMain',
				targets: [{ format: scenePipelineFormat }]
			},
			primitive: {
				topology: 'triangle-list'
			}
		});
		const directCanvasPipeline = directCanvasShaderModule
			? device.createRenderPipeline({
					layout: pipelineLayout,
					vertex: {
						module: directCanvasShaderModule,
						entryPoint: 'spektralVertex'
					},
					fragment: {
						module: directCanvasShaderModule,
						entryPoint: 'spektralFragmentMain',
						targets: [{ format: colorPipeline.canvasFormat }]
					},
					primitive: {
						topology: 'triangle-list'
					}
				})
			: null;

		const presentationBindGroupLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: presentationSamplingLayout.samplerType }
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: presentationSamplingLayout.sampleType,
						viewDimension: '2d',
						multisampled: false
					}
				}
			]
		});
		const presentationPipelineLayout = device.createPipelineLayout({
			bindGroupLayouts: [presentationBindGroupLayout]
		});
		const presentationPipelines = new Map<string, GPURenderPipeline>();
		const ensurePresentationPipeline = async (
			canvasFormat: GPUTextureFormat,
			dynamicRange: EffectiveDynamicRange,
			applyFinalTransform: boolean,
			premultiplyAlpha: boolean
		): Promise<void> => {
			await createPresentationPipeline({
				device,
				pipelineLayout: presentationPipelineLayout,
				pipelines: presentationPipelines,
				colorPipeline,
				canvasFormat,
				dynamicRange,
				applyFinalTransform,
				premultiplyAlpha,
				assertCompilation
			});
		};
		await ensurePresentationPipeline(
			colorPipeline.canvasFormat,
			colorPipeline.dynamicRange === 'auto' ? 'hdr' : colorPipeline.dynamicRange,
			true,
			true
		);
		if (colorPipeline.dynamicRange === 'auto') {
			await ensurePresentationPipeline(colorPipeline.fallbackCanvasFormat, 'sdr', true, true);
		}
		const presentationSampler = device.createSampler({
			magFilter: presentationSamplingLayout.effectiveFilter,
			minFilter: presentationSamplingLayout.effectiveFilter,
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
		let presentationBindGroupByView = new WeakMap<GPUTextureView, GPUBindGroup>();

		// ── Storage buffer allocation ────────────────────────────────────────
		const pingPongTexturePairs = new Map<ComputePassLike, PingPongTexturePair>();
		const pingPongShaderTexturePairs = new Map<PingPongShaderPassLike, PingPongShaderTexturePair>();

		for (const key of storageBufferKeys) {
			const definition = storageBufferDefinitions[key];
			if (!definition) {
				continue;
			}
			const normalized = normalizeStorageBufferDefinition(definition);
			const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
			const buffer = device.createBuffer({
				size: normalized.size,
				usage
			});
			registerInitializationCleanup(() => {
				buffer.destroy();
			});
			if (definition.initialData !== undefined && definition.initialData.byteLength > 0) {
				const data = definition.initialData;
				device.queue.writeBuffer(
					buffer,
					0,
					data.buffer as ArrayBuffer,
					data.byteOffset,
					data.byteLength
				);
			}
			resourceRegistry.registerStorageBuffer({
				logicalId: key,
				buffer,
				size: normalized.size,
				wgslType: normalized.type,
				access: normalized.access,
				usage
			});
		}
		const fragmentStorageBindGroup =
			fragmentStorageBindGroupLayout && storageBufferKeys.length > 0
				? device.createBindGroup({
						layout: fragmentStorageBindGroupLayout,
						entries: storageBufferKeys.map((key, index) => {
							const resource = resourceRegistry.requireStorageBuffer(key);
							return { binding: index, resource: { buffer: resource.buffer } };
						})
					})
				: null;

		const ensurePingPongTexturePair = (
			pass: ComputePassLike,
			logicalId: string
		): PingPongTexturePair => {
			const existing = pingPongTexturePairs.get(pass);
			if (existing && existing.logicalId === logicalId) {
				return existing;
			}
			if (existing) {
				existing.textureA.destroy();
				existing.textureB.destroy();
				pingPongTexturePairs.delete(pass);
			}

			const config = normalizedTextureDefinitions[logicalId];
			if (!config || !config.storage) {
				throw new Error(
					`PingPongComputePass resource "${logicalId}" must reference a texture declared with storage:true.`
				);
			}
			if (!config.width || !config.height) {
				throw new Error(
					`PingPongComputePass resource "${logicalId}" requires explicit texture width and height.`
				);
			}
			assertTextureAllocationSize(
				device,
				config.width,
				config.height,
				`PingPongComputePass resource "${logicalId}"`
			);

			const usage =
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.STORAGE_BINDING |
				GPUTextureUsage.COPY_DST;
			const textureA = device.createTexture({
				size: { width: config.width, height: config.height, depthOrArrayLayers: 1 },
				format: config.format,
				usage
			});
			const textureB = device.createTexture({
				size: { width: config.width, height: config.height, depthOrArrayLayers: 1 },
				format: config.format,
				usage
			});
			registerInitializationCleanup(() => {
				textureA.destroy();
			});
			registerInitializationCleanup(() => {
				textureB.destroy();
			});

			const pair: PingPongTexturePair = {
				logicalId,
				format: config.format as GPUTextureFormat,
				width: config.width,
				height: config.height,
				textureA,
				viewA: textureA.createView(),
				textureB,
				viewB: textureB.createView(),
				readFromA: true
			};
			pingPongTexturePairs.set(pass, pair);
			return pair;
		};

		const destroyPingPongShaderTexturePair = (pair: PingPongShaderTexturePair): void => {
			pair.frameBuffer.destroy();
			pair.textureA.destroy();
			pair.textureB.destroy();
		};

		const ensurePingPongShaderTexturePair = (
			pass: PingPongShaderPassLike,
			options: {
				target: string;
				width: number;
				height: number;
				format: GPUTextureFormat;
				filter: GPUFilterMode;
				addressModeU: GPUAddressMode;
				addressModeV: GPUAddressMode;
			}
		): PingPongShaderTexturePair => {
			const existing = pingPongShaderTexturePairs.get(pass);
			if (
				existing &&
				existing.target === options.target &&
				existing.width === options.width &&
				existing.height === options.height &&
				existing.format === options.format &&
				existing.filter === options.filter &&
				existing.addressModeU === options.addressModeU &&
				existing.addressModeV === options.addressModeV
			) {
				return existing;
			}

			if (existing) {
				destroyPingPongShaderTexturePair(existing);
			}

			assertTextureAllocationSize(
				device,
				options.width,
				options.height,
				`PingPongShaderPass target "${options.target}"`
			);

			const usage =
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.COPY_DST;
			const textureA = device.createTexture({
				size: { width: options.width, height: options.height, depthOrArrayLayers: 1 },
				format: options.format,
				usage
			});
			const textureB = device.createTexture({
				size: { width: options.width, height: options.height, depthOrArrayLayers: 1 },
				format: options.format,
				usage
			});
			const samplingLayout = resolveTextureSamplingLayout({
				format: options.format,
				filter: options.filter,
				deviceFeatures: device.features
			});
			const sampler = device.createSampler({
				magFilter: samplingLayout.effectiveFilter,
				minFilter: samplingLayout.effectiveFilter,
				addressModeU: options.addressModeU,
				addressModeV: options.addressModeV
			});

			const pair: PingPongShaderTexturePair = {
				frameBuffer: device.createBuffer({
					size: 16,
					usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
				}),
				target: options.target,
				format: options.format,
				width: options.width,
				height: options.height,
				filter: options.filter,
				addressModeU: options.addressModeU,
				addressModeV: options.addressModeV,
				sampleType: samplingLayout.sampleType,
				samplerType: samplingLayout.samplerType,
				effectiveFilter: samplingLayout.effectiveFilter,
				textureA,
				viewA: textureA.createView(),
				textureB,
				viewB: textureB.createView(),
				sampler,
				previousBindGroupLayout: null,
				readABindGroup: null,
				readBBindGroup: null,
				needsClear: true
			};
			pingPongShaderTexturePairs.set(pass, pair);
			return pair;
		};

		// ── Compute pipeline setup ──────────────────────────────────────────
		interface ComputePipelineEntry {
			pipeline: GPUComputePipeline;
			uniformBindGroup: GPUBindGroup;
			resourceBindGroupLayout: GPUBindGroupLayout | null;
			resourceBindGroupCaches: WeakMap<object, ComputeBindGroupCache>;
			pingPongResourceBindGroupCaches: WeakMap<
				object,
				{ readA: ComputeBindGroupCache; readB: ComputeBindGroupCache }
			>;
			workgroupSize: [number, number, number];
			computeSource: string;
			topologyKey: string;
		}
		// Per-source cache state. The renderer resolves the compute source for
		// each pass once per frame and looks it up here. The state machine
		// preserves the synchronous render contract while still surfacing the
		// rich asynchronously-discovered diagnostics from getCompilationInfo()
		// and the validation error scope.
		//
		// State transitions:
		//   (miss) → pending → ready    (compilation succeeded)
		//                    → error    (compilation failed)
		//
		// `pending` carries the optimistically-built entry so the first frame
		// after a source change can still dispatch (matching the prior
		// synchronous behaviour). If validation later reports an error the
		// cache is upgraded and the next render() call surfaces a fully
		// attributed Error from the compute-pass loop instead of letting the
		// derivative "[Invalid CommandBuffer] is invalid due to a previous
		// error" cascade reach the user.
		type ComputePipelineCacheState =
			| { kind: 'pending'; entry: ComputePipelineEntry; validation: Promise<void> }
			| { kind: 'ready'; entry: ComputePipelineEntry }
			| { kind: 'error'; error: Error };
		const MAX_COMPUTE_PIPELINE_CACHE_ENTRIES = 32;
		const computePipelineCache = new Map<string, ComputePipelineCacheState>();
		let nextComputePipelineLabelIndex = 0;
		const computeResourceLimits = getComputeResourceResolverLimits(device);
		const computeResourceResolutionCache = createComputePassResourceResolutionCache();
		const computeUniformTopologyKey = options.uniformLayout.entries
			.map((entry) => `${entry.name}:${entry.type}`)
			.join(',');
		const computeDeviceCapabilityKey = [
			...Array.from(device.features as Iterable<string>).sort(),
			...Object.entries(computeResourceLimits).map(([name, value]) => `${name}:${value}`)
		].join(',');

		const requestRender = options.requestRender;

		const setComputePipelineCacheState = (
			cacheKey: string,
			state: ComputePipelineCacheState
		): void => {
			if (computePipelineCache.has(cacheKey)) {
				computePipelineCache.delete(cacheKey);
			}
			computePipelineCache.set(cacheKey, state);
			while (computePipelineCache.size > MAX_COMPUTE_PIPELINE_CACHE_ENTRIES) {
				const oldestKey = computePipelineCache.keys().next().value;
				if (oldestKey === undefined) {
					break;
				}
				computePipelineCache.delete(oldestKey);
			}
		};

		const touchComputePipelineCacheState = (
			cacheKey: string,
			state: ComputePipelineCacheState
		): void => {
			computePipelineCache.delete(cacheKey);
			computePipelineCache.set(cacheKey, state);
		};

		const computeBuildResult = (
			cacheKey: string,
			buildOptions: {
				computeSource: string;
				workgroupSize: [number, number, number];
				resources: ResolvedComputePassResources;
			}
		): ComputePipelineCacheState => {
			const builtComputeShader = buildComputeShaderSourceWithMap({
				compute: buildOptions.computeSource,
				uniformLayout: options.uniformLayout,
				resources: buildOptions.resources.entries
			});

			const labelIndex = (nextComputePipelineLabelIndex += 1);
			const labelBase = `compute[${buildOptions.resources.topologyKey || 'uniforms-only'}]#${labelIndex}`;
			const moduleLabel = `${labelBase}:module`;
			const pipelineLabel = `${labelBase}:pipeline`;

			const workgroupSize = [...buildOptions.workgroupSize] as [number, number, number];

			// group(0) is fixed uniforms; optional group(1) is the resolved heterogeneous topology.
			const computeUniformBGL = device.createBindGroupLayout({
				label: `${labelBase}:bgl-uniforms`,
				entries: [
					{
						binding: FRAME_BINDING,
						visibility: GPUShaderStage.COMPUTE,
						buffer: { type: 'uniform', minBindingSize: 16 }
					},
					{
						binding: UNIFORM_BINDING,
						visibility: GPUShaderStage.COMPUTE,
						buffer: { type: 'uniform' }
					}
				]
			});

			const resourceBindGroupLayout =
				buildOptions.resources.entries.length > 0
					? device.createBindGroupLayout({
							label: `${labelBase}:bgl-resources`,
							entries: buildOptions.resources.entries.map((entry) => entry.layoutEntry)
						})
					: null;
			const bindGroupLayouts: GPUBindGroupLayout[] = [computeUniformBGL];
			if (resourceBindGroupLayout) bindGroupLayouts.push(resourceBindGroupLayout);

			const computePipelineLayout = device.createPipelineLayout({
				label: `${labelBase}:layout`,
				bindGroupLayouts
			});

			// Wrap the validation-prone calls in an error scope so the parser
			// error and "invalid module/pipeline" cascade are captured here
			// instead of leaking to `uncapturederror`. The popped scope is
			// awaited together with `getCompilationInfo()` below.
			device.pushErrorScope('validation');
			let computeShaderModule: GPUShaderModule;
			let pipeline: GPUComputePipeline;
			try {
				computeShaderModule = device.createShaderModule({
					label: moduleLabel,
					code: builtComputeShader.code
				});
				pipeline = device.createComputePipeline({
					label: pipelineLabel,
					layout: computePipelineLayout,
					compute: {
						module: computeShaderModule,
						entryPoint: 'compute'
					}
				});
			} catch (jsError) {
				// Always pop the scope even when the synchronous call threw,
				// otherwise the scope would leak. Real WebGPU implementations
				// rarely throw synchronously for shader compilation issues —
				// this branch primarily serves test mocks that simulate a
				// thrown `createComputePipeline`.
				void device.popErrorScope().catch(() => {
					// Discard popped error in the synchronous-throw branch —
					// we already have the JS exception with full context.
				});
				const error = toComputeCompilationError({
					error: jsError,
					lineMap: builtComputeShader.lineMap,
					computeSource: buildOptions.computeSource,
					runtimeContext
				});
				return { kind: 'error', error };
			}

			const validationScope = device.popErrorScope();

			// Build uniform bind group for compute (group 0)
			const computeUniformBindGroup = device.createBindGroup({
				label: `${labelBase}:bg-uniforms`,
				layout: computeUniformBGL,
				entries: [
					{ binding: FRAME_BINDING, resource: { buffer: frameBuffer } },
					{ binding: UNIFORM_BINDING, resource: { buffer: uniformBuffer } }
				]
			});

			const entry: ComputePipelineEntry = {
				pipeline,
				uniformBindGroup: computeUniformBindGroup,
				resourceBindGroupLayout,
				resourceBindGroupCaches: new WeakMap(),
				pingPongResourceBindGroupCaches: new WeakMap(),
				workgroupSize,
				computeSource: buildOptions.computeSource,
				topologyKey: buildOptions.resources.topologyKey
			};

			const validation = (async () => {
				const compilationError = await assertComputeCompilationAsync({
					module: computeShaderModule,
					validationScope,
					lineMap: builtComputeShader.lineMap,
					computeSource: buildOptions.computeSource,
					runtimeContext
				});
				if (isDestroyed) {
					return;
				}
				// Only upgrade state if no later cache-miss has already replaced
				// us (defensive — the cache is keyed by source so this should
				// be a no-op in practice, but it guards against in-flight
				// stragglers when the user edits the same source rapidly).
				const current = computePipelineCache.get(cacheKey);
				if (!current || current.kind !== 'pending') {
					return;
				}
				if (compilationError) {
					setComputePipelineCacheState(cacheKey, {
						kind: 'error',
						error: compilationError
					});
					// Drain any derivative-cascade noise queued by the
					// optimistic dispatch so the next render() call doesn't
					// throw "[Invalid CommandBuffer] is invalid due to a
					// previous error" before our rich diagnostic surfaces.
					uncapturedErrorMessages.length = 0;
					requestRender?.();
				} else {
					setComputePipelineCacheState(cacheKey, { kind: 'ready', entry });
				}
			})();

			return { kind: 'pending', entry, validation };
		};

		const buildComputePipelineEntry = (buildOptions: {
			computeSource: string;
			workgroupSize: [number, number, number];
			resources: ResolvedComputePassResources;
		}): ComputePipelineEntry => {
			const cacheKey = `compute:${computeUniformTopologyKey}:${buildOptions.resources.topologyKey}:${computeDeviceCapabilityKey}:${buildOptions.workgroupSize.join(',')}:${buildOptions.computeSource}`;
			const cached = computePipelineCache.get(cacheKey);
			if (cached) {
				touchComputePipelineCacheState(cacheKey, cached);
				if (cached.kind === 'error') {
					// Drain any derivative cascade messages that may have
					// arrived between frames so consumeUncapturedErrorMessage
					// in the next render() call doesn't surface them.
					uncapturedErrorMessages.length = 0;
					throw cached.error;
				}
				return cached.entry;
			}

			const state = computeBuildResult(cacheKey, buildOptions);
			setComputePipelineCacheState(cacheKey, state);
			if (state.kind === 'error') {
				uncapturedErrorMessages.length = 0;
				throw state.error;
			}
			return state.entry;
		};

		interface PingPongShaderPipelineEntry {
			pipeline: GPURenderPipeline;
			bindGroupLayout: GPUBindGroupLayout;
			previousBindGroupLayout: GPUBindGroupLayout;
			textureKeys: string[];
		}
		const pingPongShaderPipelineCache = new Map<string, PingPongShaderPipelineEntry>();

		const getFragmentTextureBindingsForKeys = (keys: string[]): RuntimeTextureBinding[] =>
			keys.map((key, index) => {
				const binding = textureBindingByKey.get(key);
				if (!binding || !binding.fragmentVisible) {
					throw new Error(`Missing fragment texture binding for "${key}".`);
				}
				return {
					...binding,
					...getTextureBindings(index)
				};
			});

		const buildPingPongShaderPipelineEntry = (
			pass: PingPongShaderPassLike,
			format: GPUTextureFormat,
			target: string
		): PingPongShaderPipelineEntry => {
			assertFloatSampledFormat({
				format,
				target,
				pass: 'PingPongShaderPass',
				deviceFeatures: device.features
			});
			assertFloatRenderableFormat({
				format,
				target,
				pass: 'PingPongShaderPass',
				deviceFeatures: device.features
			});
			const fragment = pass.getFragment();
			if (!fragment) {
				throw new Error('PingPongShaderPass must provide a fragment shader.');
			}

			const feedbackTextureKeys = fragmentTextureKeys.filter((key) => key !== target);
			const previousSamplingLayout = resolveTextureSamplingLayout({
				format,
				filter: pass.getFilter(),
				deviceFeatures: device.features
			});
			const cacheKey = [
				format,
				target,
				previousSamplingLayout.sampleType,
				previousSamplingLayout.samplerType,
				previousSamplingLayout.effectiveFilter,
				feedbackTextureKeys.join(','),
				options.uniformLayout.entries.map((entry) => `${entry.name}:${entry.type}`).join(','),
				fragment
			].join('|');
			const cached = pingPongShaderPipelineCache.get(cacheKey);
			if (cached) {
				return cached;
			}

			const fragmentLineMap = pass.getFragmentLineMap();
			const builtShader = buildPingPongShaderSourceWithMap(
				fragment,
				options.uniformLayout,
				feedbackTextureKeys,
				{ fragmentLineMap }
			);
			const shaderModule = device.createShaderModule({ code: builtShader.code });
			const feedbackBindGroupLayout = device.createBindGroupLayout({
				entries: createBindGroupLayoutEntries(
					getFragmentTextureBindingsForKeys(feedbackTextureKeys)
				)
			});
			const previousBindGroupLayout = device.createBindGroupLayout({
				entries: [
					{
						binding: 0,
						visibility: GPUShaderStage.FRAGMENT,
						sampler: { type: previousSamplingLayout.samplerType }
					},
					{
						binding: 1,
						visibility: GPUShaderStage.FRAGMENT,
						texture: {
							sampleType: previousSamplingLayout.sampleType,
							viewDimension: '2d',
							multisampled: false
						}
					}
				]
			});
			const pipelineLayout = device.createPipelineLayout({
				bindGroupLayouts: [feedbackBindGroupLayout, previousBindGroupLayout]
			});
			const pipeline = device.createRenderPipeline({
				layout: pipelineLayout,
				vertex: {
					module: shaderModule,
					entryPoint: 'spektralPingPongVertex'
				},
				fragment: {
					module: shaderModule,
					entryPoint: 'spektralPingPongFragment',
					targets: [{ format }]
				},
				primitive: {
					topology: 'triangle-list'
				}
			});
			const entry = {
				pipeline,
				bindGroupLayout: feedbackBindGroupLayout,
				previousBindGroupLayout,
				textureKeys: feedbackTextureKeys
			};
			pingPongShaderPipelineCache.set(cacheKey, entry);
			return entry;
		};

		const getComputeBindingResource = (entry: ResolvedComputeResource): GPUBindingResource => {
			if (entry.source === 'external') return entry.bindingResource;
			const logicalId = String(entry.logicalId);
			switch (entry.kind) {
				case 'sampled-texture': {
					const resource = resourceRegistry.requireTexture(logicalId);
					if (
						entry.subresource.baseMipLevel === 0 &&
						entry.subresource.mipLevelCount === resource.mipLevelCount
					) {
						return resource.publishedView;
					}
					return entry.bindingResource;
				}
				case 'storage-texture': {
					const view = resourceRegistry.requireTexture(logicalId).storageView;
					if (!view) throw new Error(`Storage texture "${logicalId}" is not allocated.`);
					return view;
				}
				case 'storage-buffer': {
					const buffer = resourceRegistry.requireStorageBuffer(logicalId).buffer;
					return { buffer, size: entry.size };
				}
				case 'sampler': {
					const binding = textureBindingByKey.get(logicalId);
					if (!binding) throw new Error(`Material sampler "${logicalId}" is not available.`);
					return binding.sampler;
				}
			}
		};

		const getBindingReference = (resource: GPUBindingResource): unknown =>
			'buffer' in resource ? resource.buffer : resource;

		const createResolvedBindGroupEntries = (
			resources: ResolvedComputePassResources,
			pingPong?: { pair: PingPongTexturePair; readFromA: boolean }
		): { entries: GPUBindGroupEntry[]; refs: unknown[] } => {
			const entries: GPUBindGroupEntry[] = [];
			const refs: unknown[] = [];
			for (const entry of resources.entries) {
				let resource = getComputeBindingResource(entry);
				if (pingPong && entry.kind === 'sampled-texture' && entry.pingPong === 'read') {
					resource = pingPong.readFromA ? pingPong.pair.viewA : pingPong.pair.viewB;
				} else if (pingPong && entry.kind === 'storage-texture' && entry.pingPong === 'write') {
					resource = pingPong.readFromA ? pingPong.pair.viewB : pingPong.pair.viewA;
				}
				entries.push({ binding: entry.binding, resource });
				refs.push(getBindingReference(resource));
			}
			return { entries, refs };
		};

		const getComputeResourceBindGroup = (
			pipelineEntry: ComputePipelineEntry,
			pass: ComputePassLike,
			resources: ResolvedComputePassResources
		): GPUBindGroup | null => {
			if (!pipelineEntry.resourceBindGroupLayout) return null;
			let cache = pipelineEntry.resourceBindGroupCaches.get(pass as object);
			if (!cache) {
				cache = createComputeBindGroupCache(device);
				pipelineEntry.resourceBindGroupCaches.set(pass as object, cache);
			}
			const runtimeEntries = createResolvedBindGroupEntries(resources);
			return cache.getOrCreate({
				topologyKey: resources.topologyKey,
				layout: pipelineEntry.resourceBindGroupLayout,
				entries: runtimeEntries.entries,
				resourceRefs: runtimeEntries.refs
			});
		};

		const getPingPongResourceBindGroup = (
			pipelineEntry: ComputePipelineEntry,
			pass: ComputePassLike,
			resources: ResolvedComputePassResources,
			pair: PingPongTexturePair,
			readFromA: boolean
		): GPUBindGroup => {
			if (!pipelineEntry.resourceBindGroupLayout) {
				throw new Error('Ping-pong compute pipeline is missing its resource bind group layout.');
			}
			let caches = pipelineEntry.pingPongResourceBindGroupCaches.get(pass as object);
			if (!caches) {
				caches = {
					readA: createComputeBindGroupCache(device),
					readB: createComputeBindGroupCache(device)
				};
				pipelineEntry.pingPongResourceBindGroupCaches.set(pass as object, caches);
			}
			const runtimeEntries = createResolvedBindGroupEntries(resources, { pair, readFromA });
			const bindGroup = (readFromA ? caches.readA : caches.readB).getOrCreate({
				topologyKey: resources.topologyKey,
				layout: pipelineEntry.resourceBindGroupLayout,
				entries: runtimeEntries.entries,
				resourceRefs: runtimeEntries.refs
			});
			if (!bindGroup) throw new Error('Ping-pong compute resource bind group is empty.');
			return bindGroup;
		};

		let externalTextureViewCache = new WeakMap<GPUTexture, Map<string, GPUTextureView>>();
		const createCachedExternalTextureView = (
			texture: GPUTexture,
			descriptor: GPUTextureViewDescriptor
		): GPUTextureView => {
			const key = [
				descriptor.dimension ?? '2d',
				descriptor.baseMipLevel ?? 0,
				descriptor.mipLevelCount ?? 1,
				descriptor.baseArrayLayer ?? 0,
				descriptor.arrayLayerCount ?? 1
			].join(':');
			let views = externalTextureViewCache.get(texture);
			if (!views) {
				views = new Map();
				externalTextureViewCache.set(texture, views);
			}
			let view = views.get(key);
			if (!view) {
				view = texture.createView(descriptor);
				views.set(key, view);
			}
			return view;
		};

		const getPingPongShaderPreviousBindGroup = (
			pair: PingPongShaderTexturePair,
			layout: GPUBindGroupLayout,
			readFromA: boolean
		): GPUBindGroup => {
			if (pair.previousBindGroupLayout !== layout) {
				pair.previousBindGroupLayout = layout;
				pair.readABindGroup = null;
				pair.readBBindGroup = null;
			}

			if (readFromA) {
				if (!pair.readABindGroup) {
					pair.readABindGroup = device.createBindGroup({
						layout,
						entries: [
							{ binding: 0, resource: pair.sampler },
							{ binding: 1, resource: pair.viewA }
						]
					});
				}
				return pair.readABindGroup;
			}

			if (!pair.readBBindGroup) {
				pair.readBBindGroup = device.createBindGroup({
					layout,
					entries: [
						{ binding: 0, resource: pair.sampler },
						{ binding: 1, resource: pair.viewB }
					]
				});
			}
			return pair.readBBindGroup;
		};

		const frameBuffer = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		registerInitializationCleanup(() => {
			frameBuffer.destroy();
		});

		const uniformBuffer = device.createBuffer({
			size: options.uniformLayout.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});
		registerInitializationCleanup(() => {
			uniformBuffer.destroy();
		});
		const frameScratch = new Float32Array(4);
		const uniformScratch = new Float32Array(options.uniformLayout.byteLength / 4);
		const uniformPrevious = new Float32Array(options.uniformLayout.byteLength / 4);
		let hasUniformSnapshot = false;
		const mipmapGenerator = createGpuMipmapGenerator(device);

		const writeFrameBuffer = (
			time: number,
			delta: number,
			width: number,
			height: number,
			destination = frameBuffer
		): void => {
			frameScratch[0] = time;
			frameScratch[1] = delta;
			frameScratch[2] = width;
			frameScratch[3] = height;
			device.queue.writeBuffer(
				destination,
				0,
				frameScratch.buffer as ArrayBuffer,
				frameScratch.byteOffset,
				frameScratch.byteLength
			);
		};

		/**
		 * Rebuilds a fragment bind group using current texture views.
		 */
		const createTextureBindGroup = (
			layout: GPUBindGroupLayout,
			bindings: RuntimeTextureBinding[],
			frameUniformBuffer = frameBuffer
		): GPUBindGroup => {
			const entries: GPUBindGroupEntry[] = [
				{ binding: FRAME_BINDING, resource: { buffer: frameUniformBuffer } },
				{ binding: UNIFORM_BINDING, resource: { buffer: uniformBuffer } }
			];

			for (const binding of bindings) {
				entries.push({
					binding: binding.samplerBinding,
					resource: binding.sampler
				});
				entries.push({
					binding: binding.textureBinding,
					resource: binding.resource.publishedView
				});
			}

			return device.createBindGroup({
				layout,
				entries
			});
		};

		const createBindGroup = (): GPUBindGroup =>
			createTextureBindGroup(bindGroupLayout, fragmentTextureBindings);

		const createPingPongShaderBindGroup = (
			entry: PingPongShaderPipelineEntry,
			frameUniformBuffer: GPUBuffer
		): GPUBindGroup =>
			createTextureBindGroup(
				entry.bindGroupLayout,
				getFragmentTextureBindingsForKeys(entry.textureKeys),
				frameUniformBuffer
			);

		const attachFeedbackTextureBinding = (
			binding: RuntimeTextureBinding,
			view: GPUTextureView
		): boolean => {
			const resource = binding.resource;
			const changed = resource.publishedView !== view || !binding.feedbackViewActive;
			resource.ownedTexture?.destroy();
			resourceRegistry.replaceTextureAllocation(binding.key, {
				ownedTexture: null,
				storageView: null,
				sampledView: binding.fallbackView,
				format: resource.format,
				width: undefined,
				height: undefined,
				mipLevelCount: 1,
				usage: sampledFallbackUsage
			});
			resourceRegistry.publishTextureView(binding.key, view);
			binding.feedbackViewActive = true;
			binding.source = null;
			binding.lastToken = null;
			binding.mipmapsDirty = false;
			return changed;
		};

		/**
		 * Synchronizes one runtime texture binding with incoming texture value.
		 *
		 * @returns `true` when bind group must be rebuilt.
		 */
		const updateTextureBinding = (
			binding: RuntimeTextureBinding,
			value: TextureValue,
			renderMode: RenderMode
		): boolean => {
			const nextData = toTextureData(value);
			const resource = binding.resource;

			if (!nextData) {
				if (
					binding.source === null &&
					resource.ownedTexture === null &&
					!binding.feedbackViewActive
				) {
					return false;
				}

				resource.ownedTexture?.destroy();
				const changed = resourceRegistry.replaceTextureAllocation(binding.key, {
					ownedTexture: null,
					storageView: null,
					sampledView: binding.fallbackView,
					format: resource.format,
					width: undefined,
					height: undefined,
					mipLevelCount: 1,
					usage: sampledFallbackUsage
				});
				binding.feedbackViewActive = false;
				binding.source = null;
				binding.lastToken = null;
				binding.mipmapsDirty = false;
				return changed;
			}

			const source = nextData.source;
			const colorSpace = nextData.colorSpace ?? binding.defaultColorSpace;
			// Implicit formats follow the current source's decode policy. Both choices
			// use the same float sampling layout; explicit formats remain authoritative.
			const format =
				options.textureDefinitions[binding.key]?.format ??
				(colorSpace === 'linear' ? 'rgba8unorm' : 'rgba8unorm-srgb');
			const flipY = nextData.flipY ?? binding.defaultFlipY;
			const premultipliedAlpha = nextData.premultipliedAlpha ?? binding.defaultPremultipliedAlpha;
			const generateMipmaps = nextData.generateMipmaps ?? binding.defaultGenerateMipmaps;
			const update = resolveTextureUpdateMode({
				source,
				...(nextData.update !== undefined ? { override: nextData.update } : {}),
				...(binding.defaultUpdate !== undefined ? { defaultMode: binding.defaultUpdate } : {})
			});
			const { width, height } = resolveTextureSize(nextData);
			assertTextureAllocationSize(device, width, height, `Texture "${binding.key}"`);
			const mipLevelCount = generateMipmaps ? getTextureMipLevelCount(width, height) : 1;
			const sourceChanged = binding.source !== source;
			const tokenChanged = binding.lastToken !== value;
			const requiresReallocation =
				resource.ownedTexture === null ||
				binding.feedbackViewActive ||
				resource.width !== width ||
				resource.height !== height ||
				resource.mipLevelCount !== mipLevelCount ||
				resource.format !== format;

			if (!requiresReallocation) {
				const shouldUpload =
					sourceChanged ||
					update === 'perFrame' ||
					(update === 'onInvalidate' && (renderMode !== 'always' || tokenChanged));

				if (shouldUpload && resource.ownedTexture) {
					uploadTextureBaseLevel(
						device,
						resource.ownedTexture,
						{ flipY, premultipliedAlpha },
						source,
						width,
						height
					);
					binding.flipY = flipY;
					binding.generateMipmaps = generateMipmaps;
					binding.premultipliedAlpha = premultipliedAlpha;
					binding.colorSpace = colorSpace;
					markTextureMipmapsDirty(binding, mipLevelCount);
				}

				binding.source = source;
				binding.update = update;
				binding.lastToken = value;
				binding.feedbackViewActive = false;
				return false;
			}

			let textureUsage =
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT;
			if (storageTextureKeySet.has(binding.key)) {
				textureUsage |= GPUTextureUsage.STORAGE_BINDING;
			}
			const texture = device.createTexture({
				size: { width, height, depthOrArrayLayers: 1 },
				format,
				mipLevelCount,
				usage: textureUsage
			});
			let view: GPUTextureView;
			try {
				uploadTextureBaseLevel(
					device,
					texture,
					{ flipY, premultipliedAlpha },
					source,
					width,
					height
				);
				view = texture.createView();
			} catch (error) {
				texture.destroy();
				throw error;
			}
			registerInitializationCleanup(() => {
				texture.destroy();
			});

			resource.ownedTexture?.destroy();
			const publishedViewChanged = resourceRegistry.replaceTextureAllocation(binding.key, {
				ownedTexture: texture,
				storageView: storageTextureKeySet.has(binding.key) ? view : null,
				sampledView: view,
				format,
				width,
				height,
				mipLevelCount,
				usage: textureUsage
			});
			binding.feedbackViewActive = false;
			binding.source = source;
			binding.update = update;
			binding.flipY = flipY;
			binding.generateMipmaps = generateMipmaps;
			binding.premultipliedAlpha = premultipliedAlpha;
			binding.colorSpace = colorSpace;
			binding.lastToken = value;
			markTextureMipmapsDirty(binding, mipLevelCount);
			return publishedViewChanged;
		};

		const generateDirtyTextureMipmaps = (commandEncoder: GPUCommandEncoder): void => {
			for (const binding of textureBindings) {
				const resource = binding.resource;
				if (
					!binding.mipmapsDirty ||
					!resource.ownedTexture ||
					!binding.generateMipmaps ||
					resource.mipLevelCount <= 1
				) {
					continue;
				}

				mipmapGenerator.generate({
					commandEncoder,
					texture: resource.ownedTexture,
					format: resource.format,
					mipLevelCount: resource.mipLevelCount
				});
				binding.mipmapsDirty = false;
			}
		};

		for (const binding of textureBindings) {
			// Skip storage textures — they are eagerly allocated and not source-driven
			if (normalizedTextureDefinitions[binding.key]?.storage) continue;
			const defaultSource = normalizedTextureDefinitions[binding.key]?.source ?? null;
			updateTextureBinding(binding, defaultSource, 'always');
		}

		let bindGroup = createBindGroup();
		let sourceSlotTarget: RuntimeRenderTarget | null = null;
		let targetSlotTarget: RuntimeRenderTarget | null = null;
		let presentationSlotTarget: RuntimeRenderTarget | null = null;
		let renderTargetSignature = '';
		let renderTargetSnapshot: Readonly<Record<string, RenderTarget>> = {};
		let renderTargetFormatSnapshot: RenderTargetFormatMap = {};
		let renderTargetKeys: string[] = [];
		let cachedGraphPlan: RenderGraphPlan | null = null;
		const resolvedComputeResourcesByPass = new Map<AnyPass, ResolvedComputePassResources>();
		const computeLabelsByPass = new Map<AnyPass, string>();
		let cachedGraphRenderTargetSignature = '';
		const cachedGraphClearColor: [number, number, number, number] = [NaN, NaN, NaN, NaN];
		const cachedGraphPasses: RenderGraphPassSnapshot[] = [];
		let contextConfigured = false;
		let configuredWidth = 0;
		let configuredHeight = 0;
		let configuredCanvasFormat: GPUTextureFormat | null = null;
		let configuredDynamicRange: EffectiveDynamicRange | null = null;
		const runtimeRenderTargets = new Map<string, RuntimeRenderTarget>();
		const activePasses: AnyPass[] = [];
		const lifecyclePreviousSet = new Set<AnyPass>();
		const lifecycleNextSet = new Set<AnyPass>();
		const lifecycleUniquePasses: AnyPass[] = [];
		let lifecyclePassesRef: AnyPass[] | null = null;
		let passWidth = 0;
		let passHeight = 0;

		/**
		 * Pre-allocated canvas surface object mutated in-place each frame.
		 *
		 * Avoids creating a new `RenderTarget` object on every `render()` call.
		 * The `texture` and `view` fields are replaced with the current
		 * swapchain texture before use.
		 */
		const canvasSurface: RenderTarget = {
			texture: null as unknown as GPUTexture,
			view: null as unknown as GPUTextureView,
			width: 0,
			height: 0,
			format: effectiveCanvasFormat
		};

		/**
		 * Pre-allocated slots object mutated in-place each frame when passes are active.
		 *
		 * Avoids a new `{ source, target, canvas }` allocation on every `render()` call.
		 */
		const frameSlots = {
			source: null as unknown as RuntimeRenderTarget,
			target: null as unknown as RuntimeRenderTarget,
			canvas: canvasSurface
		};
		let frameSlotsActive = false;

		/**
		 * Resolves active render pass list for current frame.
		 */
		const resolvePasses = (): AnyPass[] => {
			return options.getPasses?.() ?? options.passes ?? [];
		};

		/**
		 * Resolves active render target declarations for current frame.
		 */
		const resolveRenderTargets = () => {
			return options.getRenderTargets?.() ?? options.renderTargets;
		};

		/**
		 * Checks whether cached render-graph plan can be reused for this frame.
		 */
		const isGraphPlanCacheValid = (
			passes: AnyPass[],
			clearColor: [number, number, number, number]
		): boolean => {
			return isRenderGraphPlanCacheValid({
				cachedPlan: cachedGraphPlan,
				cachedRenderTargetSignature: cachedGraphRenderTargetSignature,
				renderTargetSignature,
				cachedClearColor: cachedGraphClearColor,
				clearColor,
				cachedPasses: cachedGraphPasses,
				passes
			});
		};

		/**
		 * Updates render-graph cache with current pass set.
		 */
		const updateGraphPlanCache = (
			passes: AnyPass[],
			clearColor: [number, number, number, number],
			graphPlan: RenderGraphPlan
		): void => {
			cachedGraphPlan = graphPlan;
			cachedGraphRenderTargetSignature = renderTargetSignature;
			cachedGraphClearColor[0] = clearColor[0];
			cachedGraphClearColor[1] = clearColor[1];
			cachedGraphClearColor[2] = clearColor[2];
			cachedGraphClearColor[3] = clearColor[3];
			updateRenderGraphPassSnapshots(cachedGraphPasses, passes);
		};

		const releasePassLifecycle = (pass: AnyPass): void => {
			if (isManagedComputePass(pass)) {
				computeResourceResolutionCache.delete(pass);
				pass.dispose?.();
				return;
			}
			if (isPreparedFullscreenPass(pass)) {
				pendingDynamicFullscreenPasses.delete(pass);
				failedDynamicFullscreenPasses.delete(pass);
				if (preparedFullscreenPasses.delete(pass)) {
					releasePreparedFullscreenPass(pass, device, fullscreenPassOwner);
				}
				return;
			}
			pass.dispose?.();
		};

		const resolveFramePasses = (passes: AnyPass[]): AnyPass[] => {
			const unpreparedFullscreenPasses = new Set<AnyPass>();
			for (const candidate of passes) {
				const preparation = resolveFullscreenPassPreparation({
					candidate,
					workingFormat,
					namedFormats: renderTargetFormatSnapshot
				});
				if (!preparation) continue;
				if (isFullscreenPassPreparationReady(preparation, device)) {
					pendingDynamicFullscreenPasses.delete(preparation.pass);
					failedDynamicFullscreenPasses.delete(preparation.pass);
					continue;
				}

				unpreparedFullscreenPasses.add(preparation.pass);
				const pendingKey = pendingDynamicFullscreenPasses.get(preparation.pass);
				const failedKey = failedDynamicFullscreenPasses.get(preparation.pass);
				if (pendingKey === preparation.key || failedKey === preparation.key) continue;

				preparedFullscreenPasses.add(preparation.pass);
				pendingDynamicFullscreenPasses.set(preparation.pass, preparation.key);
				void Promise.resolve()
					.then(() => {
						if (isDestroyed) return;
						return prepareResolvedFullscreenPass({
							preparation,
							device,
							owner: fullscreenPassOwner,
							replaceOwnerFormats: true,
							retainOwnerOnFailure: true,
							...(options.reportAsyncError !== undefined
								? { reportRecoverableError: options.reportAsyncError }
								: {}),
							...(options.requestRender !== undefined
								? { requestRender: options.requestRender }
								: {})
						});
					})
					.then(
						() => {
							if (pendingDynamicFullscreenPasses.get(preparation.pass) !== preparation.key) {
								return;
							}
							pendingDynamicFullscreenPasses.delete(preparation.pass);
							failedDynamicFullscreenPasses.delete(preparation.pass);
							if (!isDestroyed) options.requestRender?.();
						},
						(error) => {
							if (pendingDynamicFullscreenPasses.get(preparation.pass) !== preparation.key) {
								return;
							}
							pendingDynamicFullscreenPasses.delete(preparation.pass);
							failedDynamicFullscreenPasses.set(preparation.pass, preparation.key);
							options.reportAsyncError?.(
								error instanceof Error ? error : new Error(String(error ?? 'Unknown WebGPU error'))
							);
						}
					);
			}

			if (unpreparedFullscreenPasses.size === 0) return passes;
			return passes.filter((pass) => !unpreparedFullscreenPasses.has(pass));
		};

		/**
		 * Synchronizes pass lifecycle callbacks and resize notifications.
		 */
		const syncPassLifecycle = (passes: AnyPass[], width: number, height: number): void => {
			const resized = passWidth !== width || passHeight !== height;
			if (!resized && lifecyclePassesRef === passes && passes.length === activePasses.length) {
				let isSameOrder = true;
				for (let index = 0; index < passes.length; index += 1) {
					if (activePasses[index] !== passes[index]) {
						isSameOrder = false;
						break;
					}
				}

				if (isSameOrder) {
					return;
				}
			}

			lifecycleNextSet.clear();
			lifecycleUniquePasses.length = 0;
			for (const pass of passes) {
				if (lifecycleNextSet.has(pass)) {
					continue;
				}

				lifecycleNextSet.add(pass);
				lifecycleUniquePasses.push(pass);
			}
			lifecyclePreviousSet.clear();
			for (const pass of activePasses) {
				lifecyclePreviousSet.add(pass);
			}

			for (const pass of activePasses) {
				if (!lifecycleNextSet.has(pass)) {
					releasePassLifecycle(pass);
				}
			}

			for (const pass of lifecycleUniquePasses) {
				if (resized || !lifecyclePreviousSet.has(pass)) {
					pass.setSize?.(width, height);
				}
			}

			activePasses.length = 0;
			for (const pass of lifecycleUniquePasses) {
				activePasses.push(pass);
			}
			lifecyclePassesRef = passes;
			passWidth = width;
			passHeight = height;
		};

		const syncPingPongShaderTextureLifecycle = (passes: AnyPass[]): void => {
			const activeFeedbackPasses = new Set<PingPongShaderPassLike>();
			for (const pass of passes) {
				if (isManagedFeedbackPass(pass)) {
					activeFeedbackPasses.add(pass);
				}
			}

			for (const [pass, pair] of pingPongShaderTexturePairs.entries()) {
				if (activeFeedbackPasses.has(pass)) {
					continue;
				}
				destroyPingPongShaderTexturePair(pair);
				pingPongShaderTexturePairs.delete(pass);
			}
		};

		const syncPingPongComputeTextureLifecycle = (passes: AnyPass[]): boolean => {
			const activeComputePasses = new Set(passes.filter(isManagedComputePass));
			let fragmentBindingsChanged = false;
			for (const [pass, pair] of pingPongTexturePairs.entries()) {
				if (activeComputePasses.has(pass)) continue;
				const resource = resourceRegistry.requireTexture(pair.logicalId);
				// Another pass may already own the published result for this slot.
				// Detach only views belonging to the allocation being released.
				if (resource.publishedView === pair.viewA || resource.publishedView === pair.viewB) {
					resourceRegistry.publishTextureView(pair.logicalId, resource.sampledView);
					if (textureBindingByKey.get(pair.logicalId)?.fragmentVisible) {
						fragmentBindingsChanged = true;
					}
				}
				pair.textureA.destroy();
				pair.textureB.destroy();
				pingPongTexturePairs.delete(pass);
			}
			return fragmentBindingsChanged;
		};

		/**
		 * Ensures internal ping-pong slot texture matches current canvas size/format.
		 */
		const ensureSlotTarget = (
			slot: RenderPassInputSlot,
			width: number,
			height: number
		): RuntimeRenderTarget => {
			const current = slot === 'source' ? sourceSlotTarget : targetSlotTarget;
			if (
				current &&
				current.width === width &&
				current.height === height &&
				current.format === workingFormat
			) {
				return current;
			}

			destroyRenderTexture(current);
			const next = createRenderTexture(device, width, height, workingFormat);
			if (slot === 'source') {
				sourceSlotTarget = next;
			} else {
				targetSlotTarget = next;
			}

			return next;
		};

		const ensurePresentationTarget = (width: number, height: number): RuntimeRenderTarget => {
			if (
				presentationSlotTarget &&
				presentationSlotTarget.width === width &&
				presentationSlotTarget.height === height &&
				presentationSlotTarget.format === workingFormat
			) {
				return presentationSlotTarget;
			}

			destroyRenderTexture(presentationSlotTarget);
			presentationSlotTarget = createRenderTexture(device, width, height, workingFormat);
			return presentationSlotTarget;
		};

		/**
		 * Creates/updates runtime render targets and returns immutable pass snapshot.
		 */
		const syncRenderTargets = (
			canvasWidth: number,
			canvasHeight: number
		): Readonly<Record<string, RenderTarget>> => {
			const definitions = resolveRenderTargets();
			const validatedFormats = validateRenderTargetFormats(
				definitions,
				workingFormat,
				device.features
			);
			const resolvedDefinitions = resolveRenderTargetDefinitions(
				definitions,
				canvasWidth,
				canvasHeight,
				workingFormat
			);
			const nextSignature = buildRenderTargetSignature(resolvedDefinitions);

			if (nextSignature !== renderTargetSignature) {
				const activeKeys = new Set<string>();
				for (const definition of resolvedDefinitions) {
					activeKeys.add(definition.key);
				}

				for (const [key, target] of runtimeRenderTargets.entries()) {
					if (!activeKeys.has(key)) {
						target.texture.destroy();
						runtimeRenderTargets.delete(key);
					}
				}

				for (const definition of resolvedDefinitions) {
					const current = runtimeRenderTargets.get(definition.key);
					if (
						current &&
						current.width === definition.width &&
						current.height === definition.height &&
						current.format === definition.format
					) {
						continue;
					}

					current?.texture.destroy();
					runtimeRenderTargets.set(
						definition.key,
						createRenderTexture(device, definition.width, definition.height, definition.format)
					);
				}

				renderTargetSignature = nextSignature;
				const nextSnapshot: Record<string, RenderTarget> = {};
				const nextKeys: string[] = [];
				for (const definition of resolvedDefinitions) {
					const target = runtimeRenderTargets.get(definition.key);
					if (!target) {
						continue;
					}

					nextKeys.push(definition.key);
					nextSnapshot[definition.key] = {
						texture: target.texture,
						view: target.view,
						width: target.width,
						height: target.height,
						format: target.format
					};
				}

				renderTargetSnapshot = nextSnapshot;
				renderTargetFormatSnapshot = validatedFormats;
				renderTargetKeys = nextKeys;
			}

			return renderTargetSnapshot;
		};

		/**
		 * Presents a texture view to the current canvas texture.
		 */
		const present = (
			commandEncoder: GPUCommandEncoder,
			sourceView: GPUTextureView,
			canvasView: GPUTextureView,
			clearColor: [number, number, number, number],
			applyFinalTransform: boolean
		): void => {
			presentToCanvas({
				device,
				commandEncoder,
				sourceView,
				canvasView,
				clearColor,
				applyFinalTransform,
				canvasFormat: effectiveCanvasFormat,
				dynamicRange: effectiveDynamicRange,
				pipelines: presentationPipelines,
				bindGroupLayout: presentationBindGroupLayout,
				sampler: presentationSampler,
				bindGroups: presentationBindGroupByView
			});
		};

		const flushStorageWrites = (writes: Parameters<Renderer['flushStorageWrites']>[0]): void => {
			for (const write of writes) {
				const resource = resourceRegistry.getStorageBuffer(write.name);
				if (!resource) {
					continue;
				}
				const data = write.data;
				device.queue.writeBuffer(
					resource.buffer,
					write.offset,
					data.buffer as ArrayBuffer,
					data.byteOffset,
					data.byteLength
				);
			}
		};

		/**
		 * Executes a full frame render.
		 */
		const render: Renderer['render'] = ({
			time,
			delta,
			renderMode,
			uniforms,
			textures,
			canvasSize,
			pendingStorageWrites
		}) => {
			if (deviceLostMessage) {
				throw new Error(deviceLostMessage);
			}

			const uncapturedMessage = consumeUncapturedErrorMessage();
			if (uncapturedMessage) {
				const message = uncapturedMessage;
				throw new Error(message);
			}

			const { width, height } = resizeCanvas(options.canvas, options.getDpr(), canvasSize);

			if (
				!contextConfigured ||
				configuredWidth !== width ||
				configuredHeight !== height ||
				configuredCanvasFormat !== effectiveCanvasFormat ||
				configuredDynamicRange !== effectiveDynamicRange
			) {
				try {
					context.configure(
						buildCanvasConfiguration({
							device,
							format: effectiveCanvasFormat,
							dynamicRange: effectiveDynamicRange,
							canvasColorSpace: colorPipeline.canvasColorSpace
						})
					);
				} catch (error) {
					if (colorPipeline.dynamicRange !== 'auto' || effectiveDynamicRange !== 'hdr') {
						if (colorPipeline.dynamicRange === 'hdr' && effectiveDynamicRange === 'hdr') {
							const detail = error instanceof Error ? error.message : String(error);
							throw new Error(`HDR canvas presentation is not supported: ${detail}`, {
								cause: error
							});
						}
						throw error;
					}

					effectiveCanvasFormat = colorPipeline.fallbackCanvasFormat;
					effectiveDynamicRange = 'sdr';
					context.configure(
						buildCanvasConfiguration({
							device,
							format: effectiveCanvasFormat,
							dynamicRange: effectiveDynamicRange,
							canvasColorSpace: colorPipeline.canvasColorSpace
						})
					);
				}
				contextConfigured = true;
				configuredWidth = width;
				configuredHeight = height;
				configuredCanvasFormat = effectiveCanvasFormat;
				configuredDynamicRange = effectiveDynamicRange;
			}

			writeFrameBuffer(time, delta, width, height);

			packUniformsIntoFast(uniforms, options.uniformLayout, uniformScratch);
			if (!hasUniformSnapshot) {
				device.queue.writeBuffer(
					uniformBuffer,
					0,
					uniformScratch.buffer as ArrayBuffer,
					uniformScratch.byteOffset,
					uniformScratch.byteLength
				);
				uniformPrevious.set(uniformScratch);
				hasUniformSnapshot = true;
			} else {
				const dirtyRanges = findDirtyFloatRanges(uniformPrevious, uniformScratch);
				for (const range of dirtyRanges) {
					const byteOffset = range.start * 4;
					const byteLength = range.count * 4;
					device.queue.writeBuffer(
						uniformBuffer,
						byteOffset,
						uniformScratch.buffer as ArrayBuffer,
						uniformScratch.byteOffset + byteOffset,
						byteLength
					);
				}

				if (dirtyRanges.length > 0) {
					uniformPrevious.set(uniformScratch);
				}
			}

			const passes = resolvePasses();
			const activePingPongShaderTargets = new Set<string>();
			for (const pass of passes) {
				if (pass.enabled === false) {
					continue;
				}
				if (isManagedFeedbackPass(pass)) {
					const target = pass.getTarget();
					if (target) {
						activePingPongShaderTargets.add(target);
					}
				}
			}

			const commandEncoder = device.createCommandEncoder();
			let bindGroupDirty = false;
			for (const binding of textureBindings) {
				// Storage textures are managed by compute passes, skip source-driven updates
				if (normalizedTextureDefinitions[binding.key]?.storage) continue;
				if (activePingPongShaderTargets.has(binding.key)) continue;
				const runtimeTexture = textures[binding.key];
				const nextTexture =
					runtimeTexture === undefined
						? (normalizedTextureDefinitions[binding.key]?.source ?? null)
						: runtimeTexture;
				if (updateTextureBinding(binding, nextTexture, renderMode) && binding.fragmentVisible) {
					bindGroupDirty = true;
				}
			}

			if (bindGroupDirty) {
				bindGroup = createBindGroup();
				bindGroupDirty = false;
			}

			// Apply pending storage buffer writes
			if (pendingStorageWrites) {
				flushStorageWrites(pendingStorageWrites);
			}

			generateDirtyTextureMipmaps(commandEncoder);
			const clearColor = options.getClearColor();
			syncPassLifecycle(passes, width, height);
			if (syncPingPongComputeTextureLifecycle(passes)) bindGroupDirty = true;
			syncPingPongShaderTextureLifecycle(passes);
			const runtimeTargets = syncRenderTargets(width, height);
			const framePasses = resolveFramePasses(passes);
			resolvedComputeResourcesByPass.clear();
			computeLabelsByPass.clear();
			const computeExternalContext = { device, width, height, time, delta };
			let computeDeclarationIndex = 0;
			let computeResolutionFrameStarted = false;
			for (const pass of passes) {
				if (pass.enabled === false) continue;
				if (!isManagedComputePass(pass)) continue;
				if (!computeResolutionFrameStarted) {
					computeResourceResolutionCache.beginFrame();
					computeResolutionFrameStarted = true;
				}
				const passLabel = pass.label ?? `Compute pass #${computeDeclarationIndex}`;
				computeDeclarationIndex += 1;
				const resources = computeResourceResolutionCache.resolve({
					pass,
					pingPong: pass.isPingPong === true,
					context: {
						passLabel,
						deviceFeatures: device.features as ReadonlySet<string>,
						limits: computeResourceLimits,
						externalContext: computeExternalContext,
						getMaterialTexture: (logicalId) => resourceRegistry.getTexture(logicalId),
						getMaterialStorageBuffer: (logicalId) => resourceRegistry.getStorageBuffer(logicalId),
						getMaterialSampler: (logicalId) => {
							const binding = textureBindingByKey.get(logicalId);
							return binding
								? {
										logicalId,
										sampler: binding.sampler,
										type: binding.samplerType,
										sampleType: binding.resource.sampleType
									}
								: undefined;
						},
						createTextureView: createCachedExternalTextureView,
						diagnosticContext: runtimeContext
					}
				});
				resolvedComputeResourcesByPass.set(pass, resources);
				computeLabelsByPass.set(pass, passLabel);
			}
			const canReuseGraphPlan =
				isGraphPlanCacheValid(framePasses, clearColor) &&
				hasSameRenderGraphPhysicalAccessSignature(cachedGraphPlan!, resolvedComputeResourcesByPass);
			let graphPlanIsFresh = false;
			const graphPlan = canReuseGraphPlan
				? cachedGraphPlan!
				: (() => {
						let nextPlan: RenderGraphPlan;
						try {
							nextPlan = planRenderGraph(framePasses, clearColor, renderTargetKeys, {
								getResolvedResources: (pass) => resolvedComputeResourcesByPass.get(pass),
								getPassLabel: (pass) => computeLabelsByPass.get(pass) ?? 'Compute pass'
							});
						} catch (error) {
							throw attachSpektralErrorContext(error, runtimeContext);
						}
						graphPlanIsFresh = true;
						return nextPlan;
					})();
			validateBuiltInRenderPassFormats({
				passes: framePasses,
				workingFormat,
				namedFormats: renderTargetFormatSnapshot,
				deviceFeatures: device.features
			});
			if (graphPlan.renderSteps.length > 0) {
				validatePresentationSourceFormat({
					slot: graphPlan.finalOutput,
					workingFormat,
					namedFormats: renderTargetFormatSnapshot,
					deviceFeatures: device.features,
					requiresFilterableInput: presentationSamplingLayout.samplerType === 'filtering'
				});
			}
			if (graphPlanIsFresh) {
				updateGraphPlanCache(framePasses, clearColor, graphPlan);
				if (ownsGraphUpdater()) {
					options.graphUpdater?.setSnapshot(graphSnapshotBuilder.build(graphPlan));
				}
			}
			const canvasTexture = context.getCurrentTexture();
			// Mutate the pre-allocated surface object rather than allocating a new one.
			canvasSurface.texture = canvasTexture;
			canvasSurface.view = canvasTexture.createView();
			canvasSurface.width = width;
			canvasSurface.height = height;
			canvasSurface.format = effectiveCanvasFormat;

			const presentationRequired = colorPipeline.requiresPresentationPass;
			const graphHasRenderSteps = graphPlan.renderSteps.length > 0;
			const presentationSurface =
				presentationRequired || graphHasRenderSteps
					? ensurePresentationTarget(width, height)
					: null;
			if (graphHasRenderSteps) {
				frameSlots.source = ensureSlotTarget('source', width, height);
				frameSlots.target = ensureSlotTarget('target', width, height);
				frameSlots.canvas = presentationSurface!;
				frameSlotsActive = true;
			} else {
				frameSlotsActive = false;
			}
			const slots = frameSlotsActive ? frameSlots : null;
			const sceneOutput = slots ? slots.source : (presentationSurface ?? canvasSurface);

			const clearFeedbackView = (
				view: GPUTextureView,
				clearColor: [number, number, number, number]
			): void => {
				const pass = commandEncoder.beginRenderPass({
					colorAttachments: [
						{
							view,
							clearValue: toClearValue(clearColor),
							loadOp: 'clear',
							storeOp: 'store'
						}
					]
				});
				pass.end();
			};

			// Execute pre-scene passes so storage textures, buffers and fragment
			// feedback outputs are up-to-date when the scene shader samples them.
			let computeStepIndex = 0;
			let feedbackStepIndex = 0;
			for (const step of graphPlan.preSceneSteps) {
				if (step.kind === 'compute') {
					const computeStepLabel = step.computeLabel ?? `Compute pass #${computeStepIndex}`;
					computeStepIndex += 1;
					if (!isManagedComputePass(step.pass)) {
						throw new Error(`${computeStepLabel} has an invalid managed pass contract.`);
					}
					const computePass = step.pass;
					const computeSource = computePass.getCompute();
					const resources = resolvedComputeResourcesByPass.get(step.pass);
					if (!resources) throw new Error(`${computeStepLabel} is missing resolved resources.`);
					const pingPongRead = resources.entries.find(
						(entry) => entry.kind === 'sampled-texture' && entry.pingPong === 'read'
					);
					const pingPongWrite = resources.entries.find(
						(entry) => entry.kind === 'storage-texture' && entry.pingPong === 'write'
					);
					let pingPongPair: PingPongTexturePair | null = null;
					if (computePass.isPingPong) {
						if (
							!pingPongRead ||
							!pingPongWrite ||
							pingPongRead.source !== 'material' ||
							pingPongWrite.source !== 'material' ||
							typeof pingPongRead.logicalId !== 'string' ||
							!Object.is(pingPongRead.logicalId, pingPongWrite.logicalId)
						) {
							throw createSpektralError(
								'PINGPONG_CONFIGURATION_INVALID',
								`${computeStepLabel} ping-pong pair must reference one renderer-managed material texture.`
							);
						}
						pingPongPair = ensurePingPongTexturePair(computePass, pingPongRead.logicalId);
					}
					const workgroupSize = computePass.getWorkgroupSize();
					const pipelineEntry = buildComputePipelineEntry({
						computeSource,
						workgroupSize,
						resources
					});
					const resourceBindGroup = pingPongPair
						? null
						: getComputeResourceBindGroup(pipelineEntry, computePass, resources);
					const iterations = computePass.isPingPong ? (computePass.getIterations?.() ?? 1) : 1;
					if (!Number.isInteger(iterations) || iterations < 1) {
						throw new Error(
							`${computeStepLabel} iterations must be a positive integer >= 1, got ${iterations}.`
						);
					}

					for (let iter = 0; iter < iterations; iter += 1) {
						const dispatchLabel =
							iterations > 1 ? `${computeStepLabel} iteration ${iter + 1}` : computeStepLabel;
						const dispatch = validateComputeDispatch(
							computePass.resolveDispatch({
								width,
								height,
								time,
								delta,
								workgroupSize
							}),
							maxComputeWorkgroupsPerDimension,
							dispatchLabel
						);
						const cPass = commandEncoder.beginComputePass();
						cPass.setPipeline(pipelineEntry.pipeline);
						cPass.setBindGroup(0, pipelineEntry.uniformBindGroup);
						if (pingPongPair) {
							cPass.setBindGroup(
								1,
								getPingPongResourceBindGroup(
									pipelineEntry,
									computePass,
									resources,
									pingPongPair,
									pingPongPair.readFromA
								)
							);
						} else if (resourceBindGroup) {
							cPass.setBindGroup(1, resourceBindGroup);
						}
						cPass.dispatchWorkgroups(dispatch[0], dispatch[1], dispatch[2]);
						cPass.end();
						if (pingPongPair) pingPongPair.readFromA = !pingPongPair.readFromA;
					}

					if (pingPongPair) {
						const latestView = pingPongPair.readFromA ? pingPongPair.viewA : pingPongPair.viewB;
						if (resourceRegistry.markTextureWritten(pingPongPair.logicalId, latestView)) {
							const binding = textureBindingByKey.get(pingPongPair.logicalId);
							if (binding?.fragmentVisible) bindGroupDirty = true;
						}
					} else {
						const written = new Set<string>();
						for (const entry of resources.entries) {
							if (entry.source !== 'material' || written.has(String(entry.logicalId))) continue;
							if (entry.kind === 'storage-texture') {
								const logicalId = String(entry.logicalId);
								written.add(logicalId);
								const resource = resourceRegistry.requireTexture(logicalId);
								if (resourceRegistry.markTextureWritten(logicalId, resource.sampledView)) {
									if (textureBindingByKey.get(logicalId)?.fragmentVisible) bindGroupDirty = true;
								}
							} else if (entry.kind === 'storage-buffer' && entry.access === 'storage-read-write') {
								written.add(String(entry.logicalId));
								resourceRegistry.markStorageBufferWritten(String(entry.logicalId));
							}
						}
					}
					continue;
				}

				if (step.kind !== 'feedback') {
					continue;
				}

				const feedbackStepLabel = `PingPongShaderPass #${feedbackStepIndex}`;
				feedbackStepIndex += 1;
				if (!isManagedFeedbackPass(step.pass)) {
					throw new Error(`${feedbackStepLabel} has an invalid managed pass contract.`);
				}
				const feedbackPass = step.pass;
				const target = feedbackPass.getTarget();
				if (!target) {
					throw new Error('PingPongShaderPass must provide a target texture key.');
				}

				const targetBinding = textureBindingByKey.get(target);
				if (!targetBinding) {
					throw new Error(
						`PingPongShaderPass target "${target}" must reference a declared material texture.`
					);
				}
				if (!targetBinding.fragmentVisible) {
					throw new Error(
						`PingPongShaderPass target "${target}" must be visible to the fragment shader.`
					);
				}
				if (normalizedTextureDefinitions[target]?.storage) {
					throw new Error(
						`PingPongShaderPass target "${target}" must be declared as a sampled texture, not storage:true. Use PingPongComputePass for storage textures.`
					);
				}

				const size = feedbackPass.resolveSize({ width, height });
				const pair = ensurePingPongShaderTexturePair(feedbackPass, {
					target,
					width: size.width,
					height: size.height,
					format: feedbackPass.getFormat(),
					filter: feedbackPass.getFilter(),
					addressModeU: feedbackPass.getAddressModeU(),
					addressModeV: feedbackPass.getAddressModeV()
				});
				const pipelineEntry = buildPingPongShaderPipelineEntry(feedbackPass, pair.format, target);
				const feedbackBindGroup = createPingPongShaderBindGroup(pipelineEntry, pair.frameBuffer);
				const resetColor = feedbackPass.consumeResetColor();
				const initializationColor =
					resetColor ?? (pair.needsClear ? feedbackPass.getClearColor() : null);
				if (initializationColor) {
					clearFeedbackView(pair.viewA, initializationColor);
					clearFeedbackView(pair.viewB, initializationColor);
					pair.needsClear = false;
				}

				const iterations = feedbackPass.getIterations();
				if (!Number.isInteger(iterations) || iterations < 1) {
					throw new Error(
						`${feedbackStepLabel} iterations must be a positive integer >= 1, got ${iterations}.`
					);
				}

				// Queue writes precede the shared submission, so each feedback pass
				// needs its own buffer instead of overwriting the scene's resolution.
				writeFrameBuffer(time, delta, pair.width, pair.height, pair.frameBuffer);
				const currentOutput = feedbackPass.getCurrentOutput();
				const readFromAAtIterationZero = currentOutput !== `${pair.target}B`;

				for (let iter = 0; iter < iterations; iter += 1) {
					const readFromA = iter % 2 === 0 ? readFromAAtIterationZero : !readFromAAtIterationZero;
					const outputView = readFromA ? pair.viewB : pair.viewA;
					const previousBindGroup = getPingPongShaderPreviousBindGroup(
						pair,
						pipelineEntry.previousBindGroupLayout,
						readFromA
					);
					const pass = commandEncoder.beginRenderPass({
						colorAttachments: [
							{
								view: outputView,
								clearValue: { r: 0, g: 0, b: 0, a: 0 },
								loadOp: 'load',
								storeOp: 'store'
							}
						]
					});
					pass.setPipeline(pipelineEntry.pipeline);
					pass.setBindGroup(0, feedbackBindGroup);
					pass.setBindGroup(1, previousBindGroup);
					pass.draw(3);
					pass.end();
				}

				feedbackPass.advanceFrame();
				const latestOutput = feedbackPass.getCurrentOutput();
				const latestView = latestOutput === `${pair.target}B` ? pair.viewB : pair.viewA;
				if (attachFeedbackTextureBinding(targetBinding, latestView)) {
					bindGroup = createBindGroup();
				}
			}
			if (bindGroupDirty) {
				bindGroup = createBindGroup();
			}

			const scenePass = commandEncoder.beginRenderPass({
				colorAttachments: [
					{
						view: sceneOutput.view,
						clearValue:
							sceneOutput === canvasSurface
								? toPremultipliedCanvasClearValue(clearColor)
								: toClearValue(clearColor),
						loadOp: 'clear',
						storeOp: 'store'
					}
				]
			});

			scenePass.setPipeline(
				!slots && !presentationRequired && directCanvasPipeline ? directCanvasPipeline : pipeline
			);
			scenePass.setBindGroup(0, bindGroup);
			if (fragmentStorageBindGroup) {
				scenePass.setBindGroup(1, fragmentStorageBindGroup);
			}
			scenePass.draw(3);
			scenePass.end();

			executePostSceneRenderGraph({
				device,
				commandEncoder,
				graphPlan,
				slots,
				sceneOutput,
				canvasSurface,
				runtimeTargets,
				time,
				delta,
				width,
				height,
				clearColor,
				presentationRequired,
				present: (sourceView, canvasView, applyFinalTransform) => {
					present(commandEncoder, sourceView, canvasView, clearColor, applyFinalTransform);
				}
			});

			device.queue.submit([commandEncoder.finish()]);
		};

		acceptInitializationCleanups = false;
		initializationCleanups.length = 0;
		if (options.graphUpdater) {
			graphUpdaterOwners.set(options.graphUpdater as object, graphUpdaterOwner);
			options.graphUpdater.reset();
		}
		return {
			render,
			flushStorageWrites,
			getStorageBuffer: (name: string): GPUBuffer | undefined => {
				return resourceRegistry.getStorageBuffer(name)?.buffer;
			},
			getDevice: (): GPUDevice => {
				return device;
			},
			destroy: () => {
				if (isDestroyed) {
					return;
				}
				isDestroyed = true;
				device.removeEventListener('uncapturederror', handleUncapturedError);
				frameBuffer.destroy();
				uniformBuffer.destroy();
				for (const key of storageBufferKeys) {
					resourceRegistry.getStorageBuffer(key)?.buffer.destroy();
				}
				for (const pair of pingPongTexturePairs.values()) {
					pair.textureA.destroy();
					pair.textureB.destroy();
				}
				pingPongTexturePairs.clear();
				for (const pair of pingPongShaderTexturePairs.values()) {
					destroyPingPongShaderTexturePair(pair);
				}
				pingPongShaderTexturePairs.clear();
				computePipelineCache.clear();
				computeResourceResolutionCache.clear();
				externalTextureViewCache = new WeakMap();
				pingPongShaderPipelineCache.clear();
				destroyRenderTexture(sourceSlotTarget);
				destroyRenderTexture(targetSlotTarget);
				destroyRenderTexture(presentationSlotTarget);
				for (const target of runtimeRenderTargets.values()) {
					target.texture.destroy();
				}
				runtimeRenderTargets.clear();
				for (const pass of activePasses) {
					releasePassLifecycle(pass);
				}
				for (const pass of preparedFullscreenPasses) {
					releasePreparedFullscreenPass(pass, device, fullscreenPassOwner);
				}
				preparedFullscreenPasses.clear();
				pendingDynamicFullscreenPasses.clear();
				failedDynamicFullscreenPasses.clear();
				activePasses.length = 0;
				lifecyclePassesRef = null;
				for (const binding of textureBindings) {
					binding.resource.ownedTexture?.destroy();
				}
				sampledFallbackPool.destroy();
				resourceRegistry.clear();
				presentationBindGroupByView = new WeakMap();
				cachedGraphPlan = null;
				cachedGraphPasses.length = 0;
				if (ownsGraphUpdater()) {
					options.graphUpdater?.reset();
					graphUpdaterOwners.delete(options.graphUpdater as object);
				}
				renderTargetSnapshot = {};
				renderTargetKeys = [];
				destroyDevice();
			}
		};
	} catch (error) {
		isDestroyed = true;
		acceptInitializationCleanups = false;
		device.removeEventListener('uncapturederror', handleUncapturedError);
		runInitializationCleanups();
		destroyDevice();
		throw error;
	}
}
