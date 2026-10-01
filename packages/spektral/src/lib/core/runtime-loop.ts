import type { CurrentReadable, CurrentWritable } from './current-value.js';
import { resolveMaterial, type FragMaterial, type ResolvedMaterial } from './material.js';
import {
	toSpektralErrorReport,
	type SpektralErrorPhase,
	type SpektralErrorReport
} from './error-report.js';
import { createRenderer } from './renderer.js';
import { buildRendererPipelineSignature } from './recompile-policy.js';
import { assertUniformValueForType } from './uniforms.js';
import { getFrameScheduling, type FrameRegistry } from './frame-registry.js';
import type {
	AnyPass,
	ColorPipelineOptions,
	FrameInvalidationToken,
	PendingStorageWrite,
	Renderer,
	RenderTargetDefinitionMap,
	StorageBufferDefinitionMap,
	TextureMap,
	TextureValue,
	UniformType,
	UniformValue,
	RendererGraphUpdater
} from './types.js';

export interface SpektralRuntimeLoopOptions {
	canvas: HTMLCanvasElement;
	registry: FrameRegistry;
	size: CurrentWritable<{ width: number; height: number }>;
	dpr: CurrentReadable<number>;
	maxDelta: CurrentReadable<number>;
	getMaterial: () => FragMaterial;
	getRenderTargets: () => RenderTargetDefinitionMap;
	getPasses: () => AnyPass[];
	getClearColor: () => [number, number, number, number];
	getColor?: () => ColorPipelineOptions | undefined;
	getAdapterOptions: () => GPURequestAdapterOptions | undefined;
	getDeviceDescriptor: () => GPUDeviceDescriptor | undefined;
	getOnError: () => ((report: SpektralErrorReport) => void) | undefined;
	reportError: (report: SpektralErrorReport | null) => void;
	getErrorHistoryLimit?: () => number | undefined;
	getOnErrorHistory?: () => ((history: readonly SpektralErrorReport[]) => void) | undefined;
	reportErrorHistory?: (history: readonly SpektralErrorReport[]) => void;
	/** Renderer-facing graph snapshot bridge. @internal */
	graphUpdater?: RendererGraphUpdater;
}

export interface SpektralRuntimeLoop {
	requestFrame: () => void;
	invalidate: (token?: FrameInvalidationToken) => void;
	advance: () => void;
	destroy: () => void;
}

/**
 * Applies capped exponential backoff between renderer initialization attempts.
 */
function getRendererRetryDelayMs(attempt: number): number {
	return Math.min(8000, 250 * 2 ** Math.max(0, attempt - 1));
}

const ERROR_CLEAR_GRACE_MS = 750;

/**
 * Enforces the offset and byte-length requirements of WebGPU queue writes.
 */
function assertStorageWriteAlignment(name: string, data: ArrayBufferView, offset: number): void {
	if (!ArrayBuffer.isView(data)) {
		throw new Error(`Storage buffer "${name}" write data must be an ArrayBufferView.`);
	}
	if (!Number.isFinite(offset) || !Number.isInteger(offset) || offset < 0) {
		throw new Error(
			`Storage buffer "${name}" write offset must be a finite integer >= 0, got ${offset}.`
		);
	}
	if (offset % 4 !== 0) {
		throw new Error(
			`Storage buffer "${name}" write offset must be a multiple of 4 bytes for WebGPU writeBuffer, got offset=${offset}.`
		);
	}
	if (data.byteLength % 4 !== 0) {
		throw new Error(
			`Storage buffer "${name}" write data byteLength must be a multiple of 4 bytes for WebGPU writeBuffer, got dataSize=${data.byteLength}.`
		);
	}
}

/**
 * Creates the frame loop that coordinates sizing, scheduling, renderer lifecycle, and recovery.
 */
export function createSpektralRuntimeLoop(
	options: SpektralRuntimeLoopOptions
): SpektralRuntimeLoop {
	const { canvas: canvasElement, registry, size } = options;
	const frameScheduling = getFrameScheduling(registry);
	let frameId: number | null = null;
	let retryTimerId: ReturnType<typeof setTimeout> | null = null;
	let errorClearTimerId: ReturnType<typeof setTimeout> | null = null;
	let renderer: Renderer | null = null;
	let isDisposed = false;

	// Observed CSS dimensions provided by ResizeObserver.
	// -1 means no observation has been received yet — the render loop falls
	// back to getBoundingClientRect() until the first callback fires.
	let observedCssWidth = -1;
	let observedCssHeight = -1;

	let resizeObserver: ResizeObserver | null = null;
	try {
		// Wrapped in try/catch so a ReferenceError in environments without
		// ResizeObserver (bare Node.js) is handled gracefully. Tests can stub
		// this via vi.stubGlobal('ResizeObserver', mock).
		resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[entries.length - 1];
			if (!entry) {
				return;
			}

			const boxSize = entry.contentBoxSize?.[0];
			if (boxSize) {
				observedCssWidth = Math.max(0, Math.floor(boxSize.inlineSize));
				observedCssHeight = Math.max(0, Math.floor(boxSize.blockSize));
			} else {
				// Fallback for browsers without contentBoxSize support.
				observedCssWidth = Math.max(0, Math.floor(entry.contentRect.width));
				observedCssHeight = Math.max(0, Math.floor(entry.contentRect.height));
			}

			if (!isDisposed) {
				scheduleFrame();
			}
		});
		resizeObserver.observe(canvasElement);
	} catch {
		// ResizeObserver may not support the canvas element in certain environments.
		resizeObserver = null;
	}
	let previousTime = performance.now() / 1000;
	let activeRendererSignature = '';
	let failedRendererSignature: string | null = null;
	let failedRendererAttempts = 0;
	let nextRendererRetryAt = 0;
	let materialResolveAttempts = 0;
	let rendererRebuildPromise: Promise<void> | null = null;
	let needsDeviceRecoveryFrame = false;

	const runtimeUniforms: Record<string, UniformValue> = {};
	const runtimeTextures: TextureMap = {};
	let activeUniforms: Readonly<Record<string, UniformValue>> = {};
	let activeTextures: Readonly<Record<string, { source?: TextureValue }>> = {};
	let uniformKeys: string[] = [];
	let uniformKeySet = new Set<string>();
	let uniformTypes = new Map<string, UniformType>();
	let textureKeys: readonly string[] = [];
	let textureKeySet = new Set<string>();
	let activeMaterialSignature = '';
	let currentCssWidth = -1;
	let currentCssHeight = -1;
	const renderUniforms: Record<string, UniformValue> = {};
	const renderTextures: TextureMap = {};
	const canvasSize = { width: 0, height: 0 };
	let storageBufferKeys: readonly string[] = [];
	let storageBufferKeySet = new Set<string>();
	let storageBufferDefinitions: Readonly<StorageBufferDefinitionMap> = {};
	const pendingStorageWrites: PendingStorageWrite[] = [];
	let shouldContinueAfterFrame = false;
	let activeErrorKey: string | null = null;
	let errorHistory: SpektralErrorReport[] = [];
	let errorClearReadyAtMs = 0;
	let errorNeedsSuccessfulRender = false;

	const resolveNowMs = (nowMs?: number): number => {
		if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
			return nowMs;
		}

		return performance.now();
	};

	const getHistoryLimit = (): number => {
		const value = options.getErrorHistoryLimit?.() ?? 0;
		if (!Number.isFinite(value) || value <= 0) {
			return 0;
		}

		return Math.floor(value);
	};

	const publishErrorHistory = (): void => {
		const historySnapshot = Object.freeze(errorHistory.slice());
		options.reportErrorHistory?.(historySnapshot);
		const onErrorHistory = options.getOnErrorHistory?.();
		if (!onErrorHistory) {
			return;
		}

		try {
			onErrorHistory(historySnapshot);
		} catch {
			// User-provided error history handlers must not break runtime error recovery.
		}
	};

	const syncErrorHistory = (): void => {
		const limit = getHistoryLimit();
		if (limit <= 0) {
			if (errorHistory.length === 0) {
				return;
			}
			errorHistory = [];
			publishErrorHistory();
			return;
		}

		if (errorHistory.length <= limit) {
			return;
		}

		errorHistory.splice(0, errorHistory.length - limit);
		publishErrorHistory();
	};

	const cancelErrorClear = (): void => {
		if (errorClearTimerId !== null) {
			clearTimeout(errorClearTimerId);
			errorClearTimerId = null;
		}
	};

	const setError = (
		error: unknown,
		phase: SpektralErrorPhase,
		nowMs?: number,
		requiresRender = phase === 'render'
	): void => {
		if (isDisposed) return;
		cancelErrorClear();
		errorNeedsSuccessfulRender = requiresRender;
		const report = toSpektralErrorReport(error, phase);
		errorClearReadyAtMs = resolveNowMs(nowMs) + ERROR_CLEAR_GRACE_MS;
		const reportKey = JSON.stringify({
			code: report.code,
			phase: report.phase,
			title: report.title,
			message: report.message,
			rawMessage: report.rawMessage,
			shader: report.shader,
			source: report.source
				? {
						component: report.source.component,
						location: report.source.location,
						line: report.source.line,
						column: report.source.column
					}
				: null
		});
		if (activeErrorKey === reportKey) {
			return;
		}
		activeErrorKey = reportKey;
		const historyLimit = getHistoryLimit();
		if (historyLimit > 0) {
			errorHistory.push(report);
			if (errorHistory.length > historyLimit) {
				errorHistory.splice(0, errorHistory.length - historyLimit);
			}
			publishErrorHistory();
		}
		options.reportError(report);
		const onError = options.getOnError();
		if (!onError) {
			return;
		}

		try {
			onError(report);
		} catch {
			// User-provided error handlers must not break runtime error recovery.
		}
	};

	const maybeClearError = (nowMs?: number): void => {
		if (isDisposed || activeErrorKey === null) {
			return;
		}
		const remainingMs = errorClearReadyAtMs - resolveNowMs(nowMs);
		if (remainingMs > 0) {
			// Successful recovery must also expire while manual/on-demand rendering is idle.
			if (errorClearTimerId === null) {
				errorClearTimerId = setTimeout(() => {
					errorClearTimerId = null;
					maybeClearError();
				}, remainingMs);
			}
			return;
		}

		cancelErrorClear();
		activeErrorKey = null;
		errorClearReadyAtMs = 0;
		options.reportError(null);
	};

	const shouldRecreateRendererAfterError = (error: unknown): boolean => {
		return toSpektralErrorReport(error, 'render').code === 'WEBGPU_DEVICE_LOST';
	};

	const clearRetryTimer = (): void => {
		if (retryTimerId === null) {
			return;
		}

		clearTimeout(retryTimerId);
		retryTimerId = null;
	};

	const scheduleFrame = (): void => {
		if (isDisposed || frameId !== null) {
			return;
		}

		clearRetryTimer();
		frameId = requestAnimationFrame(renderFrame);
	};

	const scheduleRetryFrame = (delayMs: number): void => {
		if (isDisposed || frameId !== null || retryTimerId !== null) {
			return;
		}

		retryTimerId = setTimeout(
			() => {
				retryTimerId = null;
				scheduleFrame();
			},
			Math.max(0, delayMs)
		);
	};

	const requestFrame = (): void => {
		scheduleFrame();
	};

	const requestRendererFrame = (): void => {
		registry.advance();
		scheduleFrame();
	};

	const invalidate = (token?: FrameInvalidationToken): void => {
		registry.invalidate(token);
		requestFrame();
	};

	const advance = (): void => {
		registry.advance();
		requestFrame();
	};

	const resetRuntimeMaps = (): void => {
		for (const key of Object.keys(runtimeUniforms)) {
			if (!uniformKeySet.has(key)) {
				delete runtimeUniforms[key];
			}
		}

		for (const key of Object.keys(runtimeTextures)) {
			if (!textureKeySet.has(key)) {
				delete runtimeTextures[key];
			}
		}
	};

	const resetRenderPayloadMaps = (): void => {
		for (const key of Object.keys(renderUniforms)) {
			if (!uniformKeySet.has(key)) {
				delete renderUniforms[key];
			}
		}

		for (const key of Object.keys(renderTextures)) {
			if (!textureKeySet.has(key)) {
				delete renderTextures[key];
			}
		}
	};

	const syncMaterialRuntimeState = (
		materialState: ResolvedMaterial,
		materialStorageBuffers: Readonly<StorageBufferDefinitionMap>
	): void => {
		const signatureChanged = activeMaterialSignature !== materialState.signature;
		const defaultsChanged =
			activeUniforms !== materialState.uniforms || activeTextures !== materialState.textures;

		if (!signatureChanged && !defaultsChanged) {
			return;
		}

		activeUniforms = materialState.uniforms;
		activeTextures = materialState.textures;
		if (!signatureChanged) {
			return;
		}

		// Build uniformKeys and uniformTypes in one pass to avoid iterating entries twice.
		const layoutEntries = materialState.uniformLayout.entries;
		const nextUniformKeys: string[] = [];
		const nextUniformTypes = new Map<string, UniformType>();
		for (const entry of layoutEntries) {
			// Overrides were validated against the previous layout. Discard them
			// when their type changes before they reach the unchecked GPU packer.
			if (uniformTypes.get(entry.name) !== entry.type) {
				delete runtimeUniforms[entry.name];
			}
			nextUniformKeys.push(entry.name);
			nextUniformTypes.set(entry.name, entry.type);
		}
		uniformKeys = nextUniformKeys;
		uniformTypes = nextUniformTypes;
		textureKeys = materialState.textureKeys;
		uniformKeySet = new Set(uniformKeys);
		textureKeySet = new Set(textureKeys);
		storageBufferKeys = materialState.storageBufferKeys;
		storageBufferKeySet = new Set(storageBufferKeys);
		storageBufferDefinitions = materialStorageBuffers;
		resetRuntimeMaps();
		resetRenderPayloadMaps();
		activeMaterialSignature = materialState.signature;
	};

	const setUniform = (name: string, value: UniformValue): void => {
		if (!uniformKeySet.has(name)) {
			throw new Error(`Unknown uniform "${name}". Declare it in material.uniforms first.`);
		}
		const expectedType = uniformTypes.get(name);
		if (!expectedType) {
			throw new Error(`Unknown uniform type for "${name}"`);
		}
		assertUniformValueForType(expectedType, value);
		runtimeUniforms[name] = value;
	};

	const setTexture = (name: string, value: TextureValue): void => {
		if (!textureKeySet.has(name)) {
			throw new Error(`Unknown texture "${name}". Declare it in material.textures first.`);
		}
		runtimeTextures[name] = value;
	};

	const takePendingStorageWrites = (name: string): PendingStorageWrite[] => {
		const selected: PendingStorageWrite[] = [];
		let retainedCount = 0;

		for (const write of pendingStorageWrites) {
			if (write.name === name) {
				selected.push(write);
			} else {
				pendingStorageWrites[retainedCount] = write;
				retainedCount += 1;
			}
		}

		pendingStorageWrites.length = retainedCount;
		return selected;
	};

	const writeStorageBuffer = (
		name: string,
		data: ArrayBufferView,
		writeOptions?: { offset?: number }
	): void => {
		if (!storageBufferKeySet.has(name)) {
			throw new Error(
				`Unknown storage buffer "${name}". Declare it in material.storageBuffers first.`
			);
		}
		const definition = storageBufferDefinitions[name];
		if (!definition) {
			throw new Error(`Missing definition for storage buffer "${name}".`);
		}
		const offset = writeOptions?.offset ?? 0;
		assertStorageWriteAlignment(name, data, offset);
		if (offset < 0 || offset + data.byteLength > definition.size) {
			throw new Error(
				`Storage buffer "${name}" write out of bounds: offset=${offset}, dataSize=${data.byteLength}, bufferSize=${definition.size}.`
			);
		}
		const ownedData = new Uint8Array(data.byteLength);
		ownedData.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
		pendingStorageWrites.push({ name, data: ownedData, offset });
	};

	const readStorageBuffer = (name: string): Promise<ArrayBuffer> => {
		if (!storageBufferKeySet.has(name)) {
			throw new Error(
				`Unknown storage buffer "${name}". Declare it in material.storageBuffers first.`
			);
		}
		if (!renderer) {
			return Promise.reject(
				new Error(`Cannot read storage buffer "${name}": renderer not initialized.`)
			);
		}
		const gpuBuffer = renderer.getStorageBuffer?.(name);
		if (!gpuBuffer) {
			return Promise.reject(new Error(`Storage buffer "${name}" not allocated on GPU.`));
		}
		const device = renderer.getDevice?.();
		if (!device) {
			return Promise.reject(new Error('Cannot read storage buffer: GPU device unavailable.'));
		}
		const definition = storageBufferDefinitions[name];
		if (!definition) {
			return Promise.reject(new Error(`Missing definition for storage buffer "${name}".`));
		}
		const writes = takePendingStorageWrites(name);
		try {
			if (writes.length > 0) {
				renderer.flushStorageWrites(writes);
			}
		} catch (error) {
			return Promise.reject(error);
		}
		const stagingBuffer = device.createBuffer({
			size: definition.size,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
		});
		const commandEncoder = device.createCommandEncoder();
		commandEncoder.copyBufferToBuffer(gpuBuffer, 0, stagingBuffer, 0, definition.size);
		device.queue.submit([commandEncoder.finish()]);
		return stagingBuffer.mapAsync(GPUMapMode.READ).then(
			() => {
				try {
					return stagingBuffer.getMappedRange().slice(0);
				} finally {
					stagingBuffer.unmap();
					stagingBuffer.destroy();
				}
			},
			(error) => {
				stagingBuffer.destroy();
				throw error;
			}
		);
	};

	const renderFrame = (timestamp: number): void => {
		frameId = null;
		if (isDisposed) {
			return;
		}
		syncErrorHistory();

		let materialState: ResolvedMaterial;
		let materialDeclaration: FragMaterial;
		try {
			materialDeclaration = options.getMaterial();
			materialState = resolveMaterial(materialDeclaration);
			materialResolveAttempts = 0;
		} catch (error) {
			materialResolveAttempts += 1;
			setError(error, 'initialization', timestamp);
			scheduleRetryFrame(getRendererRetryDelayMs(materialResolveAttempts));
			return;
		}

		shouldContinueAfterFrame = false;

		const color = options.getColor?.();
		const adapterOptions = options.getAdapterOptions();
		const deviceDescriptor = options.getDeviceDescriptor();
		const rendererSignature = buildRendererPipelineSignature({
			materialSignature: materialState.signature,
			...(color !== undefined ? { color } : {}),
			...(adapterOptions !== undefined ? { adapterOptions } : {}),
			...(deviceDescriptor !== undefined ? { deviceDescriptor } : {})
		});
		syncMaterialRuntimeState(materialState, materialDeclaration.storageBuffers);

		if (failedRendererSignature && failedRendererSignature !== rendererSignature) {
			failedRendererSignature = null;
			failedRendererAttempts = 0;
			nextRendererRetryAt = 0;
		}

		if (!renderer || activeRendererSignature !== rendererSignature) {
			const nowMs = performance.now();
			if (failedRendererSignature === rendererSignature && nowMs < nextRendererRetryAt) {
				scheduleRetryFrame(nextRendererRetryAt - nowMs);
				return;
			}

			if (!rendererRebuildPromise) {
				options.graphUpdater?.reset();
				rendererRebuildPromise = (async () => {
					let retryDelayMs: number | null = null;
					try {
						const nextRenderer = await createRenderer({
							canvas: canvasElement,
							fragmentWgsl: materialState.fragmentWgsl,
							fragmentLineMap: [...materialState.fragmentLineMap],
							fragmentSource: materialState.fragmentSource,
							includeSources: materialState.includeSources,
							defineBlockSource: materialState.defineBlockSource,
							materialSource: materialState.source,
							materialSignature: materialState.signature,
							uniformLayout: materialState.uniformLayout,
							textureKeys: [...materialState.textureKeys],
							textureDefinitions: materialState.textures,
							storageBufferKeys: [...materialState.storageBufferKeys],
							storageBufferDefinitions,
							storageTextureKeys: [...materialState.storageTextureKeys],
							getRenderTargets: options.getRenderTargets,
							getPasses: options.getPasses,
							...(color !== undefined ? { color } : {}),
							getClearColor: options.getClearColor,
							getDpr: () => options.dpr.current,
							adapterOptions,
							deviceDescriptor,
							requestRender: requestRendererFrame,
							reportAsyncError: (error) => setError(error, 'render'),
							...(options.graphUpdater !== undefined ? { graphUpdater: options.graphUpdater } : {})
						});

						if (isDisposed) {
							nextRenderer.destroy();
							return;
						}

						renderer?.destroy();
						renderer = nextRenderer;
						if (needsDeviceRecoveryFrame) {
							registry.advance();
							needsDeviceRecoveryFrame = false;
						}
						activeRendererSignature = rendererSignature;
						failedRendererSignature = null;
						failedRendererAttempts = 0;
						nextRendererRetryAt = 0;
						maybeClearError(performance.now());
					} catch (error) {
						failedRendererSignature = rendererSignature;
						failedRendererAttempts += 1;
						retryDelayMs = getRendererRetryDelayMs(failedRendererAttempts);
						nextRendererRetryAt = performance.now() + retryDelayMs;
						setError(error, 'initialization');
					} finally {
						rendererRebuildPromise = null;
						if (retryDelayMs === null) {
							scheduleFrame();
						} else {
							scheduleRetryFrame(retryDelayMs);
						}
					}
				})();
			}

			return;
		}

		const time = timestamp / 1000;
		const rawDelta = Math.max(0, time - previousTime);
		const delta = Math.min(rawDelta, options.maxDelta.current);
		previousTime = time;

		// Use ResizeObserver-supplied dimensions when available; otherwise fall
		// back to getBoundingClientRect() (e.g. before the first RO callback fires).
		let width: number;
		let height: number;
		if (observedCssWidth >= 0) {
			width = observedCssWidth;
			height = observedCssHeight;
		} else {
			const rect = canvasElement.getBoundingClientRect();
			width = Math.max(0, Math.floor(rect.width));
			height = Math.max(0, Math.floor(rect.height));
		}

		if (width !== currentCssWidth || height !== currentCssHeight) {
			currentCssWidth = width;
			currentCssHeight = height;
			size.set({ width, height });
			registry.invalidate();
		}

		let tasksCompleted = false;
		try {
			registry.run({
				time,
				delta,
				setUniform,
				setTexture,
				writeStorageBuffer,
				readStorageBuffer,
				invalidate,
				advance,
				renderMode: registry.getRenderMode(),
				autoRender: registry.getAutoRender(),
				canvas: canvasElement
			});
			tasksCompleted = true;

			const shouldRenderFrame = registry.shouldRender();
			shouldContinueAfterFrame =
				registry.getRenderMode() === 'always' ||
				(registry.getRenderMode() === 'on-demand' &&
					(shouldRenderFrame || frameScheduling?.hasWork() === true));

			if (shouldRenderFrame) {
				for (const key of uniformKeys) {
					const runtimeValue = runtimeUniforms[key];
					renderUniforms[key] =
						runtimeValue === undefined ? (activeUniforms[key] as UniformValue) : runtimeValue;
				}

				for (const key of textureKeys) {
					const runtimeValue = runtimeTextures[key];
					renderTextures[key] =
						runtimeValue === undefined ? (activeTextures[key]?.source ?? null) : runtimeValue;
				}

				canvasSize.width = width;
				canvasSize.height = height;
				if (pendingStorageWrites.length > 0) {
					try {
						renderer.flushStorageWrites(pendingStorageWrites);
					} finally {
						pendingStorageWrites.length = 0;
					}
				}
				renderer.render({
					time,
					delta,
					renderMode: registry.getRenderMode(),
					uniforms: renderUniforms,
					textures: renderTextures,
					canvasSize
				});
			} else if (pendingStorageWrites.length > 0) {
				try {
					renderer.flushStorageWrites(pendingStorageWrites);
				} finally {
					pendingStorageWrites.length = 0;
				}
			}
			if (shouldRenderFrame || !errorNeedsSuccessfulRender) maybeClearError(timestamp);
		} catch (error) {
			setError(error, 'render', timestamp, tasksCompleted);
			// Task failures occur before the normal continuation decision.
			shouldContinueAfterFrame ||= registry.getRenderMode() === 'always';
			if (renderer && shouldRecreateRendererAfterError(error)) {
				needsDeviceRecoveryFrame = true;
				renderer.destroy();
				renderer = null;
				activeRendererSignature = '';
				failedRendererSignature = null;
				failedRendererAttempts = 0;
				nextRendererRetryAt = 0;
				shouldContinueAfterFrame = true;
			}
		} finally {
			pendingStorageWrites.length = 0;
			registry.endFrame();
		}

		if (shouldContinueAfterFrame) {
			scheduleFrame();
		}
	};

	const unsubscribeScheduling = frameScheduling?.subscribe(() => {
		if (registry.getRenderMode() !== 'manual') scheduleFrame();
	});

	void (async () => {
		try {
			const materialDeclaration = options.getMaterial();
			const initialMaterial = resolveMaterial(materialDeclaration);
			materialResolveAttempts = 0;
			syncMaterialRuntimeState(initialMaterial, materialDeclaration.storageBuffers);
			activeRendererSignature = '';
			scheduleFrame();
		} catch (error) {
			materialResolveAttempts += 1;
			setError(error, 'initialization');
			scheduleRetryFrame(getRendererRetryDelayMs(materialResolveAttempts));
		}
	})();

	return {
		requestFrame,
		invalidate,
		advance,
		destroy: () => {
			isDisposed = true;
			unsubscribeScheduling?.();
			resizeObserver?.disconnect();
			resizeObserver = null;
			if (frameId !== null) {
				cancelAnimationFrame(frameId);
				frameId = null;
			}
			clearRetryTimer();
			cancelErrorClear();
			pendingStorageWrites.length = 0;
			renderer?.destroy();
			registry.clear();
		}
	};
}
