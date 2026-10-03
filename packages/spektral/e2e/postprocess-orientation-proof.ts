import { defineMaterial, resolveMaterial } from '../src/lib/core/material';
import { createRenderer } from '../src/lib/core/renderer';
import { BlitPass, CopyPass, ShaderPass } from '../src/lib/passes';

export type OrientationPass =
	| 'direct'
	| 'copy'
	| 'copy-clear'
	| 'copy-canvas'
	| 'blit'
	| 'shader'
	| 'shader-uv'
	| 'two-blits';

export async function readPostprocessOrientation(
	kind: OrientationPass,
	workingFormat: 'rgba8unorm' | 'rgba16float'
) {
	const canvas = document.createElement('canvas');
	const material = resolveMaterial(
		defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.25, 1.0); }'
		})
	);
	const passes = {
		direct: [],
		copy: [new CopyPass()],
		'copy-clear': [new CopyPass({ clear: true })],
		'copy-canvas': [new CopyPass({ needsSwap: false, output: 'canvas' })],
		blit: [new BlitPass()],
		shader: [
			new ShaderPass({
				fragment: 'fn shade(inputColor: vec4f, uv: vec2f) -> vec4f { return inputColor; }'
			})
		],
		'shader-uv': [
			new ShaderPass({
				fragment:
					'fn shade(inputColor: vec4f, uv: vec2f) -> vec4f { return vec4f(inputColor.r, uv.y, inputColor.b, inputColor.a); }'
			})
		],
		'two-blits': [new BlitPass(), new BlitPass()]
	}[kind];
	const renderer = await createRenderer({
		canvas,
		fragmentWgsl: material.fragmentWgsl,
		fragmentSource: material.fragmentSource,
		fragmentLineMap: [...material.fragmentLineMap],
		includeSources: material.includeSources,
		uniformLayout: material.uniformLayout,
		textureKeys: [],
		textureDefinitions: {},
		passes,
		getDpr: () => 1,
		getClearColor: () => [0, 0, 0, 1],
		color: { workingFormat, outputEncoding: 'linear' }
	});
	const device = renderer.getDevice!();
	const createTexture = device.createTexture;
	const allocations: Array<{ width: number; height: number; format: GPUTextureFormat }> = [];
	device.createTexture = function (descriptor) {
		const texture = createTexture.call(this, descriptor);
		if ((texture.usage & GPUTextureUsage.TEXTURE_BINDING) !== 0 && texture.width > 1) {
			allocations.push({ width: texture.width, height: texture.height, format: texture.format });
		}
		return texture;
	};
	device.pushErrorScope('validation');
	try {
		const probe = document.createElement('canvas');
		const context = probe.getContext('2d');
		if (!context) throw new Error('Canvas 2D context is unavailable');
		const pixels = [8, 16].map((size) => {
			renderer.render({
				time: 0,
				delta: 0.016,
				renderMode: 'manual',
				uniforms: {},
				textures: {},
				canvasSize: { width: size, height: size }
			});
			probe.width = probe.height = size;
			context.drawImage(canvas, 0, 0);
			return [
				[0, 0],
				[size - 1, 0],
				[0, size - 1],
				[size - 1, size - 1]
			].map(([x, y]) => [...context.getImageData(x!, y!, 1, 1).data]);
		});
		return { pixels, allocations, validation: (await device.popErrorScope())?.message ?? null };
	} finally {
		device.createTexture = createTexture;
		renderer.destroy();
	}
}
