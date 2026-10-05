import { describe, expect, it, vi } from 'vitest';
import type { RenderPassContext, RenderTarget } from 'spektral';
import { createBloomComposite } from '$lib/site/demos/nixie/bloom';

describe('Nixie HDR composite lifecycle', () => {
	it('binds scene and named bloom independently, then replaces resized views without taking target ownership', () => {
		const target = (format: GPUTextureFormat = 'rgba16float'): RenderTarget => ({
			texture: { destroy: vi.fn() } as unknown as GPUTexture,
			view: {} as GPUTextureView,
			width: 100,
			height: 100,
			format
		});
		const pipeline = { getBindGroupLayout: vi.fn(() => ({})) };
		const device = {
			createShaderModule: vi.fn(() => ({})),
			createRenderPipeline: vi.fn(() => pipeline),
			createSampler: vi.fn(() => ({})),
			createBindGroup: vi.fn(() => ({}))
		};
		const encoder = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
		const source = target();
		const output = target();
		const bloom = target();
		const context = {
			device: device as unknown as GPUDevice,
			commandEncoder: {} as GPUCommandEncoder,
			source,
			target: output,
			canvas: output,
			input: source,
			output,
			targets: { halo: bloom },
			time: 0,
			delta: 1 / 60,
			width: 100,
			height: 100,
			clear: true,
			clearColor: [0, 0, 0, 1],
			preserve: true,
			beginRenderPass: () => encoder as unknown as GPURenderPassEncoder
		} satisfies RenderPassContext;
		const pass = createBloomComposite('halo');
		pass.render(context);
		expect(device.createBindGroup).toHaveBeenLastCalledWith(
			expect.objectContaining({
				entries: [
					{ binding: 0, resource: expect.any(Object) },
					{ binding: 1, resource: source.view },
					{ binding: 2, resource: bloom.view }
				]
			})
		);
		pass.render(context);
		expect(device.createBindGroup).toHaveBeenCalledTimes(1);
		const resized = { ...context, input: target(), targets: { halo: target() } };
		pass.setSize?.(200, 200);
		pass.render(resized);
		expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
		expect(device.createBindGroup).toHaveBeenLastCalledWith(
			expect.objectContaining({
				entries: [
					{ binding: 0, resource: expect.any(Object) },
					{ binding: 1, resource: resized.input.view },
					{ binding: 2, resource: resized.targets.halo.view }
				]
			})
		);
		expect(encoder.draw).toHaveBeenCalledWith(3);
		pass.dispose?.();
		expect(source.texture.destroy).not.toHaveBeenCalled();
		expect(bloom.texture.destroy).not.toHaveBeenCalled();
		pass.render(resized);
		expect(device.createRenderPipeline).toHaveBeenCalledTimes(2);
	});
});
