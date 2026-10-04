import { createCurrentWritable } from '../src/lib/core/current-value';
import { createFrameRegistry } from '../src/lib/core/frame-registry';
import { createSpektralRuntimeLoop } from '../src/lib/core/runtime-loop';
import { BlitPass } from '../src/lib/passes/BlitPass';
import { defineMaterial, resolveMaterial, type FragMaterial } from '../src/lib/core/material';
import { createRenderer } from '../src/lib/core/renderer';
import type {
	AnyPass,
	FrameState,
	RenderPassContext,
	RenderTargetDefinitionMap,
	TextureMap
} from '../src/lib/core/types';
import { ComputePass } from '../src/lib/passes/ComputePass';
import { PingPongComputePass } from '../src/lib/passes/PingPongComputePass';
import { PingPongShaderPass } from '../src/lib/passes/PingPongShaderPass';

async function createProofRenderer(
	material: FragMaterial,
	passes: AnyPass[],
	getRenderTargets?: () => RenderTargetDefinitionMap
) {
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
		...(getRenderTargets ? { getRenderTargets } : {}),
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
		async draw(textures: TextureMap = {}, canvasSize = { width: 2, height: 2 }) {
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
					canvasSize
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

export async function readCollidingStorageData() {
	const values = [
		[1364945411, 3212416462],
		[2409582172, 2899006390]
	];
	const materials = values.map((data) =>
		defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }',
			storageBuffers: { data: { type: 'array<u32>', size: 8, initialData: new Uint32Array(data) } }
		})
	);
	let material = materials[0]!;
	let onFrame: ((reader: FrameState['readStorageBuffer']) => void) | undefined;
	const canvas = document.createElement('canvas');
	canvas.style.width = canvas.style.height = '8px';
	document.body.append(canvas);
	const registry = createFrameRegistry({ renderMode: 'manual' });
	registry.register((state) => onFrame?.(state.readStorageBuffer), { autoInvalidate: false });
	const reports: string[] = [];
	const loop = createSpektralRuntimeLoop({
		canvas,
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
		reportError: (report) => {
			if (report) reports.push(report.code);
		}
	});
	const read = async () => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const reader = await new Promise<FrameState['readStorageBuffer']>((resolve, reject) => {
				onFrame = resolve;
				timer = setTimeout(() => reject(new Error('Storage frame was not rendered')), 5000);
				loop.advance();
			});
			return [...new Uint32Array(await reader('data'))];
		} finally {
			clearTimeout(timer);
			onFrame = undefined;
		}
	};
	try {
		const first = await read();
		material = materials[1]!;
		const replacement = await read();
		material = materials[0]!;
		return { first, replacement, restored: await read(), reports };
	} finally {
		loop.destroy();
		canvas.remove();
	}
}

export async function readRenderTargetRecovery() {
	let width = 2;
	const proof = await createProofRenderer(
		defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(0.0, 1.0, 0.0, 1.0); }'
		}),
		[
			new BlitPass({ output: 'history', needsSwap: false }),
			new BlitPass({ input: 'history', output: 'source', needsSwap: false })
		],
		() => ({ history: { width, height: 2 } })
	);
	try {
		const before = await proof.draw();
		width = proof.renderer.getDevice!().limits.maxTextureDimension2D + 1;
		let failure = '';
		try {
			await proof.draw();
		} catch (error) {
			failure = String(error);
		}
		width = 2;
		return { before, failure, recovered: [await proof.draw(), await proof.draw()] };
	} finally {
		proof.renderer.destroy();
	}
}

export async function readFeedbackResize() {
	const passes = [
		new PingPongShaderPass({
			target: 'stateA',
			clearColor: [0.25, 0, 0, 1],
			fragment: `fn frag(uv: vec2f) -> vec4f {
				return vec4f(textureLoad(spektralPrevious, vec2i(0), 0).r + 0.125, 0.0, 0.0, 1.0);
			}`
		}),
		new PingPongShaderPass({
			target: 'stateB',
			fragment: 'fn frag(uv: vec2f) -> vec4f { return textureLoad(stateA, vec2i(0), 0); }'
		})
	];
	const proof = await createProofRenderer(
		defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return textureLoad(stateB, vec2i(0), 0); }',
			textures: { stateA: { colorSpace: 'linear' }, stateB: { colorSpace: 'linear' } }
		}),
		passes
	);
	try {
		return [
			(await proof.draw())[0]!,
			(await proof.draw())[0]!,
			(await proof.draw({}, { width: 4, height: 4 }))[0]!,
			(await proof.draw({}, { width: 4, height: 4 }))[0]!
		];
	} finally {
		proof.renderer.destroy();
	}
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

export async function readSharedFeedback() {
	const pass = new PingPongShaderPass({
		target: 'sim',
		width: 2,
		height: 2,
		fragment: `fn frag(uv: vec2f) -> vec4f {
			return vec4f(textureLoad(spektralPrevious, vec2i(0), 0).r + 0.125, 0.0, 0.0, 1.0);
		}`
	});
	const material = defineMaterial({
		fragment: 'fn frag(uv: vec2f) -> vec4f { return textureLoad(sim, vec2i(0), 0); }',
		textures: { sim: { colorSpace: 'linear' } }
	});
	let first = await createProofRenderer(material, [pass]);
	let second: Awaited<ReturnType<typeof createProofRenderer>> | undefined;
	try {
		second = await createProofRenderer(material, [pass]);
		const accumulated: number[][] = [];
		for (let i = 0; i < 3; i += 1)
			accumulated.push([(await first.draw())[0]!, (await second.draw())[0]!]);
		pass.reset([0.25, 0, 0, 1]);
		const reset = [(await first.draw())[0]!, (await first.draw())[0]!, (await second.draw())[0]!];
		const lastOutput = pass.getCurrentOutput();
		pass.setIterations(2);
		const even = [(await first.draw())[0]!, (await second.draw())[0]!];
		pass.setIterations(1);
		pass.setDimensions(4, 4);
		const resized = [(await first.draw())[0]!, (await second.draw())[0]!];
		first.renderer.destroy();
		const afterDispose = (await second.draw())[0]!;
		first = await createProofRenderer(material, [pass]);
		const recreated = [(await first.draw())[0]!, (await second.draw())[0]!];
		return { accumulated, reset, lastOutput, even, resized, afterDispose, recreated };
	} finally {
		first.renderer.destroy();
		second?.renderer.destroy();
	}
}

export async function readPremultipliedTexture(premultipliedAlpha: boolean) {
	const source = document.createElement('canvas');
	source.width = source.height = 2;
	const context = source.getContext('2d');
	if (!context) throw new Error('Canvas 2D context is unavailable');
	context.fillStyle = 'rgba(255, 0, 0, 0.5)';
	context.fillRect(0, 0, 2, 2);
	const proof = await createProofRenderer(
		defineMaterial({
			fragment: `fn frag(uv: vec2f) -> vec4f {
			let value = textureLoad(photo, vec2i(0), 0);
			return vec4f(value.r, value.a, 0.0, 1.0);
		}`,
			textures: {
				photo: { source, colorSpace: 'linear', premultipliedAlpha, generateMipmaps: true }
			}
		}),
		[]
	);
	try {
		return [
			await proof.draw(),
			await proof.draw({
				photo: { source, premultipliedAlpha: !premultipliedAlpha, update: 'perFrame' }
			}),
			await proof.draw({ photo: { source, premultipliedAlpha, update: 'perFrame' } })
		];
	} finally {
		proof.renderer.destroy();
	}
}

/** Destroy an active device and await the submitted replacement frame without advancing again. */
export async function readDeviceLossRecovery(mode: 'on-demand' | 'manual') {
	let onFrame: ((device: GPUDevice) => void) | undefined;
	let frameCount = 0;
	class ProbePass extends BlitPass {
		override render(context: RenderPassContext): void {
			super.render(context);
			frameCount += 1;
			onFrame?.(context.device);
		}
	}
	const canvas = document.createElement('canvas');
	canvas.style.width = canvas.style.height = '16px';
	document.body.append(canvas);
	const registry = createFrameRegistry({ renderMode: mode });
	const material = defineMaterial({
		fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(0.0, 1.0, 0.0, 1.0); }'
	});
	const passes = [new ProbePass()];
	const reports: string[] = [];
	const loop = createSpektralRuntimeLoop({
		canvas,
		registry,
		size: createCurrentWritable({ width: 0, height: 0 }),
		dpr: createCurrentWritable(1),
		maxDelta: createCurrentWritable(0.1),
		getMaterial: () => material,
		getPasses: () => passes,
		getRenderTargets: () => ({}),
		getClearColor: () => [0, 0, 0, 1],
		getAdapterOptions: () => undefined,
		getDeviceDescriptor: () => undefined,
		getOnError: () => undefined,
		reportError: (report) => {
			if (report) reports.push(report.code);
		}
	});
	const waitForFrame = async (trigger: () => void): Promise<GPUDevice> => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await new Promise<GPUDevice>((resolve, reject) => {
				onFrame = resolve;
				timer = setTimeout(
					() => reject(new Error('Runtime did not submit a recovery frame')),
					5000
				);
				trigger();
			});
		} finally {
			clearTimeout(timer);
			onFrame = undefined;
		}
	};
	try {
		const firstDevice = await waitForFrame(loop.advance);
		await firstDevice.queue.onSubmittedWorkDone();
		const replacementDevice = await waitForFrame(() => firstDevice.destroy());
		await replacementDevice.queue.onSubmittedWorkDone();
		return { deviceChanged: replacementDevice !== firstDevice, frameCount, reports };
	} finally {
		loop.destroy();
		canvas.remove();
	}
}
