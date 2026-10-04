import { describe, expect, it, vi } from 'vitest';
import { TextureBindGroupCache } from '../../lib/core/renderer/texture-bind-groups';
import type { RuntimeTextureBinding } from '../../lib/core/renderer/internal-types';

describe('TextureBindGroupCache', () => {
	it('retains two resource combinations per layout and frame buffer and evicts the least recent', () => {
		const device = { createBindGroup: vi.fn(() => ({})) };
		const cache = new TextureBindGroupCache(device as unknown as GPUDevice);
		const layout = {} as GPUBindGroupLayout;
		const frame = {} as GPUBuffer;
		const uniforms = {} as GPUBuffer;
		const binding = {
			samplerBinding: 2,
			textureBinding: 3,
			sampler: {},
			resource: { publishedView: {} }
		} as RuntimeTextureBinding;
		const views = [{}, {}, {}] as GPUTextureView[];
		const get = (view: GPUTextureView) => {
			binding.resource.publishedView = view;
			return cache.get(layout, frame, uniforms, [binding]);
		};
		const a = get(views[0]!);
		const b = get(views[1]!);
		expect(get(views[0]!)).toBe(a);
		get(views[2]!);
		expect(get(views[0]!)).toBe(a);
		expect(get(views[1]!)).not.toBe(b);
		expect(device.createBindGroup).toHaveBeenCalledTimes(4);
	});

	it.each(['layout', 'frame', 'uniforms', 'sampler', 'view', 'binding'] as const)(
		'invalidates changed %s and clears on reset',
		(changed) => {
			const device = { createBindGroup: vi.fn(() => ({})) };
			const cache = new TextureBindGroupCache(device as unknown as GPUDevice);
			let layout = {} as GPUBindGroupLayout;
			let frame = {} as GPUBuffer;
			let uniforms = {} as GPUBuffer;
			const binding = {
				samplerBinding: 2,
				textureBinding: 3,
				sampler: {},
				resource: { publishedView: {} }
			} as RuntimeTextureBinding;
			const get = () => cache.get(layout, frame, uniforms, [binding]);
			const first = get();
			expect(get()).toBe(first);
			if (changed === 'layout') layout = {} as GPUBindGroupLayout;
			if (changed === 'frame') frame = {} as GPUBuffer;
			if (changed === 'uniforms') uniforms = {} as GPUBuffer;
			if (changed === 'sampler') binding.sampler = {} as GPUSampler;
			if (changed === 'view') binding.resource.publishedView = {} as GPUTextureView;
			if (changed === 'binding') binding.textureBinding++;
			const second = get();
			expect(second).not.toBe(first);
			expect(get()).toBe(second);
			cache.reset();
			expect(get()).not.toBe(second);
			expect(device.createBindGroup).toHaveBeenCalledTimes(3);
		}
	);
});
