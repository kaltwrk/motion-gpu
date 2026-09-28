import { defineMaterial, resolveMaterial, type FragMaterial } from '../src/lib/core/material';
import { createRenderer } from '../src/lib/core/renderer';
import type { AnyPass, TextureMap } from '../src/lib/core/types';
import { ComputePass } from '../src/lib/passes/ComputePass';
import { PingPongComputePass } from '../src/lib/passes/PingPongComputePass';

async function createProofRenderer(material: FragMaterial, passes: AnyPass[]) {
	const canvas = document.createElement('canvas');
	const resolved = resolveMaterial(material);
	const renderer = await createRenderer({
		canvas,
		fragmentWgsl: resolved.fragmentWgsl,
		fragmentSource: resolved.fragmentSource,
		fragmentLineMap: [...resolved.fragmentLineMap],
		includeSources: resolved.includeSources,
		uniformLayout: resolved.uniformLayout,
		textureKeys: [...resolved.textureKeys],
		textureDefinitions: resolved.textures,
		storageTextureKeys: [...resolved.storageTextureKeys],
		getPasses: () => passes,
		getDpr: () => 1,
		getClearColor: () => [0, 0, 0, 1],
		color: { outputEncoding: 'linear' }
	});
	const device = renderer.getDevice!();
	const output = document.createElement('canvas');
	output.width = output.height = 1;
	const context = output.getContext('2d');
	if (!context) throw new Error('Canvas 2D context is unavailable');
	return {
		renderer,
		async draw(textures: TextureMap = {}) {
			device.pushErrorScope('validation');
			let pixel: number[];
			let error: GPUError | null;
			try {
				renderer.render({
					time: 0,
					delta: 0.016,
					renderMode: 'manual',
					uniforms: {},
					textures,
					canvasSize: { width: 2, height: 2 }
				});
				context.drawImage(canvas, 0, 0);
				pixel = [...context.getImageData(0, 0, 1, 1).data];
				await device.queue.onSubmittedWorkDone();
			} finally {
				error = await device.popErrorScope();
			}
			if (error) throw new Error(error.message);
			return pixel;
		}
	};
}

export async function readComputeRemoval(
	action: 'remove' | 'replace' | 'remount' | 'disable' | 'switch-writer'
) {
	const pingPong = new PingPongComputePass({
		compute: `@compute @workgroup_size(1) fn compute(@builtin(global_invocation_id) id: vec3u) {
			let value = textureLoad(previous, id.xy, 0);
			textureStore(next, id.xy, vec4f(value.r + 0.125, 0.0, 0.0, 1.0));
		}`,
		resources: {
			previous: { texture: 'sim', access: 'sampled', pingPong: 'read' },
			next: { texture: 'sim', access: 'storage-write', pingPong: 'write' }
		}
	});
	const consumer = new ComputePass({
		compute: `@compute @workgroup_size(1) fn compute(@builtin(global_invocation_id) id: vec3u) {
			textureStore(observed, id.xy, textureLoad(input, id.xy, 0));
		}`,
		resources: {
			input: { texture: 'sim', access: 'sampled' },
			observed: { texture: 'observed', access: 'storage-write' }
		}
	});
	const passes: AnyPass[] = [consumer, pingPong];
	const proof = await createProofRenderer(
		defineMaterial({
			fragment: `fn frag(uv: vec2f) -> vec4f {
			let direct = textureLoad(sim, vec2i(0), 0);
			let copied = textureLoad(observed, vec2i(0), 0);
			return vec4f(direct.r, direct.g, copied.g + copied.r, 1.0);
		}`,
			textures: {
				sim: { storage: true, format: 'rgba8unorm', width: 2, height: 2 },
				observed: { storage: true, format: 'rgba8unorm', width: 2, height: 2 }
			}
		}),
		passes
	);
	try {
		const pixels = [await proof.draw()];
		if (action === 'disable' || action === 'switch-writer') pingPong.enabled = false;
		else passes.splice(1, 1);
		if (action === 'replace' || action === 'switch-writer') {
			passes.push(
				new ComputePass({
					compute: `@compute @workgroup_size(1) fn compute(@builtin(global_invocation_id) id: vec3u) {
					textureStore(next, id.xy, vec4f(0.0, 1.0, 0.0, 1.0));
				}`,
					resources: { next: { texture: 'sim', access: 'storage-write' } }
				})
			);
		}
		pixels.push(await proof.draw());
		if (action === 'remount') passes.push(pingPong);
		pixels.push(await proof.draw());
		if (action === 'switch-writer') {
			passes.at(-1)!.enabled = false;
			pingPong.enabled = true;
			pixels.push(await proof.draw());
			pingPong.enabled = false;
			passes.at(-1)!.enabled = true;
			pixels.push(await proof.draw());
		}
		return pixels;
	} finally {
		proof.renderer.destroy();
	}
}
