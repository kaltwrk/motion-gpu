import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCurrentWritable } from '../../lib/core/current-value';
import { createFrameRegistry } from '../../lib/core/frame-registry';
import { defineMaterial, resolveMaterial } from '../../lib/core/material';
import { attachShaderCompilationDiagnostics } from '../../lib/core/error-diagnostics';
import { packUniformsIntoFast } from '../../lib/core/uniforms';
import type { UniformValue, ColorPipelineOptions } from '../../lib/core/types';

const { createRendererMock } = vi.hoisted(() => ({
	createRendererMock: vi.fn()
}));

vi.mock('../../lib/core/renderer', () => ({
	createRenderer: createRendererMock
}));

import { createSpektralRuntimeLoop } from '../../lib/core/runtime-loop';

interface MockRenderer {
	render: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
	getStorageBuffer?: ReturnType<typeof vi.fn>;
	getDevice?: ReturnType<typeof vi.fn>;
	flushStorageWrites?: ReturnType<typeof vi.fn>;
}

let rafQueue: FrameRequestCallback[] = [];

async function flushFrame(timestamp: number): Promise<void> {
	const callback = rafQueue.shift();
	if (!callback) {
		throw new Error('No queued animation frame callback');
	}
	callback(timestamp);
	await Promise.resolve();
	await Promise.resolve();
}

function createCanvas(): HTMLCanvasElement {
	return {
		width: 0,
		height: 0,
		getBoundingClientRect: () => ({ width: 16, height: 9 }),
		getContext: () => null
	} as unknown as HTMLCanvasElement;
}

describe('runtime-loop', () => {
	beforeEach(() => {
		rafQueue = [];
		createRendererMock.mockReset();
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn((callback: FrameRequestCallback) => {
				rafQueue.push(callback);
				return rafQueue.length;
			})
		);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		vi.stubGlobal('GPUBufferUsage', {
			MAP_READ: 0x1,
			COPY_DST: 0x2
		});
		vi.stubGlobal('GPUMapMode', {
			READ: 0x1
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty'])(
		'treats prototype name %s as an ordinary uniform and texture key',
		async (name) => {
			const fragment = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
			const source = document.createElement('canvas');
			const replacement = document.createElement('canvas');
			let material = defineMaterial({
				fragment,
				uniforms: { [name]: 0.5 },
				textures: { [name]: { source } }
			});
			const registry = createFrameRegistry();
			const renderer: MockRenderer = { render: vi.fn(), destroy: vi.fn() };
			createRendererMock.mockResolvedValue(renderer);
			const reportError = vi.fn();
			const loop = createSpektralRuntimeLoop({
				canvas: createCanvas(),
				registry,
				size: createCurrentWritable({ width: 0, height: 0 }),
				dpr: createCurrentWritable(1),
				maxDelta: createCurrentWritable(0.1),
				getMaterial: () => material,
				getRenderTargets: () => ({}),
				getPasses: () => [],
				getClearColor: () => [0, 0, 0, 1],
				getAdapterOptions: () => undefined,
				getDeviceDescriptor: () => undefined,
				getOnError: () => undefined,
				reportError
			});
			const expectPayload = (
				expectedUniform: number,
				expectedTexture: HTMLCanvasElement | null
			) => {
				const payload = renderer.render.mock.lastCall![0];
				const layout = resolveMaterial(material).uniformLayout;
				const packed = new Float32Array(layout.byteLength / 4);
				packUniformsIntoFast(payload.uniforms, layout, packed);
				expect.soft(payload.uniforms[name]).toBe(expectedUniform);
				expect.soft(packed[0]).toBe(expectedUniform);
				expect.soft(payload.textures[name]).toBe(expectedTexture);
			};
			try {
				await flushFrame(16);
				await flushFrame(32);
				expectPayload(0.5, source);
				const task = registry.register((state) => {
					state.setUniform(name, 0.75);
					state.setTexture(name, replacement);
				});
				await flushFrame(48);
				expectPayload(0.75, replacement);
				task.stop();
				await flushFrame(64);
				expectPayload(0.75, replacement);
				material = defineMaterial({ fragment });
				await flushFrame(80);
				await flushFrame(96);
				expect(Object.keys(renderer.render.mock.lastCall![0].uniforms)).toEqual([]);
				expect(Object.keys(renderer.render.mock.lastCall![0].textures)).toEqual([]);
				material = defineMaterial({
					fragment,
					uniforms: { [name]: 0.25 },
					textures: { [name]: {} }
				});
				await flushFrame(112);
				await flushFrame(128);
				expectPayload(0.25, null);
				expect(reportError).not.toHaveBeenCalled();
			} finally {
				loop.destroy();
			}
		}
	);

	it.each<{
		label: string;
		initial: UniformValue;
		override: UniformValue;
		next: UniformValue;
		expected: number[];
	}>([
		{ label: 'scalar to vector', initial: 1, override: 7, next: [2, 3], expected: [2, 3] },
		{ label: 'vector to scalar', initial: [1, 1], override: [7, 8], next: 2, expected: [2] },
		{
			label: 'vector dimension',
			initial: [1, 1],
			override: [7, 8],
			next: [2, 3, 4],
			expected: [2, 3, 4]
		},
		{
			label: 'typed scalar to vector',
			initial: { type: 'f32', value: 1 },
			override: { type: 'f32', value: 7 },
			next: [2, 3],
			expected: [2, 3]
		},
		{ label: 'same scalar type', initial: 1, override: 7, next: 2, expected: [7] },
		{ label: 'same vector type', initial: [1, 1], override: [7, 8], next: [2, 3], expected: [7, 8] }
	])(
		'reconciles runtime uniform overrides when replacing a material: $label',
		async ({ initial, override, next, expected }) => {
			const fragment = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
			let material = defineMaterial({ fragment, uniforms: { value: initial, stable: 1 } });
			const registry = createFrameRegistry();
			let firstFrame = true;
			registry.register((state) => {
				if (!firstFrame) return;
				state.setUniform('value', override);
				state.setUniform('stable', 9);
				firstFrame = false;
			});
			const renderer: MockRenderer = { render: vi.fn(), destroy: vi.fn() };
			createRendererMock.mockResolvedValue(renderer);
			const loop = createSpektralRuntimeLoop({
				canvas: createCanvas(),
				registry,
				size: createCurrentWritable({ width: 0, height: 0 }),
				dpr: createCurrentWritable(1),
				maxDelta: createCurrentWritable(0.1),
				getMaterial: () => material,
				getRenderTargets: () => ({}),
				getPasses: () => [],
				getClearColor: () => [0, 0, 0, 1],
				getAdapterOptions: () => undefined,
				getDeviceDescriptor: () => undefined,
				getOnError: () => undefined,
				reportError: vi.fn()
			});
			try {
				await flushFrame(16);
				await flushFrame(32);
				expect(renderer.render.mock.lastCall?.[0].uniforms.value).toEqual(override);
				material = defineMaterial({ fragment, uniforms: { value: next, stable: 2 } });
				await flushFrame(48);
				await flushFrame(64);
				const uniforms = renderer.render.mock.lastCall?.[0].uniforms;
				const layout = resolveMaterial(material).uniformLayout;
				const packed = new Float32Array(layout.byteLength / 4);
				packUniformsIntoFast(uniforms, layout, packed);
				const entry = layout.entries.find((entry) => entry.name === 'value')!;
				expect([...packed.slice(entry.offset / 4, entry.offset / 4 + expected.length)]).toEqual(
					expected
				);
				expect(uniforms.stable).toBe(9);
			} finally {
				loop.destroy();
			}
		}
	);

	it('reads storage buffer data through staging copy/map pipeline', async () => {
		const registry = createFrameRegistry();
		let readPromise: Promise<ArrayBuffer> | null = null;
		registry.register('reader', (state) => {
			if (!readPromise) {
				readPromise = state.readStorageBuffer('particles');
			}
		});

		const gpuBuffer = {} as GPUBuffer;
		const mapped = new Uint8Array([1, 2, 3, 4]).buffer;
		const stagingBuffer = {
			mapAsync: vi.fn(async () => undefined),
			getMappedRange: vi.fn(() => mapped),
			unmap: vi.fn(),
			destroy: vi.fn()
		};
		const commandEncoder = {
			copyBufferToBuffer: vi.fn(),
			finish: vi.fn(() => ({}))
		};
		const device = {
			createBuffer: vi.fn(() => stagingBuffer),
			createCommandEncoder: vi.fn(() => commandEncoder),
			queue: { submit: vi.fn() }
		};
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => gpuBuffer),
			getDevice: vi.fn(() => device)
		};
		createRendererMock.mockResolvedValue(renderer);

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			storageBuffers: {
				particles: { size: 4, type: 'array<f32>' }
			}
		});
		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		await flushFrame(32);

		const pendingRead = readPromise as Promise<ArrayBuffer> | null;
		expect(pendingRead).not.toBeNull();
		if (!pendingRead) {
			throw new Error('Missing read promise');
		}
		const result = await pendingRead;
		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3, 4]);
		expect(commandEncoder.copyBufferToBuffer).toHaveBeenCalledWith(
			gpuBuffer,
			0,
			stagingBuffer,
			0,
			4
		);
		expect(stagingBuffer.mapAsync).toHaveBeenCalledWith(0x1);
		expect(stagingBuffer.unmap).toHaveBeenCalledTimes(1);
		expect(stagingBuffer.destroy).toHaveBeenCalledTimes(1);
		loop.destroy();
	});

	it('copies queued bytes and flushes same-buffer writes in order before readback', async () => {
		const registry = createFrameRegistry();
		let readPromise: Promise<ArrayBuffer> | null = null;
		const firstWrite = new Uint32Array([10]);
		registry.register('writer-reader', (state) => {
			if (readPromise) {
				return;
			}

			state.writeStorageBuffer('particles', firstWrite, { offset: 4 });
			firstWrite[0] = 99;
			state.writeStorageBuffer('particles', new Uint32Array([20]), { offset: 8 });
			readPromise = state.readStorageBuffer('particles');
		});

		const gpuData = new Uint32Array([1, 2, 3, 4]);
		const stagingBuffer = {
			mapAsync: vi.fn(async () => undefined),
			getMappedRange: vi.fn(() => gpuData.buffer),
			unmap: vi.fn(),
			destroy: vi.fn()
		};
		const commandEncoder = {
			copyBufferToBuffer: vi.fn(),
			finish: vi.fn(() => ({}))
		};
		const events: string[] = [];
		const device = {
			createBuffer: vi.fn(() => stagingBuffer),
			createCommandEncoder: vi.fn(() => commandEncoder),
			queue: {
				submit: vi.fn(() => {
					events.push('submit');
				})
			}
		};
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => ({}) as GPUBuffer),
			getDevice: vi.fn(() => device),
			flushStorageWrites: vi.fn((writes: Array<{ data: ArrayBufferView; offset: number }>) => {
				const gpuBytes = new Uint8Array(gpuData.buffer);
				for (const write of writes) {
					events.push(`flush:${write.offset}`);
					gpuBytes.set(
						new Uint8Array(write.data.buffer, write.data.byteOffset, write.data.byteLength),
						write.offset
					);
				}
			})
		};
		createRendererMock.mockResolvedValue(renderer);

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			storageBuffers: {
				particles: { size: 16, type: 'array<u32>' }
			}
		});
		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		await flushFrame(32);

		const pendingRead = readPromise as Promise<ArrayBuffer> | null;
		expect(pendingRead).not.toBeNull();
		if (!pendingRead) {
			throw new Error('Missing read promise');
		}
		const result = await pendingRead;
		expect(Array.from(new Uint32Array(result))).toEqual([1, 10, 20, 4]);
		expect(events).toEqual(['flush:4', 'flush:8', 'submit']);
		expect(renderer.flushStorageWrites).toHaveBeenCalledTimes(1);

		loop.destroy();
	});

	it('rejects readStorageBuffer when storage buffer is not allocated on GPU', async () => {
		const registry = createFrameRegistry();
		let readError: unknown = null;
		registry.register('reader', (state) => {
			void state.readStorageBuffer('particles').catch((error) => {
				readError = error;
			});
		});
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => undefined),
			getDevice: vi.fn(() => ({ queue: { submit: vi.fn() } }))
		};
		createRendererMock.mockResolvedValue(renderer);

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			storageBuffers: {
				particles: { size: 4, type: 'array<f32>' }
			}
		});
		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		await flushFrame(32);
		await Promise.resolve();

		expect(readError).toBeInstanceOf(Error);
		expect((readError as Error).message).toContain('not allocated on GPU');
		loop.destroy();
	});

	it('preserves queued writes for the frame flush when read prerequisites are unavailable', async () => {
		const registry = createFrameRegistry();
		let readError: unknown = null;
		let attempted = false;
		registry.register('writer-reader', (state) => {
			if (attempted) {
				return;
			}
			attempted = true;
			state.writeStorageBuffer('particles', new Float32Array([7]));
			void state.readStorageBuffer('particles').catch((error) => {
				readError = error;
			});
		});
		let flushedWrites: Array<{ name: string; offset: number }> = [];
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => undefined),
			getDevice: vi.fn(() => ({ queue: { submit: vi.fn() } })),
			flushStorageWrites: vi.fn((writes: Array<{ name: string; offset: number }>) => {
				flushedWrites = writes.map(({ name, offset }) => ({ name, offset }));
			})
		};
		createRendererMock.mockResolvedValue(renderer);

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			storageBuffers: {
				particles: { size: 4, type: 'array<f32>' }
			}
		});
		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		await flushFrame(32);
		await Promise.resolve();

		expect(readError).toBeInstanceOf(Error);
		expect((readError as Error).message).toContain('not allocated on GPU');
		expect(renderer.flushStorageWrites).toHaveBeenCalledTimes(1);
		expect(flushedWrites).toEqual([{ name: 'particles', offset: 0 }]);
		loop.destroy();
	});

	it('rejects readStorageBuffer when renderer has no device accessor', async () => {
		const registry = createFrameRegistry();
		let readError: unknown = null;
		registry.register('reader', (state) => {
			void state.readStorageBuffer('particles').catch((error) => {
				readError = error;
			});
		});
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => ({}) as unknown as GPUBuffer),
			getDevice: vi.fn(() => undefined)
		};
		createRendererMock.mockResolvedValue(renderer);

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			storageBuffers: {
				particles: { size: 4, type: 'array<f32>' }
			}
		});
		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		await flushFrame(32);
		await Promise.resolve();

		expect(readError).toBeInstanceOf(Error);
		expect((readError as Error).message).toContain('GPU device unavailable');
		loop.destroy();
	});

	it('destroys staging buffer when mapAsync rejects during readStorageBuffer', async () => {
		const registry = createFrameRegistry();
		let readPromise: Promise<ArrayBuffer> | null = null;
		registry.register('reader', (state) => {
			if (!readPromise) {
				state.writeStorageBuffer('particles', new Uint32Array([7]));
				readPromise = state.readStorageBuffer('particles');
			}
		});

		const stagingBuffer = {
			mapAsync: vi.fn(() => Promise.reject(new Error('device lost'))),
			getMappedRange: vi.fn(),
			unmap: vi.fn(),
			destroy: vi.fn()
		};
		const commandEncoder = {
			copyBufferToBuffer: vi.fn(),
			finish: vi.fn(() => ({}))
		};
		const device = {
			createBuffer: vi.fn(() => stagingBuffer),
			createCommandEncoder: vi.fn(() => commandEncoder),
			queue: { submit: vi.fn() }
		};
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => ({}) as unknown as GPUBuffer),
			getDevice: vi.fn(() => device),
			flushStorageWrites: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			storageBuffers: {
				particles: { size: 4, type: 'array<f32>' }
			}
		});
		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		await flushFrame(32);

		expect(readPromise).not.toBeNull();
		if (!readPromise) {
			throw new Error('Missing read promise');
		}
		await expect(readPromise).rejects.toThrow(/device lost/);
		loop.invalidate();
		await flushFrame(48);
		expect(renderer.flushStorageWrites).toHaveBeenCalledTimes(1);
		expect(stagingBuffer.destroy).toHaveBeenCalledTimes(1);
		expect(stagingBuffer.unmap).not.toHaveBeenCalled();
		loop.destroy();
	});

	it('destroys late-created renderer when loop is disposed during async rebuild', async () => {
		const registry = createFrameRegistry();
		let resolveRenderer: ((renderer: MockRenderer) => void) | null = null;
		createRendererMock.mockImplementation(
			() =>
				new Promise<MockRenderer>((resolve) => {
					resolveRenderer = resolve;
				})
		);

		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () =>
				defineMaterial({
					fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
				}),
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		expect(createRendererMock).toHaveBeenCalledTimes(1);
		expect(rafQueue).toHaveLength(0);

		const lateRenderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		loop.destroy();
		const resolveRendererNow = resolveRenderer as ((renderer: MockRenderer) => void) | null;
		expect(resolveRendererNow).toBeTypeOf('function');
		resolveRendererNow?.(lateRenderer);
		await Promise.resolve();
		await Promise.resolve();

		expect(lateRenderer.destroy).toHaveBeenCalledTimes(1);
	});

	it.each(['manual', 'on-demand'] as const)(
		'renders async renderer readiness in %s mode without another user advance',
		async (renderMode) => {
			const registry = createFrameRegistry({ renderMode });
			let requestRendererFrame: (() => void) | undefined;
			const renderer: MockRenderer = {
				render: vi.fn(),
				destroy: vi.fn()
			};
			createRendererMock.mockImplementation(
				async (options: { requestRender?: () => void }): Promise<MockRenderer> => {
					requestRendererFrame = options.requestRender;
					return renderer;
				}
			);

			const loop = createSpektralRuntimeLoop({
				canvas: createCanvas(),
				registry,
				size: createCurrentWritable({ width: 0, height: 0 }),
				dpr: { current: 1, subscribe: () => () => undefined },
				maxDelta: { current: 1, subscribe: () => () => undefined },
				getMaterial: () =>
					defineMaterial({
						fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
					}),
				getRenderTargets: () => ({}),
				getPasses: () => [],
				getClearColor: () => [0, 0, 0, 1],
				getAdapterOptions: () => undefined,
				getDeviceDescriptor: () => undefined,
				getOnError: () => undefined,
				reportError: () => undefined
			});

			await flushFrame(16); // renderer initialization
			await flushFrame(32); // settle the initial on-demand frame
			renderer.render.mockClear();
			renderer.render.mockImplementationOnce(() => {
				Promise.resolve().then(() => requestRendererFrame?.());
			});

			loop.advance();
			await flushFrame(48); // first frame discovers pending async renderer work
			expect(renderer.render).toHaveBeenCalledTimes(1);
			expect(rafQueue).toHaveLength(1);

			await flushFrame(64); // readiness callback must render, not just run another RAF
			expect(renderer.render).toHaveBeenCalledTimes(2);
			if (renderMode === 'on-demand') await flushFrame(80); // final idle scheduling check
			expect(renderer.render).toHaveBeenCalledTimes(2);
			expect(rafQueue).toHaveLength(0);
			loop.destroy();
		}
	);

	it('does not serialize unchanged WGSL each frame and detects mutations inside renderer options', async () => {
		const fragment =
			'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }\n//' + 'x'.repeat(128 * 1024);
		const material = defineMaterial({ fragment });
		const renderer: MockRenderer = { render: vi.fn(), destroy: vi.fn() };
		createRendererMock.mockResolvedValue(renderer);
		const color: ColorPipelineOptions = { outputEncoding: 'srgb' };
		const features = new Set<GPUFeatureName>();
		const limits = { maxTextureDimension2D: 1024 };
		const adapter: GPURequestAdapterOptions = { powerPreference: 'low-power' };
		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry: createFrameRegistry(),
			size: createCurrentWritable({ width: 16, height: 9 }),
			dpr: createCurrentWritable(1),
			maxDelta: createCurrentWritable(0.1),
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getColor: () => color,
			getAdapterOptions: () => adapter,
			getDeviceDescriptor: () => ({ requiredFeatures: features, requiredLimits: limits }),
			getOnError: () => undefined,
			reportError: vi.fn()
		});
		await flushFrame(16);
		await flushFrame(32);
		const stringify = vi.spyOn(JSON, 'stringify');
		for (let frame = 0; frame < 20; frame++) await flushFrame(48 + frame * 16);
		const serializedSources = stringify.mock.calls.filter(
			([value]) =>
				typeof value?.materialSignature === 'string' && value.materialSignature.length > 128 * 1024
		);
		expect(serializedSources).toHaveLength(0);
		expect(createRendererMock).toHaveBeenCalledOnce();
		for (const mutate of [
			() => {
				color.outputEncoding = 'linear';
			},
			() => {
				features.add('shader-f16');
			},
			() => {
				limits.maxTextureDimension2D = 2048;
			},
			() => {
				adapter.powerPreference = 'high-performance';
			}
		]) {
			const count = createRendererMock.mock.calls.length;
			mutate();
			loop.invalidate();
			await flushFrame(500);
			await flushFrame(516);
			expect(createRendererMock).toHaveBeenCalledTimes(count + 1);
		}
		loop.destroy();
	});

	it('rebuilds renderer when adapterOptions or deviceDescriptor change', async () => {
		const registry = createFrameRegistry();
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
		});
		const firstRenderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			flushStorageWrites: vi.fn()
		};
		const secondRenderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			flushStorageWrites: vi.fn()
		};
		createRendererMock.mockResolvedValueOnce(firstRenderer).mockResolvedValueOnce(secondRenderer);
		let adapterOptions: GPURequestAdapterOptions = { powerPreference: 'low-power' };
		let deviceDescriptor: GPUDeviceDescriptor = { label: 'device-a' };

		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => adapterOptions,
			getDeviceDescriptor: () => deviceDescriptor,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		await flushFrame(32);

		adapterOptions = { powerPreference: 'high-performance' };
		deviceDescriptor = { label: 'device-b' };
		loop.invalidate();
		await flushFrame(48);

		expect(createRendererMock).toHaveBeenCalledTimes(2);
		expect(firstRenderer.destroy).toHaveBeenCalledTimes(1);
		expect(createRendererMock.mock.calls[0]?.[0]).toMatchObject({
			adapterOptions: { powerPreference: 'low-power' },
			deviceDescriptor: { label: 'device-a' }
		});
		expect(createRendererMock.mock.calls[1]?.[0]).toMatchObject({
			adapterOptions: { powerPreference: 'high-performance' },
			deviceDescriptor: { label: 'device-b' }
		});

		loop.destroy();
	});

	it('rebuilds colliding storage data but reuses identical material bytes', async () => {
		const first = [1364945411, 3212416462];
		const colliding = [2409582172, 2899006390];
		const makeMaterial = (values: number[]) =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }',
				storageBuffers: {
					data: { size: 8, type: 'array<u32>', initialData: new Uint32Array(values) }
				}
			});
		const a = makeMaterial(first);
		const aCopy = makeMaterial(first);
		const b = makeMaterial(colliding);
		const bCopy = makeMaterial(colliding);
		// These distinct byte sequences collide under the compact FNV-1a fingerprint.
		expect(resolveMaterial(a).signature).toBe(resolveMaterial(b).signature);
		resolveMaterial(aCopy);
		resolveMaterial(bCopy);
		const renderer = () => ({ render: vi.fn(), destroy: vi.fn(), flushStorageWrites: vi.fn() });
		createRendererMock.mockImplementation(async () => renderer());
		let material = a;
		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry: createFrameRegistry(),
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: createCurrentWritable(1),
			maxDelta: createCurrentWritable(1),
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: vi.fn()
		});
		try {
			await flushFrame(16);
			await flushFrame(32);
			material = aCopy;
			await flushFrame(48);
			expect(createRendererMock).toHaveBeenCalledTimes(1);
			material = b;
			await flushFrame(64);
			expect(createRendererMock).toHaveBeenCalledTimes(2);
			expect(
				Array.from(createRendererMock.mock.lastCall![0].storageBufferDefinitions.data.initialData)
			).toEqual(colliding);
			await flushFrame(80);
			material = bCopy;
			await flushFrame(96);
			expect(createRendererMock).toHaveBeenCalledTimes(2);
			material = a;
			await flushFrame(112);
			expect(createRendererMock).toHaveBeenCalledTimes(3);
			expect(
				Array.from(createRendererMock.mock.lastCall![0].storageBufferDefinitions.data.initialData)
			).toEqual(first);
		} finally {
			loop.destroy();
		}
	});

	it('rebuilds renderer when storage buffer initialData changes with the same layout', async () => {
		const registry = createFrameRegistry();
		const firstRenderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			flushStorageWrites: vi.fn()
		};
		const secondRenderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			flushStorageWrites: vi.fn()
		};
		createRendererMock.mockResolvedValueOnce(firstRenderer).mockResolvedValueOnce(secondRenderer);
		const fragment = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const materialA = defineMaterial({
			fragment,
			storageBuffers: {
				particles: { size: 16, type: 'array<f32>', initialData: new Float32Array([1, 0, 0, 0]) }
			}
		});
		const materialB = defineMaterial({
			fragment,
			storageBuffers: {
				particles: { size: 16, type: 'array<f32>', initialData: new Float32Array([2, 0, 0, 0]) }
			}
		});
		let material = materialA;

		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		material = materialB;
		loop.invalidate();
		await flushFrame(32);

		expect(createRendererMock).toHaveBeenCalledTimes(2);
		expect(firstRenderer.destroy).toHaveBeenCalledTimes(1);
		expect(createRendererMock.mock.calls[1]?.[0]).toMatchObject({
			storageBufferDefinitions: {
				particles: expect.objectContaining({
					initialData: expect.any(Float32Array)
				})
			}
		});

		loop.destroy();
	});

	// -------------------------------------------------------------------------
	// pendingStorageWrites flush correctness (Fix A scope)
	// -------------------------------------------------------------------------

	it('flushes queued storage writes before render and does not re-send them next frame', async () => {
		const registry = createFrameRegistry();
		let writeSent = false;

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }',
			storageBuffers: { particles: { size: 16, type: 'array<f32>' } }
		});

		// Only queue the write on the first task invocation.
		registry.register('writer', (state) => {
			if (!writeSent) {
				state.writeStorageBuffer('particles', new Float32Array([1, 2, 3, 4]));
				writeSent = true;
			}
		});

		const flushedWritesPerFrame: Array<Array<{ name: string }>> = [];

		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => undefined),
			getDevice: vi.fn(() => undefined),
			flushStorageWrites: vi.fn((writes: Array<{ name: string }>) => {
				flushedWritesPerFrame.push(writes.map(({ name }) => ({ name })));
			})
		};
		createRendererMock.mockResolvedValue(renderer);

		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16); // renderer init
		await flushFrame(32); // first render — write must be flushed before render

		expect(flushedWritesPerFrame).toEqual([[{ name: 'particles' }]]);
		expect(renderer.render).toHaveBeenCalledTimes(1);

		// Kick a second frame — no new write was queued, so no second flush happens.
		loop.invalidate();
		await flushFrame(48);

		expect(flushedWritesPerFrame).toEqual([[{ name: 'particles' }]]);
		expect(renderer.render).toHaveBeenCalledTimes(2);

		loop.destroy();
	});

	it('does not flush storage writes when no writes are queued', async () => {
		const registry = createFrameRegistry();

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }',
			storageBuffers: { buf: { size: 4, type: 'array<f32>' } }
		});

		// No write queued — task does nothing.
		registry.register('noop', () => undefined);

		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => undefined),
			getDevice: vi.fn(() => undefined),
			flushStorageWrites: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);

		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		await flushFrame(32);

		expect(renderer.render).toHaveBeenCalledTimes(1);
		expect(renderer.flushStorageWrites).not.toHaveBeenCalled();

		loop.destroy();
	});

	it('does not replay queued storage writes after renderer.render throws', async () => {
		const registry = createFrameRegistry();
		const reportError = vi.fn();
		let queued = false;
		registry.register('writer', (state) => {
			if (!queued) {
				state.writeStorageBuffer('particles', new Float32Array([1, 2, 3, 4]));
				queued = true;
			}
		});
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }',
			storageBuffers: { particles: { size: 16, type: 'array<f32>' } }
		});
		const flushedWritesPerFrame: Array<Array<{ name: string }>> = [];
		const renderer: MockRenderer = {
			render: vi.fn(() => {
				throw new Error('render failed');
			}),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => undefined),
			getDevice: vi.fn(() => undefined),
			flushStorageWrites: vi.fn((writes: Array<{ name: string }>) => {
				flushedWritesPerFrame.push(writes.map(({ name }) => ({ name })));
			})
		};
		createRendererMock.mockResolvedValue(renderer);

		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError
		});

		await flushFrame(16);
		await flushFrame(32);
		loop.invalidate();
		await flushFrame(48);

		expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ phase: 'render' }));
		expect(flushedWritesPerFrame).toEqual([[{ name: 'particles' }]]);

		loop.destroy();
	});

	it('does not replay queued storage writes after renderer.flushStorageWrites throws', async () => {
		const registry = createFrameRegistry();
		const reportError = vi.fn();
		let queued = false;
		registry.register('writer', (state) => {
			if (!queued) {
				state.writeStorageBuffer('particles', new Float32Array([1, 2, 3, 4]));
				queued = true;
			}
		});
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }',
			storageBuffers: { particles: { size: 16, type: 'array<f32>' } }
		});
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => undefined),
			getDevice: vi.fn(() => undefined),
			flushStorageWrites: vi.fn(() => {
				throw new Error('flush failed');
			})
		};
		createRendererMock.mockResolvedValue(renderer);

		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError
		});

		await flushFrame(16);
		await flushFrame(32);
		loop.invalidate();
		await flushFrame(48);

		expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ phase: 'render' }));
		expect(renderer.flushStorageWrites).toHaveBeenCalledTimes(1);

		loop.destroy();
	});

	it('flushes storage writes without rasterizing when autoRender is disabled', async () => {
		const registry = createFrameRegistry({ autoRender: false });
		const flushedWritesPerFrame: Array<Array<{ name: string }>> = [];

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }',
			storageBuffers: { particles: { size: 16, type: 'array<f32>' } }
		});

		registry.register('writer', (state) => {
			state.writeStorageBuffer('particles', new Float32Array([1, 2, 3, 4]));
		});

		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => undefined),
			getDevice: vi.fn(() => undefined),
			flushStorageWrites: vi.fn((writes: Array<{ name: string }>) => {
				flushedWritesPerFrame.push(writes.map(({ name }) => ({ name })));
			})
		};
		createRendererMock.mockResolvedValue(renderer);

		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		await flushFrame(32);
		await flushFrame(48);

		expect(renderer.render).not.toHaveBeenCalled();
		expect(flushedWritesPerFrame).toEqual([[{ name: 'particles' }], [{ name: 'particles' }]]);

		loop.destroy();
	});

	it('does not replay storage writes accumulated while autoRender was disabled', async () => {
		const registry = createFrameRegistry({ autoRender: false });
		const flushedWritesPerFrame: Array<Array<{ name: string }>> = [];

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }',
			storageBuffers: { particles: { size: 16, type: 'array<f32>' } }
		});

		registry.register('writer', (state) => {
			state.writeStorageBuffer('particles', new Float32Array([1, 2, 3, 4]));
		});

		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn(),
			getStorageBuffer: vi.fn(() => undefined),
			getDevice: vi.fn(() => undefined),
			flushStorageWrites: vi.fn((writes: Array<{ name: string }>) => {
				flushedWritesPerFrame.push(writes.map(({ name }) => ({ name })));
			})
		};
		createRendererMock.mockResolvedValue(renderer);

		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame(16);
		await flushFrame(32);
		await flushFrame(48);
		registry.setAutoRender(true);
		await flushFrame(64);

		expect(flushedWritesPerFrame).toEqual([
			[{ name: 'particles' }],
			[{ name: 'particles' }],
			[{ name: 'particles' }]
		]);
		expect(renderer.render).toHaveBeenCalledTimes(1);

		loop.destroy();
	});

	it('does not deduplicate identical shader messages from different pass/source metadata', async () => {
		const registry = createFrameRegistry();
		const renderer = { render: vi.fn(), destroy: vi.fn() };
		createRendererMock.mockResolvedValue(renderer);
		const reports: unknown[] = [];
		const histories: Array<readonly unknown[]> = [];
		const onError = vi.fn();
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
		});
		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => onError,
			reportError: (report) => reports.push(report),
			getErrorHistoryLimit: () => 10,
			reportErrorHistory: (history) => histories.push(history)
		});

		await flushFrame(16);
		const channel = (
			createRendererMock.mock.calls[0]?.[0] as {
				reportAsyncError?: (error: Error) => void;
			}
		).reportAsyncError!;
		const shaderError = (
			passLabel: string,
			sourceLocation: { kind: 'fragment' | 'wrapper'; line: number }
		) =>
			attachShaderCompilationDiagnostics(new Error('identical compilation failure at line 3'), {
				kind: 'shader-compilation',
				shaderStage: 'fragment',
				diagnostics: [
					{
						generatedLine: 3,
						linePos: 5,
						message: 'identical compilation failure at line 3',
						sourceLocation
					}
				],
				fragmentSource: 'line1\nline2\nline3',
				includeSources: {},
				materialSource: null,
				pipeline: {
					passKind: 'ShaderPass',
					passLabel,
					inputFormat: 'rgba8unorm',
					outputFormat: 'rgba8unorm'
				}
			});

		channel(shaderError('Pass A', { kind: 'fragment', line: 3 }));
		channel(shaderError('Pass B', { kind: 'wrapper', line: 3 }));

		expect(reports).toHaveLength(2);
		expect(onError).toHaveBeenCalledTimes(2);
		expect(histories.at(-1)).toHaveLength(2);
		expect(
			reports.map(
				(report) => (report as { shader: { passLabel?: string; sourceKind: string } }).shader
			)
		).toEqual([
			{
				passKind: 'ShaderPass',
				passLabel: 'Pass A',
				stage: 'fragment',
				inputFormat: 'rgba8unorm',
				outputFormat: 'rgba8unorm',
				sourceKind: 'user',
				line: 3,
				column: 5
			},
			{
				passKind: 'ShaderPass',
				passLabel: 'Pass B',
				stage: 'fragment',
				inputFormat: 'rgba8unorm',
				outputFormat: 'rgba8unorm',
				sourceKind: 'wrapper',
				line: 3,
				column: 5
			}
		]);
		loop.destroy();
	});

	it('resets and forwards the graph updater before a renderer rebuild that fails', async () => {
		createRendererMock.mockRejectedValue(new Error('renderer rebuild failed'));
		const graphUpdater = { setSnapshot: vi.fn(), reset: vi.fn() };
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
		});
		const loop = createSpektralRuntimeLoop({
			canvas: createCanvas(),
			registry: createFrameRegistry(),
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: vi.fn(),
			graphUpdater
		});

		await flushFrame(16);
		expect(graphUpdater.reset).toHaveBeenCalledTimes(1);
		expect(createRendererMock.mock.calls[0]?.[0]).toMatchObject({ graphUpdater });
		loop.destroy();
	});
});

describe('runtime-loop resize behavior', () => {
	type ROCallback = (entries: ResizeObserverEntry[]) => void;

	interface MockRO {
		callback: ROCallback;
		observe: ReturnType<typeof vi.fn>;
		disconnect: ReturnType<typeof vi.fn>;
	}

	let mockROInstances: MockRO[] = [];
	let rafQueue2: FrameRequestCallback[] = [];

	function fireMockRO(instance: MockRO, width: number, height: number, vertical = false): void {
		instance.callback([
			{
				contentBoxSize: [
					{ inlineSize: vertical ? height : width, blockSize: vertical ? width : height }
				],
				contentRect: { width, height }
			} as unknown as ResizeObserverEntry
		]);
	}

	const material = defineMaterial({
		fragment: `fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }`
	});

	beforeEach(() => {
		mockROInstances = [];
		rafQueue2 = [];

		// Must use `function` (not arrow) so the implementation can act as a
		// constructor — vi.fn with an arrow function body throws when called with
		// `new`, preventing the instance from being pushed to mockROInstances.
		const MockResizeObserver = vi.fn(function MockRO(this: unknown, cb: ROCallback) {
			const instance: MockRO = {
				callback: cb,
				observe: vi.fn(),
				disconnect: vi.fn()
			};
			mockROInstances.push(instance);
			return instance;
		});

		vi.stubGlobal('ResizeObserver', MockResizeObserver);
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn((callback: FrameRequestCallback) => {
				rafQueue2.push(callback);
				return rafQueue2.length;
			})
		);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		vi.stubGlobal('GPUBufferUsage', { MAP_READ: 0x1, COPY_DST: 0x2 });
		vi.stubGlobal('GPUMapMode', { READ: 0x1 });
		createRendererMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	async function flushFrame2(timestamp: number): Promise<void> {
		const callback = rafQueue2.shift();
		if (!callback) return;
		callback(timestamp);
		await Promise.resolve();
		await Promise.resolve();
	}

	it('observes the canvas element on creation and disconnects on destroy', () => {
		const canvas = {
			width: 0,
			height: 0,
			getBoundingClientRect: vi.fn(() => ({ width: 0, height: 0 })),
			getContext: () => null
		} as unknown as HTMLCanvasElement;

		const registry = createFrameRegistry();
		const renderer = { render: vi.fn(), destroy: vi.fn() };
		createRendererMock.mockResolvedValue(renderer);

		const loop = createSpektralRuntimeLoop({
			canvas,
			registry,
			size: createCurrentWritable({ width: 0, height: 0 }),
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		expect(mockROInstances).toHaveLength(1);
		expect(mockROInstances[0]!.observe).toHaveBeenCalledWith(canvas);

		loop.destroy();
		expect(mockROInstances[0]!.disconnect).toHaveBeenCalledTimes(1);
	});

	it.each([false, true])(
		'uses physical ResizeObserver dimensions without a layout read (vertical=%s)',
		async (vertical) => {
			const getBoundingClientRectSpy = vi.fn(() => ({ width: 99, height: 99 }));
			const canvas = {
				width: 0,
				height: 0,
				getBoundingClientRect: getBoundingClientRectSpy,
				getContext: () => null
			} as unknown as HTMLCanvasElement;

			const size = createCurrentWritable({ width: 0, height: 0 });
			const registry = createFrameRegistry();
			const renderer = { render: vi.fn(), destroy: vi.fn() };
			createRendererMock.mockResolvedValue(renderer);

			const loop = createSpektralRuntimeLoop({
				canvas,
				registry,
				size,
				dpr: { current: 1, subscribe: () => () => undefined },
				maxDelta: { current: 1, subscribe: () => () => undefined },
				getMaterial: () => material,
				getRenderTargets: () => ({}),
				getPasses: () => [],
				getClearColor: () => [0, 0, 0, 1],
				getAdapterOptions: () => undefined,
				getDeviceDescriptor: () => undefined,
				getOnError: () => undefined,
				reportError: () => undefined
			});

			// Fire ResizeObserver with explicit dimensions
			fireMockRO(mockROInstances[0]!, 320, 240, vertical);

			// Flush the frame scheduled by the ResizeObserver callback
			await flushFrame2(16);
			await flushFrame2(32);

			// getBoundingClientRect must NOT be called during normal frame rendering
			// when ResizeObserver has already provided dimensions.
			expect(getBoundingClientRectSpy).not.toHaveBeenCalled();
			expect(size.current).toEqual({ width: 320, height: 240 });

			loop.destroy();
		}
	);

	it('uses ResizeObserver contentRect dimensions when contentBoxSize is unavailable', async () => {
		const getBoundingClientRectSpy = vi.fn(() => ({ width: 99, height: 99 }));
		const canvas = {
			width: 0,
			height: 0,
			getBoundingClientRect: getBoundingClientRectSpy,
			getContext: () => null
		} as unknown as HTMLCanvasElement;

		const size = createCurrentWritable({ width: 0, height: 0 });
		const registry = createFrameRegistry();
		const renderer = { render: vi.fn(), destroy: vi.fn() };
		createRendererMock.mockResolvedValue(renderer);

		const loop = createSpektralRuntimeLoop({
			canvas,
			registry,
			size,
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		mockROInstances[0]?.callback([
			{
				contentRect: { width: 256.9, height: 128.4 }
			} as unknown as ResizeObserverEntry
		]);

		await flushFrame2(16);
		await flushFrame2(32);

		expect(getBoundingClientRectSpy).not.toHaveBeenCalled();
		expect(size.current).toEqual({ width: 256, height: 128 });

		loop.destroy();
	});

	it('falls back to getBoundingClientRect when ResizeObserver has not yet fired', async () => {
		const getBoundingClientRectSpy = vi.fn(() => ({ width: 64, height: 48 }));
		const canvas = {
			width: 0,
			height: 0,
			getBoundingClientRect: getBoundingClientRectSpy,
			getContext: () => null
		} as unknown as HTMLCanvasElement;

		const size = createCurrentWritable({ width: 0, height: 0 });
		const registry = createFrameRegistry();
		const renderer = { render: vi.fn(), destroy: vi.fn() };
		createRendererMock.mockResolvedValue(renderer);

		// Do NOT fire the ResizeObserver before the frame — simulate no observation yet.
		const loop = createSpektralRuntimeLoop({
			canvas,
			registry,
			size,
			dpr: { current: 1, subscribe: () => () => undefined },
			maxDelta: { current: 1, subscribe: () => () => undefined },
			getMaterial: () => material,
			getRenderTargets: () => ({}),
			getPasses: () => [],
			getClearColor: () => [0, 0, 0, 1],
			getAdapterOptions: () => undefined,
			getDeviceDescriptor: () => undefined,
			getOnError: () => undefined,
			reportError: () => undefined
		});

		await flushFrame2(16);
		await flushFrame2(32);

		// When ResizeObserver hasn't fired, getBoundingClientRect is the fallback.
		expect(getBoundingClientRectSpy).toHaveBeenCalled();
		expect(size.current).toEqual({ width: 64, height: 48 });

		loop.destroy();
	});
});
