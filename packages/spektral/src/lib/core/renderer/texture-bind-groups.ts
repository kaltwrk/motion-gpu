import type { RuntimeTextureBinding } from './internal-types.js';

interface CachedGroup {
	uniforms: GPUBuffer;
	bindings: Array<{
		samplerBinding: number;
		textureBinding: number;
		sampler: GPUSampler;
		view: GPUTextureView;
	}>;
	group: GPUBindGroup;
}

/** Two alternating feedback states, scoped to the pipeline and texture-pair lifetime. */
export class TextureBindGroupCache {
	private layouts = new WeakMap<GPUBindGroupLayout, WeakMap<GPUBuffer, CachedGroup[]>>();
	constructor(private readonly device: GPUDevice) {}

	reset(): void {
		this.layouts = new WeakMap();
	}

	get(
		layout: GPUBindGroupLayout,
		frame: GPUBuffer,
		uniforms: GPUBuffer,
		bindings: readonly RuntimeTextureBinding[]
	): GPUBindGroup {
		let frames = this.layouts.get(layout);
		if (!frames) {
			frames = new WeakMap();
			this.layouts.set(layout, frames);
		}
		let groups = frames.get(frame);
		if (!groups) {
			groups = [];
			frames.set(frame, groups);
		}
		for (let index = 0; index < groups.length; index++) {
			const cached = groups[index]!;
			if (cached.uniforms !== uniforms || cached.bindings.length !== bindings.length) continue;
			if (
				!bindings.every((binding, i) => {
					const previous = cached.bindings[i]!;
					return (
						previous.samplerBinding === binding.samplerBinding &&
						previous.textureBinding === binding.textureBinding &&
						previous.sampler === binding.sampler &&
						previous.view === binding.resource.publishedView
					);
				})
			)
				continue;
			if (index !== 0) {
				groups.splice(index, 1);
				groups.unshift(cached);
			}
			return cached.group;
		}
		const entries: GPUBindGroupEntry[] = [
			{ binding: 0, resource: { buffer: frame } },
			{ binding: 1, resource: { buffer: uniforms } }
		];
		for (const binding of bindings) {
			entries.push(
				{ binding: binding.samplerBinding, resource: binding.sampler },
				{ binding: binding.textureBinding, resource: binding.resource.publishedView }
			);
		}
		const group = this.device.createBindGroup({ layout, entries });
		groups.unshift({
			uniforms,
			group,
			bindings: bindings.map((binding) => ({
				samplerBinding: binding.samplerBinding,
				textureBinding: binding.textureBinding,
				sampler: binding.sampler,
				view: binding.resource.publishedView
			}))
		});
		if (groups.length > 2) groups.pop();
		return group;
	}
}
