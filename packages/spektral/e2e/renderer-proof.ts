import { defineMaterial, resolveMaterial } from '../src/lib/core/material';
import { createRenderer } from '../src/lib/core/renderer';
import { PingPongShaderPass } from '../src/lib/passes/PingPongShaderPass';
import { ShaderPass } from '../src/lib/passes/ShaderPass';
import type { ColorPipelineOptions, TextureDefinition, TextureMap } from '../src/lib/core/types';

/** Read the submitted result, including the values the GPU actually sees in uniform buffers. */
export async function readFeedbackResolution(): Promise<number[]> {
	const canvas = document.createElement('canvas');
	const material = resolveMaterial(
		defineMaterial({
			fragment: `fn frag(uv: vec2f) -> vec4f {
				let a = textureLoad(first, vec2i(0), 0);
				let b = textureLoad(second, vec2i(0), 0);
				return vec4f(a.r, b.g, spektralFrame.resolution.x / 64.0, 1.0);
			}`,
			textures: {
				first: { colorSpace: 'linear' },
				second: { colorSpace: 'linear' }
			}
		})
	);
	const fragment = `fn frag(uv: vec2f) -> vec4f {
		return vec4f(spektralFrame.resolution / 64.0, 0.0, 1.0);
	}`;
	const renderer = await createRenderer({
		canvas,
		fragmentWgsl: material.fragmentWgsl,
		fragmentSource: material.fragmentSource,
		fragmentLineMap: [...material.fragmentLineMap],
		includeSources: material.includeSources,
		uniformLayout: material.uniformLayout,
		textureKeys: [...material.textureKeys],
		textureDefinitions: material.textures,
		passes: [
			new PingPongShaderPass({ target: 'first', width: 16, height: 8, fragment }),
			new PingPongShaderPass({ target: 'second', width: 8, height: 32, fragment })
		],
		getDpr: () => 1,
		getClearColor: () => [0, 0, 0, 1],
		color: { outputEncoding: 'linear' }
	});
	try {
		renderer.render({
			time: 0,
			delta: 0.016,
			renderMode: 'manual',
			uniforms: {},
			textures: {},
			canvasSize: { width: 64, height: 64 }
		});
		const output = document.createElement('canvas');
		output.width = 1;
		output.height = 1;
		const context = output.getContext('2d');
		if (!context) throw new Error('Canvas 2D context is unavailable');
		context.drawImage(canvas, 0, 0);
		return [...context.getImageData(0, 0, 1, 1).data];
	} finally {
		renderer.destroy();
	}
}

async function readTextureSequence(
	definition: TextureDefinition,
	values: TextureMap[],
	fragment = 'fn frag(uv: vec2f) -> vec4f { return textureLoad(photo, vec2i(0), 0); }'
): Promise<number[][]> {
	const canvas = document.createElement('canvas');
	const material = resolveMaterial(
		defineMaterial({
			fragment,
			textures: { photo: definition }
		})
	);
	const renderer = await createRenderer({
		canvas,
		fragmentWgsl: material.fragmentWgsl,
		fragmentSource: material.fragmentSource,
		fragmentLineMap: [...material.fragmentLineMap],
		includeSources: material.includeSources,
		uniformLayout: material.uniformLayout,
		textureKeys: [...material.textureKeys],
		textureDefinitions: material.textures,
		passes: [],
		getDpr: () => 1,
		getClearColor: () => [0, 0, 0, 1],
		color: { outputEncoding: 'linear' }
	});
	try {
		const output = document.createElement('canvas');
		output.width = output.height = 1;
		const context = output.getContext('2d');
		if (!context) throw new Error('Canvas 2D context is unavailable');
		return values.map((textures) => {
			renderer.render({
				time: 0,
				delta: 0.016,
				renderMode: 'manual',
				uniforms: {},
				textures,
				canvasSize: { width: 1, height: 1 }
			});
			context.drawImage(canvas, 0, 0);
			return [...context.getImageData(0, 0, 1, 1).data];
		});
	} finally {
		renderer.destroy();
	}
}

export async function readTextureReset(): Promise<number[][]> {
	const source = document.createElement('canvas');
	source.width = source.height = 1;
	const context = source.getContext('2d');
	if (!context) throw new Error('Canvas 2D context is unavailable');
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, 1, 1);
	return readTextureSequence({ source }, [{}, { photo: null }, { photo: null }, {}]);
}

export async function readAnisotropicTexture(generateMipmaps: boolean): Promise<number[][]> {
	const source = document.createElement('canvas');
	source.width = source.height = 4;
	const context = source.getContext('2d');
	if (!context) throw new Error('Canvas 2D context is unavailable');
	context.fillStyle = '#00ff00';
	context.fillRect(0, 0, 4, 4);
	return readTextureSequence(
		{ source, anisotropy: 4, generateMipmaps },
		[{}],
		'fn frag(uv: vec2f) -> vec4f { return textureSample(photo, photoSampler, uv); }'
	);
}

export async function readTextureColorSpace(format?: GPUTextureFormat): Promise<number[][]> {
	const source = document.createElement('canvas');
	source.width = source.height = 2;
	const context = source.getContext('2d');
	if (!context) throw new Error('Canvas 2D context is unavailable');
	context.fillStyle = '#808080';
	context.fillRect(0, 0, 2, 2);
	return readTextureSequence({ source, generateMipmaps: true, ...(format ? { format } : {}) }, [
		{},
		{ photo: { source, colorSpace: 'linear' } },
		{ photo: { source, colorSpace: 'srgb' } },
		{}
	]);
}

export async function readPostprocessColors(
	constant: boolean,
	color: ColorPipelineOptions
): Promise<number[]> {
	const canvas = document.createElement('canvas');
	const material = resolveMaterial(
		defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(0.25, 0.25, 0.25, 1.0); }'
		})
	);
	const pass = new ShaderPass({
		fragment: `fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
			return vec4f(${constant ? 'vec3f(0.5)' : 'inputColor.rgb * 2.0'}, 1.0);
		}`
	});
	const renderer = await createRenderer({
		canvas,
		fragmentWgsl: material.fragmentWgsl,
		fragmentSource: material.fragmentSource,
		fragmentLineMap: [...material.fragmentLineMap],
		includeSources: material.includeSources,
		uniformLayout: material.uniformLayout,
		textureKeys: [...material.textureKeys],
		textureDefinitions: material.textures,
		passes: [pass],
		getDpr: () => 1,
		getClearColor: () => [0, 0, 0, 1],
		color
	});
	try {
		const output = document.createElement('canvas');
		output.width = output.height = 1;
		const context = output.getContext('2d');
		if (!context) throw new Error('Canvas 2D context is unavailable');
		return [true, false, true].map((enabled) => {
			pass.enabled = enabled;
			renderer.render({
				time: 0,
				delta: 0.016,
				renderMode: 'manual',
				uniforms: {},
				textures: {},
				canvasSize: { width: 1, height: 1 }
			});
			context.drawImage(canvas, 0, 0);
			return context.getImageData(0, 0, 1, 1).data[0]!;
		});
	} finally {
		renderer.destroy();
	}
}

export async function readAbortedFeedback(kind: 'fragment' | 'compute'): Promise<number[]> {
	const { PingPongComputePass } = await import('../src/lib/passes/PingPongComputePass');
	const canvas = document.createElement('canvas');
	const material = resolveMaterial(
		defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return textureLoad(sim, vec2i(0), 0); }',
			textures: {
				sim: {
					colorSpace: 'linear',
					...(kind === 'compute'
						? ({ storage: true, format: 'rgba16float', width: 4, height: 4 } as const)
						: {})
				}
			}
		})
	);
	const feedback =
		kind === 'fragment'
			? new PingPongShaderPass({
					target: 'sim',
					width: 4,
					height: 4,
					fragment:
						'fn frag(uv: vec2f) -> vec4f { return vec4f(textureLoad(spektralPrevious, vec2i(0), 0).r + 0.1, 0.0, 0.0, 1.0); }'
				})
			: new PingPongComputePass({
					compute:
						'@compute @workgroup_size(1) fn compute(@builtin(global_invocation_id) id: vec3u) { if (id.x < 4u && id.y < 4u) { textureStore(next, vec2i(id.xy), vec4f(textureLoad(previous, vec2i(id.xy), 0).r + 0.1, 0.0, 0.0, 1.0)); } }',
					resources: {
						previous: { texture: 'sim', access: 'sampled', pingPong: 'read' },
						next: { texture: 'sim', access: 'storage-write', pingPong: 'write' }
					}
				});
	let fail = false;
	const renderer = await createRenderer({
		canvas,
		fragmentWgsl: material.fragmentWgsl,
		fragmentSource: material.fragmentSource,
		fragmentLineMap: [...material.fragmentLineMap],
		includeSources: material.includeSources,
		uniformLayout: material.uniformLayout,
		textureKeys: [...material.textureKeys],
		textureDefinitions: material.textures,
		passes: [
			feedback,
			{
				needsSwap: false,
				render() {
					if (fail) throw new Error('Aborted');
				}
			}
		],
		getDpr: () => 1,
		getClearColor: () => [0, 0, 0, 1],
		color: { outputEncoding: 'linear' }
	});
	const output = document.createElement('canvas');
	output.width = output.height = 4;
	const context = output.getContext('2d')!;
	const draw = () =>
		renderer.render({
			time: 0,
			delta: 0.016,
			renderMode: 'manual',
			uniforms: {},
			textures: {},
			canvasSize: { width: 4, height: 4 }
		});
	const read = () => {
		context.drawImage(canvas, 0, 0);
		return context.getImageData(0, 0, 1, 1).data[0]!;
	};
	try {
		draw();
		const first = read();
		fail = true;
		try {
			draw();
			throw new Error('Expected an aborted frame');
		} catch (error) {
			if (!(error instanceof Error) || error.message !== 'Aborted') throw error;
		}
		fail = false;
		draw();
		return [first, read()];
	} finally {
		renderer.destroy();
	}
}

export async function readFeedbackFormat(
	matching: boolean
): Promise<{ red: number | null; error: string | null; validation: string | null }> {
	const canvas = document.createElement('canvas');
	const material = resolveMaterial(
		defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return textureLoad(sim, vec2i(0), 0); }',
			textures: { sim: matching ? { format: 'rgba32float' } : {} }
		})
	);
	const renderer = await createRenderer({
		canvas,
		fragmentWgsl: material.fragmentWgsl,
		fragmentSource: material.fragmentSource,
		fragmentLineMap: [...material.fragmentLineMap],
		includeSources: material.includeSources,
		uniformLayout: material.uniformLayout,
		textureKeys: [...material.textureKeys],
		textureDefinitions: material.textures,
		passes: [
			new PingPongShaderPass({
				target: 'sim',
				format: 'rgba32float',
				width: 4,
				height: 4,
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(0.25, 0.0, 0.0, 1.0); }'
			})
		],
		getDpr: () => 1,
		getClearColor: () => [0, 0, 0, 1],
		color: { outputEncoding: 'linear' }
	});
	const device = renderer.getDevice!();
	device.pushErrorScope('validation');
	let error: string | null = null;
	let red: number | null = null;
	try {
		try {
			renderer.render({
				time: 0,
				delta: 0.016,
				renderMode: 'manual',
				uniforms: {},
				textures: {},
				canvasSize: { width: 4, height: 4 }
			});
		} catch (cause) {
			error = String(cause);
		}
		const validation = (await device.popErrorScope())?.message ?? null;
		if (!error && !validation) {
			const output = document.createElement('canvas');
			const context = output.getContext('2d')!;
			context.drawImage(canvas, 0, 0);
			red = context.getImageData(0, 0, 1, 1).data[0]!;
		}
		return { red, error, validation };
	} finally {
		renderer.destroy();
	}
}

/** A failed sibling update must not leave the scene bound to a destroyed allocation. */
export async function readTextureUpdateRecovery(): Promise<{
	error: string | null;
	validation: string | null;
	pixel: number[];
}> {
	const source = document.createElement('canvas');
	source.width = source.height = 2;
	source.getContext('2d')!.fillRect(0, 0, 2, 2);
	const replacement = document.createElement('canvas');
	replacement.width = replacement.height = 4;
	const paint = replacement.getContext('2d')!;
	paint.fillStyle = '#00ff00';
	paint.fillRect(0, 0, 4, 4);
	const canvas = document.createElement('canvas');
	const material = resolveMaterial(
		defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return textureLoad(a, vec2i(0), 0); }',
			textures: { a: { source }, b: {} }
		})
	);
	const renderer = await createRenderer({
		canvas,
		fragmentWgsl: material.fragmentWgsl,
		uniformLayout: material.uniformLayout,
		textureKeys: [...material.textureKeys],
		textureDefinitions: material.textures,
		fragmentSource: material.fragmentSource,
		fragmentLineMap: [...material.fragmentLineMap],
		includeSources: material.includeSources,
		getDpr: () => 1,
		getClearColor: () => [0, 0, 0, 1]
	});
	const frame = {
		time: 0,
		delta: 0.016,
		renderMode: 'manual' as const,
		uniforms: {},
		canvasSize: { width: 4, height: 4 }
	};
	try {
		const device = renderer.getDevice!();
		device.pushErrorScope('validation');
		renderer.render({ ...frame, textures: {} });
		let error: string | null = null;
		try {
			renderer.render({ ...frame, textures: { a: replacement, b: { source, width: 0 } } });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
		renderer.render({ ...frame, textures: { a: replacement, b: null } });
		const output = document.createElement('canvas');
		output.width = output.height = 1;
		const context = output.getContext('2d')!;
		context.drawImage(canvas, 0, 0);
		const pixel = [...context.getImageData(0, 0, 1, 1).data];
		const validation = (await device.popErrorScope())?.message ?? null;
		return { error, validation, pixel };
	} finally {
		renderer.destroy();
	}
}
