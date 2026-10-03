import { describe, expect, it, vi } from 'vitest';
import type {
	ComputeResourceResolverContext,
	ComputeResourceResolverLimits
} from '../../lib/core/compute-resources';
import { observeComputePassStaticTopologyForTests } from '../../lib/core/compute-pass-static-topology';
import { createComputePassResourceResolutionCache } from '../../lib/core/renderer/compute-resource-resolution';
import type {
	RuntimeStorageBufferResource,
	RuntimeTextureResource
} from '../../lib/core/resource-registry';
import { ComputePass } from '../../lib/passes/ComputePass';
import { PingPongComputePass } from '../../lib/passes/PingPongComputePass';
import type { ComputeExternalResourceContext } from '../../lib/core/types';

const COMPUTE =
	'@compute @workgroup_size(1) fn compute(@builtin(global_invocation_id) id: vec3u) { _ = id; }';
const NEXT_COMPUTE =
	'@compute @workgroup_size(2) fn compute(@builtin(global_invocation_id) id: vec3u) { _ = id; }';
const limits: ComputeResourceResolverLimits = {
	maxBindingsPerBindGroup: 32,
	maxSampledTexturesPerShaderStage: 16,
	maxSamplersPerShaderStage: 16,
	maxStorageTexturesPerShaderStage: 8,
	maxStorageBuffersPerShaderStage: 8,
	maxStorageBufferBindingSize: 1 << 20
};

function buffer(label: string): GPUBuffer {
	return { label, size: 256, usage: 128 } as unknown as GPUBuffer;
}

function textureView(label: string): GPUTextureView {
	return { label } as unknown as GPUTextureView;
}

function texture(label: string): GPUTexture {
	return {
		label,
		format: 'rgba8unorm',
		usage: 12,
		mipLevelCount: 1,
		createView: vi.fn(() => textureView(`${label}-view`))
	} as unknown as GPUTexture;
}

function materialTexture(ownedTexture: GPUTexture): RuntimeTextureResource {
	const sampledView = textureView('sampled-a');
	return {
		logicalId: 'state',
		ownedTexture,
		storageView: textureView('storage-a'),
		sampledView,
		publishedView: sampledView,
		format: 'rgba8unorm',
		width: 64,
		height: 64,
		mipLevelCount: 1,
		sampleType: 'float',
		usage: 12,
		resourceVersion: 0
	};
}

function context(
	input: {
		frame?: Partial<ComputeResourceResolverContext['externalContext']>;
		getBuffer?: (logicalId: string) => RuntimeStorageBufferResource | undefined;
		getTexture?: (logicalId: string) => RuntimeTextureResource | undefined;
	} = {}
): Omit<ComputeResourceResolverContext, 'externalState'> {
	return {
		passLabel: 'Compute cache test',
		deviceFeatures: new Set(),
		limits,
		externalContext: {
			device: {} as GPUDevice,
			width: 640,
			height: 360,
			time: 1,
			delta: 0.016,
			...input.frame
		},
		getMaterialTexture: input.getTexture ?? (() => undefined),
		getMaterialStorageBuffer: input.getBuffer ?? (() => undefined),
		getMaterialSampler: () => undefined,
		createTextureView: (resource, descriptor) => resource.createView(descriptor)
	};
}

describe('ComputePassResourceResolutionCache', () => {
	it('reuses the exact plan without descriptor allocations or the public resource boundary', () => {
		const externalBuffer = buffer('static');
		const pass = new ComputePass({
			compute: COMPUTE,
			resources: {
				data: {
					buffer: {
						externalBuffer,
						resourceId: 'data',
						wgslType: 'array<f32>',
						size: 256,
						usage: 128
					},
					access: 'storage-read'
				}
			}
		});
		const publicBoundary = vi.spyOn(pass, 'getResources');
		const cache = createComputePassResourceResolutionCache();
		cache.beginFrame();
		const first = cache.resolve({ pass, context: context(), pingPong: false });
		const firstStats = cache.getStats();

		pass.setCompute(NEXT_COMPUTE);
		pass.setDispatch([2, 3, 1]);
		cache.beginFrame();
		const second = cache.resolve({ pass, context: context(), pingPong: false });

		expect(second).toBe(first);
		expect(publicBoundary).not.toHaveBeenCalled();
		expect(cache.getStats()).toMatchObject({
			planBuilds: 1,
			entriesAllocated: firstStats.entriesAllocated,
			readsAllocated: firstStats.readsAllocated,
			writesAllocated: firstStats.writesAllocated,
			layoutEntriesAllocated: firstStats.layoutEntriesAllocated,
			topologyKeysAllocated: 1,
			steadyStateHits: 1
		});
	});

	it('calls a provider with the current frame and rebuilds only the dynamic plan on a swap', () => {
		let current = buffer('a');
		const provider = vi.fn((frame: ComputeExternalResourceContext) => {
			void frame;
			return current;
		});
		let normalized = 0;
		let allocated = 0;
		const stop = observeComputePassStaticTopologyForTests((event) => {
			if (event.type === 'normalized') normalized += 1;
			else allocated += 1;
		});
		const pass = new ComputePass({
			compute: COMPUTE,
			resources: {
				data: {
					buffer: {
						externalBuffer: provider,
						resourceId: 'data',
						wgslType: 'array<f32>',
						size: 256,
						usage: 128
					},
					access: 'storage-read'
				}
			}
		});
		stop();
		const cache = createComputePassResourceResolutionCache();
		cache.beginFrame();
		const first = cache.resolve({
			pass,
			context: context({ frame: { width: 320, time: 2 } }),
			pingPong: false
		});
		cache.beginFrame();
		const same = cache.resolve({
			pass,
			context: context({ frame: { width: 800, height: 600, time: 3, delta: 0.02 } }),
			pingPong: false
		});
		current = buffer('b');
		cache.beginFrame();
		const swapped = cache.resolve({
			pass,
			context: context({ frame: { width: 1024, time: 4 } }),
			pingPong: false
		});

		expect(same).toBe(first);
		expect(swapped).not.toBe(first);
		expect(swapped.reads[0]?.physicalId).toBe(current);
		expect(
			provider.mock.calls.map(([frame]) => [frame.width, frame.height, frame.time, frame.delta])
		).toEqual([
			[320, 360, 2, 0.016],
			[800, 600, 3, 0.02],
			[1024, 360, 4, 0.016]
		]);
		expect(cache.getStats()).toMatchObject({ planBuilds: 2, steadyStateHits: 1 });
		expect({ normalized, allocated }).toEqual({ normalized: 1, allocated: 1 });
	});

	it('ignores content-only material versions but invalidates the underlying allocation', () => {
		let material: RuntimeStorageBufferResource = {
			logicalId: 'data',
			buffer: buffer('a'),
			size: 256,
			wgslType: 'array<f32>',
			access: 'read-write',
			usage: 128,
			resourceVersion: 0
		};
		const pass = new ComputePass({
			compute: COMPUTE,
			resources: { data: { buffer: 'data', access: 'storage-read' } }
		});
		const cache = createComputePassResourceResolutionCache();
		const resolve = () => {
			cache.beginFrame();
			return cache.resolve({
				pass,
				context: context({ getBuffer: () => material }),
				pingPong: false
			});
		};
		const first = resolve();
		material.resourceVersion += 1;
		expect(resolve()).toBe(first);
		material = { ...material, buffer: buffer('b'), resourceVersion: material.resourceVersion + 1 };
		const replaced = resolve();

		expect(replaced).not.toBe(first);
		expect((replaced.entries[0]?.bindingResource as GPUBufferBinding).buffer).toBe(material.buffer);
		expect(cache.getStats()).toMatchObject({ planBuilds: 2, steadyStateHits: 1 });
	});

	it('keeps ping-pong topology and resolution plans stable across published A/B views', () => {
		const owned = texture('state');
		const material = materialTexture(owned);
		const pass = new PingPongComputePass({
			compute: COMPUTE,
			iterations: 2,
			resources: {
				previous: { texture: 'state', access: 'sampled', pingPong: 'read' },
				next: { texture: 'state', access: 'storage-write', pingPong: 'write' }
			}
		});
		const cache = createComputePassResourceResolutionCache();
		const resolve = () => {
			cache.beginFrame();
			return cache.resolve({
				pass,
				context: context({ getTexture: () => material }),
				pingPong: true
			});
		};
		const first = resolve();
		material.publishedView = textureView('published-b');
		material.storageView = textureView('storage-b');
		material.resourceVersion += 1;
		pass.setIterations(5);
		pass.setCompute(NEXT_COMPUTE);
		pass.setDispatch('auto');

		expect(resolve()).toBe(first);
		expect(resolve()).toBe(first);
		expect(cache.getStats()).toMatchObject({ planBuilds: 1, steadyStateHits: 2 });
	});

	it('evicts removed passes and clears renderer-lifetime state', () => {
		const pass = new ComputePass({ compute: COMPUTE });
		const cache = createComputePassResourceResolutionCache();
		cache.beginFrame();
		const first = cache.resolve({ pass, context: context(), pingPong: false });
		cache.delete(pass);
		cache.beginFrame();
		const second = cache.resolve({ pass, context: context(), pingPong: false });
		cache.clear();
		cache.beginFrame();
		const third = cache.resolve({ pass, context: context(), pingPong: false });

		expect(second).not.toBe(first);
		expect(third).not.toBe(second);
		expect(cache.getStats()).toMatchObject({ planBuilds: 3, passEvictions: 1 });
	});
});

it.each(['object-id', 'id-object', 'metadata'] as const)(
	'checks external %s conflicts across cold and cached passes',
	(conflict) => {
		const shared = buffer('shared');
		const make = (second: boolean) =>
			new ComputePass({
				compute: COMPUTE,
				resources: {
					data: {
						buffer: {
							externalBuffer: second && conflict === 'id-object' ? buffer('other') : shared,
							resourceId: second && conflict === 'object-id' ? 'other' : 'data',
							wgslType: second && conflict === 'metadata' ? 'array<u32>' : 'array<f32>',
							size: 256,
							usage: 128
						},
						access: 'storage-read'
					}
				}
			});
		const first = make(false);
		const second = make(true);
		for (const warmed of [[], [first], [second], [first, second]]) {
			for (const order of [
				[first, second],
				[second, first]
			]) {
				const cache = createComputePassResourceResolutionCache();
				const resolve = (pass: ComputePass) =>
					cache.resolve({ pass, context: context(), pingPong: false });
				for (const pass of warmed) {
					cache.beginFrame();
					resolve(pass);
				}
				cache.beginFrame();
				resolve(order[0]!);
				expect(() => resolve(order[1]!)).toThrow(
					/external.*identity|same object|declares metadata/
				);
			}
		}
	}
);

it.each(['texture', 'view', 'sampler'] as const)(
	'replays cached %s registrations without resolving providers twice',
	(kind) => {
		const gpu = kind === 'texture' ? texture('shared') : {};
		const provider = vi.fn(() => gpu as GPUTexture & GPUTextureView & GPUSampler);
		const descriptor = (resourceId: string) =>
			kind === 'sampler'
				? { sampler: { externalSampler: provider, resourceId, type: 'non-filtering' as const } }
				: {
						texture: {
							...(kind === 'texture'
								? { externalTexture: provider as () => GPUTexture }
								: { externalView: provider, mipLevelCount: 1, viewDimension: '2d' as const }),
							resourceId,
							format: 'rgba8unorm' as const,
							usage: 12
						},
						access: 'sampled' as const
					};
		const first = new ComputePass({ compute: COMPUTE, resources: { input: descriptor('a') } });
		const second = new ComputePass({ compute: COMPUTE, resources: { input: descriptor('b') } });
		const cache = createComputePassResourceResolutionCache();
		const resolve = (pass: ComputePass) =>
			cache.resolve({ pass, context: context(), pingPong: false });
		cache.beginFrame();
		resolve(first);
		cache.beginFrame();
		resolve(second);
		provider.mockClear();
		cache.beginFrame();
		resolve(first);
		expect(() => resolve(second)).toThrow(/same object/);
		expect(provider).toHaveBeenCalledTimes(1);
	}
);

it('keeps separate external views of the same logical texture valid when cached', () => {
	const make = (view: GPUTextureView) =>
		new ComputePass({
			compute: COMPUTE,
			resources: {
				input: {
					texture: {
						externalView: view,
						resourceId: 'image',
						format: 'rgba8unorm',
						usage: 4,
						viewDimension: '2d',
						mipLevelCount: 1
					},
					access: 'sampled'
				}
			}
		});
	const passes = [make(textureView('a')), make(textureView('b'))];
	const cache = createComputePassResourceResolutionCache();
	for (let frame = 0; frame < 3; frame += 1) {
		cache.beginFrame();
		for (const pass of passes)
			expect(() => cache.resolve({ pass, context: context(), pingPong: false })).not.toThrow();
	}
	expect(cache.getStats().steadyStateHits).toBe(4);
});
