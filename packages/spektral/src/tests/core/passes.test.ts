import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlitPass, CopyPass, ShaderPass } from '../../lib/passes';
import type { RenderPassContext, RenderTarget } from '../../lib/core/types';
import {
	prepareFullscreenPass,
	type PreparedFullscreenPassContract
} from '../../lib/core/pass-brand';

function createTarget(key: string): RenderTarget {
	return {
		texture: {
			key,
			usage:
				key === 'canvas'
					? GPUTextureUsage.RENDER_ATTACHMENT
					: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
		} as unknown as GPUTexture,
		view: { key: `${key}-view` } as unknown as GPUTextureView,
		width: 32,
		height: 32,
		format: 'rgba8unorm'
	};
}

function createFakeDevice() {
	return {
		createSampler: vi.fn(() => ({ type: 'sampler' }) as unknown as GPUSampler),
		createBindGroupLayout: vi.fn(
			() => ({ type: 'bind-group-layout' }) as unknown as GPUBindGroupLayout
		),
		createShaderModule: vi.fn((descriptor: GPUShaderModuleDescriptor) => {
			void descriptor;
			return {
				type: 'shader-module',
				getCompilationInfo: vi.fn(async () => ({ messages: [] }))
			} as unknown as GPUShaderModule;
		}),
		createPipelineLayout: vi.fn(
			() => ({ type: 'pipeline-layout' }) as unknown as GPUPipelineLayout
		),
		createRenderPipeline: vi.fn(() => ({ type: 'pipeline' }) as unknown as GPURenderPipeline),
		createRenderPipelineAsync: vi.fn(
			async () => ({ type: 'pipeline' }) as unknown as GPURenderPipeline
		),
		pushErrorScope: vi.fn(),
		popErrorScope: vi.fn(async () => null),
		createBindGroup: vi.fn(() => ({ type: 'bind-group' }) as unknown as GPUBindGroup)
	} satisfies Partial<GPUDevice>;
}

async function preparePass(
	pass: PreparedFullscreenPassContract,
	context: RenderPassContext,
	owner: object = pass
): Promise<void> {
	await pass[prepareFullscreenPass]({
		device: context.device,
		owner,
		inputFormat: context.input.format,
		outputFormat: context.output.format
	});
}

function createPassContext(overrides?: Partial<RenderPassContext>): RenderPassContext {
	const source = createTarget('source');
	const target = createTarget('target');
	const canvas = createTarget('canvas');

	return {
		clear: false,
		clearColor: [0, 0, 0, 1],
		preserve: true,
		device: createFakeDevice() as unknown as GPUDevice,
		commandEncoder: {
			copyTextureToTexture: vi.fn()
		} as unknown as GPUCommandEncoder,
		source,
		target,
		canvas,
		input: source,
		output: target,
		targets: {},
		time: 0,
		delta: 0.016,
		width: 32,
		height: 32,
		beginRenderPass: vi.fn(
			() =>
				({
					setPipeline: vi.fn(),
					setBindGroup: vi.fn(),
					draw: vi.fn(),
					end: vi.fn()
				}) as unknown as GPURenderPassEncoder
		),
		...overrides
	};
}

describe('built-in passes', () => {
	beforeEach(() => {
		vi.stubGlobal('GPUShaderStage', { FRAGMENT: 0x10 });
		vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, RENDER_ATTACHMENT: 16 });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('configures default BlitPass flow', () => {
		const pass = new BlitPass();
		expect(pass.enabled).toBe(true);
		expect(pass.needsSwap).toBe(true);
		expect(pass.input).toBe('source');
		expect(pass.output).toBe('target');
		expect(pass.clear).toBe(false);
		expect(pass.preserve).toBe(true);
	});

	it('configures default CopyPass flow', () => {
		const pass = new CopyPass();
		expect(pass.enabled).toBe(true);
		expect(pass.needsSwap).toBe(true);
		expect(pass.input).toBe('source');
		expect(pass.output).toBe('target');
		expect(pass.clear).toBe(false);
		expect(pass.preserve).toBe(true);
	});

	it('supports named input/output slots for non-swap passes', () => {
		const blit = new BlitPass({ needsSwap: false, input: 'fxMain', output: 'fxBloom' });
		expect(blit.input).toBe('fxMain');
		expect(blit.output).toBe('fxBloom');

		const copy = new CopyPass({ needsSwap: false, input: 'fxBloom', output: 'fxFinal' });
		expect(copy.input).toBe('fxBloom');
		expect(copy.output).toBe('fxFinal');

		const shader = new ShaderPass({
			needsSwap: false,
			input: 'fxFinal',
			output: 'canvas',
			fragment: `
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	return vec4f(inputColor.rgb * vec3f(uv, 1.0), inputColor.a);
}
`
		});
		expect(shader.input).toBe('fxFinal');
		expect(shader.output).toBe('canvas');
	});

	it('validates ShaderPass fragment contract', () => {
		expect(
			() =>
				new ShaderPass({
					fragment: 'fn broken() -> vec4f { return vec4f(1.0); }'
				})
		).toThrow(/fn shade\(inputColor: vec4f, uv: vec2f\) -> vec4f/);

		const pass = new ShaderPass({
			fragment: `
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	return vec4f(inputColor.rgb * vec3f(uv, 1.0), inputColor.a);
}
`
		});
		expect(pass.getFragment()).toContain('fn shade(inputColor: vec4f, uv: vec2f)');
	});

	it('exposes fragment-local uv to ShaderPass helper functions', async () => {
		const pass = new ShaderPass({
			fragment: `
fn getUv() -> vec2f {
	return spektralFragment.uv;
}

fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	return vec4f(getUv(), distance(getUv(), uv), inputColor.a);
}
`
		});
		const context = createPassContext();
		const device = context.device as unknown as ReturnType<typeof createFakeDevice>;

		await preparePass(pass, context);
		pass.render(context);

		const descriptor = device.createShaderModule.mock.calls[0]?.[0] as
			| GPUShaderModuleDescriptor
			| undefined;
		const source = String(descriptor?.code ?? '');
		expect(source).toContain('var<private> spektralFragment: SpektralFragment;');
		expect(source).toContain('return spektralFragment.uv;');
		expect(source).toContain('spektralFragment.uv = in.uv;');
		expect(source.indexOf('spektralFragment.uv = in.uv;')).toBeLessThan(
			source.indexOf('return shade(inputColor, in.uv);')
		);
	});

	it('uses direct GPU copy path when CopyPass surfaces are compatible', () => {
		const pass = new CopyPass();
		const context = createPassContext();
		const fallbackRender = vi.spyOn(
			(pass as unknown as { fallbackBlit: BlitPass }).fallbackBlit,
			'render'
		);

		pass.render(context);

		expect(context.commandEncoder.copyTextureToTexture).toHaveBeenCalledTimes(1);
		expect(fallbackRender).not.toHaveBeenCalled();
	});

	it('copies compatible surfaces without accessing the lazy canvas surface', () => {
		const pass = new CopyPass();
		const context = createPassContext();
		const canvas = context.canvas;
		const getCanvas = vi.fn(() => canvas);
		Object.defineProperty(context, 'canvas', { get: getCanvas });
		pass.render(context);
		expect(context.commandEncoder.copyTextureToTexture).toHaveBeenCalledOnce();
		expect(getCanvas).not.toHaveBeenCalled();
	});

	it.each(['input', 'output'] as const)(
		'falls back when %s lacks the required GPU copy usage',
		async (slot) => {
			const pass = new CopyPass();
			const context = createPassContext();
			context[slot].texture = {
				usage: slot === 'input' ? GPUTextureUsage.COPY_DST : GPUTextureUsage.COPY_SRC
			} as GPUTexture;
			await preparePass(pass, context);
			pass.render(context);
			expect(context.commandEncoder.copyTextureToTexture).not.toHaveBeenCalled();
			expect(context.beginRenderPass).toHaveBeenCalledOnce();
		}
	);

	it('falls back to blit when CopyPass cannot use direct copy', async () => {
		const pass = new CopyPass();
		const context = createPassContext({ clear: true });
		const fallbackRender = vi.spyOn(
			(pass as unknown as { fallbackBlit: BlitPass }).fallbackBlit,
			'render'
		);

		await preparePass(pass, context);
		pass.render(context);

		expect(context.commandEncoder.copyTextureToTexture).not.toHaveBeenCalled();
		expect(fallbackRender).toHaveBeenCalledTimes(1);
	});

	it('falls back to blit when source and target dimensions mismatch', async () => {
		const pass = new CopyPass();
		const context = createPassContext();
		context.output = { ...context.output, width: context.input.width + 1 };
		const fallbackRender = vi.spyOn(
			(pass as unknown as { fallbackBlit: BlitPass }).fallbackBlit,
			'render'
		);

		await preparePass(pass, context);
		pass.render(context);

		expect(context.commandEncoder.copyTextureToTexture).not.toHaveBeenCalled();
		expect(fallbackRender).toHaveBeenCalledTimes(1);
	});

	it('falls back to blit when source and target formats mismatch', async () => {
		const pass = new CopyPass();
		const context = createPassContext();
		context.output = { ...context.output, format: 'rgba16float' };
		const fallbackRender = vi.spyOn(
			(pass as unknown as { fallbackBlit: BlitPass }).fallbackBlit,
			'render'
		);

		await preparePass(pass, context);
		pass.render(context);

		expect(context.commandEncoder.copyTextureToTexture).not.toHaveBeenCalled();
		expect(fallbackRender).toHaveBeenCalledTimes(1);
	});

	it('falls back to blit when copying to the same texture', async () => {
		const pass = new CopyPass();
		const context = createPassContext();
		context.output = context.input;
		const fallbackRender = vi.spyOn(
			(pass as unknown as { fallbackBlit: BlitPass }).fallbackBlit,
			'render'
		);

		await preparePass(pass, context);
		pass.render(context);

		expect(context.commandEncoder.copyTextureToTexture).not.toHaveBeenCalled();
		expect(fallbackRender).toHaveBeenCalledTimes(1);
	});

	it('falls back to blit when preserve=false', async () => {
		const pass = new CopyPass();
		const context = createPassContext({ preserve: false });
		const fallbackRender = vi.spyOn(
			(pass as unknown as { fallbackBlit: BlitPass }).fallbackBlit,
			'render'
		);

		await preparePass(pass, context);
		pass.render(context);

		expect(context.commandEncoder.copyTextureToTexture).not.toHaveBeenCalled();
		expect(fallbackRender).toHaveBeenCalledTimes(1);
	});

	it('falls back to blit when source or target resolves to canvas texture', async () => {
		const pass = new CopyPass();
		const sourceCanvasContext = createPassContext();
		sourceCanvasContext.input = sourceCanvasContext.canvas;
		const sourceFallback = vi.spyOn(
			(pass as unknown as { fallbackBlit: BlitPass }).fallbackBlit,
			'render'
		);
		await preparePass(pass, sourceCanvasContext);
		pass.render(sourceCanvasContext);
		expect(sourceCanvasContext.commandEncoder.copyTextureToTexture).not.toHaveBeenCalled();
		expect(sourceFallback).toHaveBeenCalledTimes(1);

		sourceFallback.mockClear();

		const targetCanvasContext = createPassContext();
		targetCanvasContext.output = targetCanvasContext.canvas;
		await preparePass(pass, targetCanvasContext);
		pass.render(targetCanvasContext);
		expect(targetCanvasContext.commandEncoder.copyTextureToTexture).not.toHaveBeenCalled();
		expect(sourceFallback).toHaveBeenCalledTimes(1);
	});

	it('retains the canvas blit fallback when its backing texture supports copying', async () => {
		const pass = new CopyPass({ needsSwap: false, output: 'canvas' });
		const context = createPassContext();
		context.canvas = context.output;
		await preparePass(pass, context);
		pass.render(context);
		expect(context.commandEncoder.copyTextureToTexture).not.toHaveBeenCalled();
		expect(context.beginRenderPass).toHaveBeenCalledOnce();
	});

	it('disposes internal blit pass when CopyPass is disposed', () => {
		const pass = new CopyPass();
		const disposeSpy = vi.spyOn(
			(pass as unknown as { fallbackBlit: BlitPass }).fallbackBlit,
			'dispose'
		);
		pass.dispose();
		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});

	it('reuses ShaderPass pipeline cache and prepares a hot edit asynchronously', async () => {
		const pass = new ShaderPass({
			fragment: `
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	return vec4f(inputColor.rgb * vec3f(uv, 1.0), inputColor.a);
}
`
		});
		const context = createPassContext();
		const device = context.device as unknown as ReturnType<typeof createFakeDevice>;

		await preparePass(pass, context);
		pass.render(context);
		pass.render(context);
		expect(device.createRenderPipelineAsync).toHaveBeenCalledTimes(1);

		pass.setFragment(`
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	return vec4f(inputColor.rg, uv.x, inputColor.a);
}
`);
		await preparePass(pass, context);
		pass.render(context);
		expect(device.createRenderPipelineAsync).toHaveBeenCalledTimes(2);
	});

	it('rejects invalid ShaderPass fragments in setFragment without mutating active fragment', () => {
		const originalFragment = `
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	return vec4f(inputColor.rgb * vec3f(uv, 1.0), inputColor.a);
}
`;
		const pass = new ShaderPass({
			fragment: originalFragment
		});

		expect(() => pass.setFragment('fn broken() {}')).toThrow(
			/fn shade\(inputColor: vec4f, uv: vec2f\) -> vec4f/
		);
		expect(pass.getFragment()).toBe(originalFragment);
	});

	it('reuses BlitPass pipeline cache and resets it for a different device', async () => {
		const pass = new BlitPass();
		const firstContext = createPassContext();
		const secondContext = createPassContext();
		const firstDevice = firstContext.device as unknown as ReturnType<typeof createFakeDevice>;
		const secondDevice = secondContext.device as unknown as ReturnType<typeof createFakeDevice>;

		await preparePass(pass, firstContext);
		pass.render(firstContext);
		pass.render(firstContext);
		await preparePass(pass, secondContext);
		pass.render(secondContext);

		expect(firstDevice.createRenderPipelineAsync).toHaveBeenCalledTimes(1);
		expect(secondDevice.createRenderPipelineAsync).toHaveBeenCalledTimes(1);
	});

	it('resets ShaderPass GPU caches when rendering with a different device', async () => {
		const pass = new ShaderPass({
			fragment: `
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	return vec4f(inputColor.rgb, inputColor.a);
}
`
		});
		const firstContext = createPassContext();
		const secondContext = createPassContext();
		const firstDevice = firstContext.device as unknown as ReturnType<typeof createFakeDevice>;
		const secondDevice = secondContext.device as unknown as ReturnType<typeof createFakeDevice>;

		await preparePass(pass, firstContext);
		pass.render(firstContext);
		await preparePass(pass, secondContext);
		pass.render(secondContext);

		expect(firstDevice.createRenderPipelineAsync).toHaveBeenCalledTimes(1);
		expect(secondDevice.createRenderPipelineAsync).toHaveBeenCalledTimes(1);
	});

	it('forwards CopyPass setSize to fallback blit implementation', () => {
		const pass = new CopyPass();
		const setSizeSpy = vi.spyOn(
			(pass as unknown as { fallbackBlit: BlitPass }).fallbackBlit,
			'setSize'
		);

		pass.setSize(320, 240);

		expect(setSizeSpy).toHaveBeenCalledWith(320, 240);
	});

	it('supports setSize/dispose smoke flow for BlitPass and ShaderPass', async () => {
		const blit = new BlitPass();
		const shader = new ShaderPass({
			fragment: `
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	return vec4f(inputColor.rgb * vec3f(uv, 1.0), inputColor.a);
}
`
		});
		const passEncoders: Array<{
			setPipeline: ReturnType<typeof vi.fn>;
			setBindGroup: ReturnType<typeof vi.fn>;
			draw: ReturnType<typeof vi.fn>;
			end: ReturnType<typeof vi.fn>;
		}> = [];
		const context = createPassContext({
			beginRenderPass: vi.fn(() => {
				const encoder = {
					setPipeline: vi.fn(),
					setBindGroup: vi.fn(),
					draw: vi.fn(),
					end: vi.fn()
				};
				passEncoders.push(encoder);
				return encoder as unknown as GPURenderPassEncoder;
			})
		});

		expect(() => blit.setSize(1920, 1080)).not.toThrow();
		expect(() => shader.setSize(1920, 1080)).not.toThrow();

		await Promise.all([preparePass(blit, context), preparePass(shader, context)]);
		blit.render(context);
		shader.render(context);

		blit.dispose();
		shader.dispose();

		await Promise.all([preparePass(blit, context), preparePass(shader, context)]);
		expect(() => blit.render(context)).not.toThrow();
		expect(() => shader.render(context)).not.toThrow();

		expect(passEncoders).toHaveLength(4);
		for (const encoder of passEncoders) {
			expect(encoder.setPipeline).toHaveBeenCalledTimes(1);
			expect(encoder.setBindGroup).toHaveBeenCalledTimes(1);
			expect(encoder.draw).toHaveBeenCalledWith(3);
			expect(encoder.end).toHaveBeenCalledTimes(1);
		}
	});
});
