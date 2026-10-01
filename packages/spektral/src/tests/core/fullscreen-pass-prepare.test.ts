import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	prepareFullscreenPass,
	releaseFullscreenPass,
	type PreparedFullscreenPassContract
} from '../../lib/core/pass-brand';
import { isPreparedFullscreenPass } from '../../lib/core/pass-contract';
import { toSpektralErrorReport } from '../../lib/core/error-report';
import type { RenderPassContext, RenderTarget } from '../../lib/core/types';
import { BlitPass, CopyPass, PingPongShaderPass, ShaderPass } from '../../lib/passes';
import { buildShaderPassProgram } from '../../lib/passes/ShaderPass';

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createTarget(key: string, format: GPUTextureFormat = 'rgba8unorm'): RenderTarget {
	return {
		texture: {
			key,
			usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
		} as unknown as GPUTexture,
		view: { key: `${key}-view` } as unknown as GPUTextureView,
		width: 32,
		height: 32,
		format
	};
}

function createDeferredDevice() {
	const pipelineRequests: Array<Deferred<GPURenderPipeline>> = [];
	const compilationInfos: Array<Deferred<GPUCompilationInfo>> = [];
	const shaderCodes: string[] = [];
	const device = {
		features: new Set() as unknown as GPUSupportedFeatures,
		createSampler: vi.fn(() => ({ type: 'sampler' }) as unknown as GPUSampler),
		createBindGroupLayout: vi.fn(
			() => ({ type: 'bind-group-layout' }) as unknown as GPUBindGroupLayout
		),
		createShaderModule: vi.fn((descriptor: GPUShaderModuleDescriptor) => {
			shaderCodes.push(descriptor.code);
			const info = deferred<GPUCompilationInfo>();
			compilationInfos.push(info);
			return {
				getCompilationInfo: vi.fn(() => info.promise)
			} as unknown as GPUShaderModule;
		}),
		createPipelineLayout: vi.fn(
			() => ({ type: 'pipeline-layout' }) as unknown as GPUPipelineLayout
		),
		createRenderPipeline: vi.fn(() => {
			throw new Error('synchronous pipeline creation is forbidden');
		}),
		createRenderPipelineAsync: vi.fn(() => {
			const request = deferred<GPURenderPipeline>();
			pipelineRequests.push(request);
			return request.promise;
		}),
		pushErrorScope: vi.fn(),
		popErrorScope: vi.fn(async (): Promise<GPUError | null> => null),
		createBindGroup: vi.fn(() => ({ type: 'bind-group' }) as unknown as GPUBindGroup)
	};
	return {
		device: device as unknown as GPUDevice,
		mock: device,
		pipelineRequests,
		compilationInfos,
		shaderCodes
	};
}

function createContext(device: GPUDevice, clear = false) {
	const source = createTarget('source');
	const target = createTarget('target');
	const canvas = createTarget('canvas');
	const encoder = {
		setPipeline: vi.fn(),
		setBindGroup: vi.fn(),
		draw: vi.fn(),
		end: vi.fn()
	};
	const commandEncoder = { copyTextureToTexture: vi.fn() };
	const context: RenderPassContext = {
		clear,
		clearColor: [0, 0, 0, 1],
		preserve: true,
		device,
		commandEncoder: commandEncoder as unknown as GPUCommandEncoder,
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
		beginRenderPass: () => encoder as unknown as GPURenderPassEncoder
	};
	return { context, encoder, commandEncoder };
}

function prepare(
	pass: PreparedFullscreenPassContract,
	context: RenderPassContext,
	owner: object
): Promise<void> {
	return pass[prepareFullscreenPass]({
		device: context.device,
		owner,
		inputFormat: context.input.format,
		outputFormat: context.output.format
	});
}

function fragment(id: number): string {
	return `
fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {
	return vec4f(inputColor.rgb + vec3f(${id}.0) * 0.001, inputColor.a + uv.x * 0.0);
}
`;
}

function permutations(values: number[]): number[][] {
	if (values.length <= 1) return [values];
	return values.flatMap((value, index) =>
		permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((tail) => [
			value,
			...tail
		])
	);
}

interface EditPermutationCase {
	name: string;
	editCount: number;
	completionOrder: number[];
	succeeds: boolean[];
}

function editPermutationCases(): EditPermutationCase[] {
	const cases: EditPermutationCase[] = [];
	for (const editCount of [2, 3]) {
		for (const completionOrder of permutations(
			Array.from({ length: editCount }, (_, index) => index)
		)) {
			for (let mask = 0; mask < 2 ** editCount; mask += 1) {
				const succeeds = Array.from(
					{ length: editCount },
					(_, index) => (mask & (1 << index)) !== 0
				);
				cases.push({
					name: `${editCount} edits; order ${completionOrder.join('-')}; ${succeeds
						.map((success) => (success ? 'resolve' : 'reject'))
						.join('-')}`,
					editCount,
					completionOrder,
					succeeds
				});
			}
		}
	}
	return cases;
}

async function settleCompilationInfo(
	infos: Array<Deferred<GPUCompilationInfo>>,
	index: number
): Promise<void> {
	infos[index]?.resolve({ messages: [] } as unknown as GPUCompilationInfo);
	await Promise.resolve();
}

function compilationInfo(messages: Partial<GPUCompilationMessage>[]): GPUCompilationInfo {
	return {
		messages: messages.map(
			(message) =>
				({
					type: 'error',
					message: 'shader failed',
					lineNum: 1,
					linePos: 1,
					offset: 0,
					length: 1,
					...message
				}) as GPUCompilationMessage
		)
	} as unknown as GPUCompilationInfo;
}

describe('internal fullscreen pass preparation', () => {
	beforeEach(() => {
		vi.stubGlobal('GPUShaderStage', { FRAGMENT: 0x10 });
		vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2 });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('builds a complete ShaderPass program with explicit user and wrapper line origins', () => {
		const source = fragment(7);
		const built = buildShaderPassProgram(source);
		const lines = built.code.split('\n');
		const userLine = lines.findIndex((line) => line.includes('return vec4f(inputColor.rgb')) + 1;
		const wrapperLine = lines.findIndex((line) => line.includes('struct SpektralVertexOut')) + 1;
		expect(built.lineMap[userLine]).toEqual({ kind: 'fragment', line: 3 });
		expect(built.lineMap[wrapperLine]).toEqual({ kind: 'wrapper', line: wrapperLine });
		expect(built.fragmentSource).toBe(source);
	});

	it('never creates shader modules or pipelines from the render path', async () => {
		const pass = new BlitPass();
		const runtime = createDeferredDevice();
		const { context } = createContext(runtime.device);
		const preparation = prepare(pass, context, {});
		await settleCompilationInfo(runtime.compilationInfos, 0);
		const pipeline = { id: 'prepared' } as unknown as GPURenderPipeline;
		runtime.pipelineRequests[0]?.resolve(pipeline);
		await preparation;
		const moduleCount = runtime.mock.createShaderModule.mock.calls.length;
		const pipelineCount = runtime.mock.createRenderPipelineAsync.mock.calls.length;

		pass.render(context);
		pass.render(context);

		expect(runtime.mock.createShaderModule).toHaveBeenCalledTimes(moduleCount);
		expect(runtime.mock.createRenderPipelineAsync).toHaveBeenCalledTimes(pipelineCount);
		expect(runtime.mock.createRenderPipeline).not.toHaveBeenCalled();
	});

	it('maps ShaderPass compilation diagnostics to user fragment line and column', async () => {
		const userFragment = [
			'fn shade(inputColor: vec4f, uv: vec2f) -> vec4f {',
			'\tlet retained = inputColor.r + uv.x;',
			'\treturn vec4f(missingSymbol, retained, 0.0, 1.0);',
			'}'
		].join('\n');
		const pass = new ShaderPass({ fragment: userFragment, label: 'Bloom composite' });
		const runtime = createDeferredDevice();
		const { context } = createContext(runtime.device);
		const preparation = prepare(pass, context, {});
		const generatedLine =
			runtime.shaderCodes[0]?.split('\n').findIndex((line) => line.includes('missingSymbol')) ?? -1;
		runtime.compilationInfos[0]?.resolve(
			compilationInfo([
				{
					message: 'unresolved identifier missingSymbol',
					lineNum: generatedLine + 1,
					linePos: 15,
					length: 13
				}
			])
		);
		runtime.pipelineRequests[0]?.resolve({ id: 'invalid' } as unknown as GPURenderPipeline);

		const error = await preparation.catch((reason: unknown) => reason);
		const report = toSpektralErrorReport(error, 'initialization');
		expect(report.shader).toEqual({
			passKind: 'ShaderPass',
			passLabel: 'Bloom composite',
			stage: 'fragment',
			inputFormat: 'rgba8unorm',
			outputFormat: 'rgba8unorm',
			sourceKind: 'user',
			line: 3,
			column: 15
		});
		expect(report.source).toMatchObject({ line: 3, column: 15 });
		expect(report.source?.snippet).toHaveLength(4);
		expect(report.source?.snippet.length).toBeLessThanOrEqual(7);
	});

	it('classifies wrapper compilation diagnostics without exposing generated WGSL', async () => {
		const pass = new ShaderPass({ fragment: fragment(0), label: 'Tone pass' });
		const runtime = createDeferredDevice();
		const { context } = createContext(runtime.device);
		const preparation = prepare(pass, context, {});
		const generatedLine =
			runtime.shaderCodes[0]?.split('\n').findIndex((line) => line.includes('SpektralVertexOut')) ??
			-1;
		runtime.compilationInfos[0]?.resolve(
			compilationInfo([
				{
					message: 'wrapper output is invalid',
					lineNum: generatedLine + 1,
					linePos: 8
				}
			])
		);
		runtime.pipelineRequests[0]?.resolve({ id: 'invalid' } as unknown as GPURenderPipeline);

		const error = await preparation.catch((reason: unknown) => reason);
		const report = toSpektralErrorReport(error, 'initialization');
		expect(report.shader).toMatchObject({
			passKind: 'ShaderPass',
			passLabel: 'Tone pass',
			stage: 'fragment',
			sourceKind: 'wrapper',
			line: generatedLine + 1,
			column: 8
		});
		expect(report.source).toBeNull();
		expect(report.rawMessage).not.toContain(runtime.shaderCodes[0]);
		expect(report.details.join('\n')).not.toContain('struct SpektralVertexOut');
	});

	it('structures async pipeline rejection as wrapper diagnostics', async () => {
		const pass = new BlitPass({ label: 'Output copy' });
		const runtime = createDeferredDevice();
		const { context } = createContext(runtime.device);
		const preparation = prepare(pass, context, {});
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.reject(new Error('pipeline failed at line 2:6'));
		const error = await preparation.catch((reason: unknown) => reason);
		const report = toSpektralErrorReport(error, 'initialization');
		expect(report.code).toBe('WGSL_COMPILATION_FAILED');
		expect(report.shader).toMatchObject({
			passKind: 'BlitPass',
			passLabel: 'Output copy',
			sourceKind: 'wrapper'
		});
		expect(report.source).toBeNull();
	});

	it('structures validation error scope failures as wrapper diagnostics', async () => {
		const pass = new BlitPass({ label: 'Output copy' });
		const runtime = createDeferredDevice();
		runtime.mock.popErrorScope.mockResolvedValueOnce(
			new Error('validation failed at line 3:4') as unknown as GPUError
		);
		const { context } = createContext(runtime.device);
		const preparation = prepare(pass, context, {});
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.resolve({ id: 'invalid' } as unknown as GPURenderPipeline);
		const error = await preparation.catch((reason: unknown) => reason);
		const report = toSpektralErrorReport(error, 'initialization');
		expect(report.code).toBe('WGSL_COMPILATION_FAILED');
		expect(report.shader).toMatchObject({
			passKind: 'BlitPass',
			passLabel: 'Output copy',
			sourceKind: 'wrapper',
			line: 3,
			column: 4
		});
		expect(report.source).toBeNull();
	});

	it('captures the complete fullscreen pipeline build in one validation scope', async () => {
		const pass = new ShaderPass({ fragment: fragment(0) });
		const runtime = createDeferredDevice();
		const { context } = createContext(runtime.device);
		const events: string[] = [];
		const originalCreateSampler = runtime.mock.createSampler.getMockImplementation();
		const originalCreateBindGroupLayout =
			runtime.mock.createBindGroupLayout.getMockImplementation();
		const originalCreateShaderModule = runtime.mock.createShaderModule.getMockImplementation();
		const originalCreatePipelineLayout = runtime.mock.createPipelineLayout.getMockImplementation();
		const originalCreateRenderPipelineAsync =
			runtime.mock.createRenderPipelineAsync.getMockImplementation();
		if (
			!originalCreateSampler ||
			!originalCreateBindGroupLayout ||
			!originalCreateShaderModule ||
			!originalCreatePipelineLayout ||
			!originalCreateRenderPipelineAsync
		) {
			throw new Error('Expected WebGPU mock implementations');
		}

		runtime.mock.pushErrorScope.mockImplementation(() => {
			events.push('push');
		});
		runtime.mock.createSampler.mockImplementation(() => {
			events.push('sampler');
			return originalCreateSampler();
		});
		runtime.mock.createBindGroupLayout.mockImplementation(() => {
			events.push('bind-group-layout');
			return originalCreateBindGroupLayout();
		});
		runtime.mock.createShaderModule.mockImplementation((descriptor) => {
			events.push('shader-module');
			return originalCreateShaderModule(descriptor);
		});
		runtime.mock.createPipelineLayout.mockImplementation(() => {
			events.push('pipeline-layout');
			return originalCreatePipelineLayout();
		});
		runtime.mock.createRenderPipelineAsync.mockImplementation(() => {
			events.push('pipeline');
			return originalCreateRenderPipelineAsync();
		});
		runtime.mock.popErrorScope.mockImplementation(async () => {
			events.push('pop');
			return null;
		});

		const preparation = prepare(pass, context, {});
		expect(events).toEqual([
			'push',
			'sampler',
			'bind-group-layout',
			'shader-module',
			'pipeline-layout',
			'pipeline',
			'pop'
		]);
		expect(runtime.mock.popErrorScope).toHaveBeenCalledTimes(1);
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.resolve({ id: 'pipeline' } as unknown as GPURenderPipeline);
		await expect(preparation).resolves.toBeUndefined();
	});

	it('structures synchronous shader-module failures without leaking wrapper source', async () => {
		const pass = new BlitPass({ label: 'Module failure' });
		const runtime = createDeferredDevice();
		runtime.mock.createShaderModule.mockImplementationOnce(() => {
			throw new Error('shader module creation failed');
		});
		const { context } = createContext(runtime.device);
		const error = await prepare(pass, context, {}).catch((reason: unknown) => reason);
		const report = toSpektralErrorReport(error, 'initialization');
		expect(report.code).toBe('WGSL_COMPILATION_FAILED');
		expect(report.shader).toMatchObject({
			passKind: 'BlitPass',
			passLabel: 'Module failure',
			sourceKind: 'wrapper'
		});
		expect(report.source).toBeNull();
		expect(report.rawMessage).not.toContain('SpektralVertexOut');
		expect(runtime.mock.pushErrorScope).toHaveBeenCalledTimes(1);
		expect(runtime.mock.popErrorScope).toHaveBeenCalledTimes(1);
	});

	it.each(editPermutationCases())('$name', async ({ editCount, completionOrder, succeeds }) => {
		const pass = new ShaderPass({ fragment: fragment(0) });
		const runtime = createDeferredDevice();
		const { context, encoder } = createContext(runtime.device);
		const owner = {};
		const firstPreparation = prepare(pass, context, owner);
		await settleCompilationInfo(runtime.compilationInfos, 0);
		const initialPipeline = { id: 'initial' } as unknown as GPURenderPipeline;
		runtime.pipelineRequests[0]?.resolve(initialPipeline);
		await firstPreparation;

		for (let index = 0; index < editCount; index += 1) pass.setFragment(fragment(index + 1));
		expect(runtime.pipelineRequests).toHaveLength(editCount + 1);
		for (let index = 1; index <= editCount; index += 1) {
			await settleCompilationInfo(runtime.compilationInfos, index);
		}
		const editPipelines = Array.from(
			{ length: editCount },
			(_, index) => ({ id: `edit-${index + 1}` }) as unknown as GPURenderPipeline
		);
		for (const editIndex of completionOrder) {
			const request = runtime.pipelineRequests[editIndex + 1];
			if (succeeds[editIndex]) request?.resolve(editPipelines[editIndex]!);
			else request?.reject(new Error(`edit ${editIndex + 1} failed`));
			await Promise.resolve();
		}
		await Promise.resolve();

		const expected = succeeds[editCount - 1] ? editPipelines[editCount - 1] : initialPipeline;
		if (succeeds[editCount - 1]) {
			await vi.waitFor(() => {
				pass.render(context);
				expect(encoder.setPipeline).toHaveBeenLastCalledWith(expected);
			});
		} else {
			pass.render(context);
			expect(encoder.setPipeline).toHaveBeenLastCalledWith(expected);
		}
	});

	it('reports a current hot-edit failure while rendering last-known-good', async () => {
		const pass = new ShaderPass({ fragment: fragment(0), label: 'Editable pass' });
		const runtime = createDeferredDevice();
		const { context, encoder } = createContext(runtime.device);
		const reportRecoverableError = vi.fn();
		const requestRender = vi.fn();
		const owner = {};
		const initial = pass[prepareFullscreenPass]({
			device: runtime.device,
			owner,
			inputFormat: context.input.format,
			outputFormat: context.output.format,
			reportRecoverableError,
			requestRender
		});
		await settleCompilationInfo(runtime.compilationInfos, 0);
		const initialPipeline = { id: 'initial' } as unknown as GPURenderPipeline;
		runtime.pipelineRequests[0]?.resolve(initialPipeline);
		await initial;

		pass.setFragment(fragment(1));
		runtime.compilationInfos[1]?.resolve(
			compilationInfo([{ message: 'hot fragment failed', lineNum: 1, linePos: 3 }])
		);
		runtime.pipelineRequests[1]?.resolve({ id: 'invalid-hot' } as unknown as GPURenderPipeline);
		await vi.waitFor(() => expect(reportRecoverableError).toHaveBeenCalledTimes(1));
		const report = toSpektralErrorReport(reportRecoverableError.mock.calls[0]?.[0], 'render');
		expect(report.recoverable).toBe(true);
		expect(report.shader).toMatchObject({ passKind: 'ShaderPass', passLabel: 'Editable pass' });
		expect(requestRender).not.toHaveBeenCalled();

		pass.render(context);
		expect(encoder.setPipeline).toHaveBeenLastCalledWith(initialPipeline);
	});

	it('suppresses stale failures and requests a render only for latest successful recovery', async () => {
		const pass = new ShaderPass({ fragment: fragment(0) });
		const runtime = createDeferredDevice();
		const { context, encoder } = createContext(runtime.device);
		const reportRecoverableError = vi.fn();
		const requestRender = vi.fn();
		const initial = pass[prepareFullscreenPass]({
			device: runtime.device,
			owner: {},
			inputFormat: context.input.format,
			outputFormat: context.output.format,
			reportRecoverableError,
			requestRender
		});
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.resolve({ id: 'initial' } as unknown as GPURenderPipeline);
		await initial;

		pass.setFragment(fragment(1));
		pass.setFragment(fragment(2));
		await settleCompilationInfo(runtime.compilationInfos, 1);
		await settleCompilationInfo(runtime.compilationInfos, 2);
		runtime.pipelineRequests[1]?.reject(new Error('stale failure'));
		await Promise.resolve();
		expect(reportRecoverableError).not.toHaveBeenCalled();
		const latestPipeline = { id: 'latest' } as unknown as GPURenderPipeline;
		runtime.pipelineRequests[2]?.resolve(latestPipeline);
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalledTimes(1));
		expect(reportRecoverableError).not.toHaveBeenCalled();
		pass.render(context);
		expect(encoder.setPipeline).toHaveBeenLastCalledWith(latestPipeline);
	});

	it('keeps per-device program resources bounded across repeated hot-edit success and failure', async () => {
		const pass = new ShaderPass({ fragment: fragment(0) });
		const runtime = createDeferredDevice();
		const { context } = createContext(runtime.device);
		const initial = prepare(pass, context, {});
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.resolve({ id: 'initial' } as unknown as GPURenderPipeline);
		await initial;

		for (let version = 1; version <= 12; version += 1) {
			pass.setFragment(fragment(version));
			await settleCompilationInfo(runtime.compilationInfos, version);
			if (version % 3 === 0) {
				runtime.pipelineRequests[version]?.reject(new Error(`rejected ${version}`));
			} else {
				runtime.pipelineRequests[version]?.resolve({
					id: `pipeline-${version}`
				} as unknown as GPURenderPipeline);
			}
			await Promise.resolve();
			await Promise.resolve();
		}

		const states = (
			pass as unknown as {
				deviceStates: Map<GPUDevice, { programResources: Map<number, unknown> }>;
			}
		).deviceStates;
		await vi.waitFor(() => {
			expect(states.get(runtime.device)?.programResources.size).toBeLessThanOrEqual(1);
		});
	});

	it('keeps a pipeline prepared by a new owner when the old renderer releases', async () => {
		const pass = new ShaderPass({ fragment: fragment(0) });
		const runtime = createDeferredDevice();
		const { context, encoder } = createContext(runtime.device);
		const oldOwner = {};
		const newOwner = {};
		const initial = prepare(pass, context, oldOwner);
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.resolve({ id: 'initial' } as unknown as GPURenderPipeline);
		await initial;

		pass.setFragment(fragment(1));
		const nextPreparation = prepare(pass, context, newOwner);
		pass[releaseFullscreenPass](runtime.device, oldOwner);
		await settleCompilationInfo(runtime.compilationInfos, 1);
		const nextPipeline = { id: 'next' } as unknown as GPURenderPipeline;
		runtime.pipelineRequests[1]?.resolve(nextPipeline);
		await nextPreparation;

		pass.render(context);
		expect(encoder.setPipeline).toHaveBeenLastCalledWith(nextPipeline);
	});

	it('ignores a late pipeline result after dispose and permits a clean retry', async () => {
		const pass = new BlitPass();
		const runtime = createDeferredDevice();
		const { context, encoder } = createContext(runtime.device);
		const pending = prepare(pass, context, {});
		pass.dispose();
		await settleCompilationInfo(runtime.compilationInfos, 0);
		const latePipeline = { id: 'late' } as unknown as GPURenderPipeline;
		runtime.pipelineRequests[0]?.resolve(latePipeline);
		await pending;
		expect(() => pass.render(context)).toThrow(/not prepared/);

		const retry = prepare(pass, context, {});
		await settleCompilationInfo(runtime.compilationInfos, 1);
		const retryPipeline = { id: 'retry' } as unknown as GPURenderPipeline;
		runtime.pipelineRequests[1]?.resolve(retryPipeline);
		await retry;
		pass.render(context);
		expect(encoder.setPipeline).toHaveBeenLastCalledWith(retryPipeline);
	});

	it.each(['release', 'dispose'] as const)(
		'swallows a late rejection after owner %s',
		async (teardown) => {
			const pass = new BlitPass();
			const runtime = createDeferredDevice();
			const { context } = createContext(runtime.device);
			const owner = {};
			const pending = prepare(pass, context, owner);
			if (teardown === 'release') pass[releaseFullscreenPass](runtime.device, owner);
			else pass.dispose();
			await settleCompilationInfo(runtime.compilationInfos, 0);
			runtime.pipelineRequests[0]?.reject(new Error('late stale failure'));

			await expect(pending).resolves.toBeUndefined();
			expect(() => pass.render(context)).toThrow(/not prepared/);
		}
	);

	it('settles a shared rejection per owner when only one pending owner is released', async () => {
		const pass = new BlitPass();
		const runtime = createDeferredDevice();
		const { context } = createContext(runtime.device);
		const releasedOwner = {};
		const activeOwner = {};
		const releasedPromise = prepare(pass, context, releasedOwner);
		const activePromise = prepare(pass, context, activeOwner);
		expect(runtime.pipelineRequests).toHaveLength(1);
		pass[releaseFullscreenPass](runtime.device, releasedOwner);
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.reject(new Error('shared active failure'));

		await expect(releasedPromise).resolves.toBeUndefined();
		await expect(activePromise).rejects.toThrow('shared active failure');
	});

	it('recovers an on-demand dynamic first failure after the next shader edit', async () => {
		const pass = new ShaderPass({ fragment: fragment(0) });
		const runtime = createDeferredDevice();
		const { context, encoder } = createContext(runtime.device);
		const requestRender = vi.fn();
		const owner = {};
		const first = pass[prepareFullscreenPass]({
			device: runtime.device,
			owner,
			inputFormat: context.input.format,
			outputFormat: context.output.format,
			retainOwnerOnFailure: true,
			requestRender
		});
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.reject(new Error('dynamic first failure'));
		await expect(first).rejects.toThrow('dynamic first failure');

		pass.setFragment(fragment(1));
		await settleCompilationInfo(runtime.compilationInfos, 1);
		const recovered = { id: 'dynamic-recovered' } as unknown as GPURenderPipeline;
		runtime.pipelineRequests[1]?.resolve(recovered);

		await vi.waitFor(() => expect(requestRender).toHaveBeenCalledTimes(1));
		pass.render(context);
		expect(encoder.setPipeline).toHaveBeenLastCalledWith(recovered);
	});

	it('reports each current recovery failure without LKG before a later success', async () => {
		const pass = new ShaderPass({ fragment: fragment(0) });
		const runtime = createDeferredDevice();
		const { context } = createContext(runtime.device);
		const reportRecoverableError = vi.fn();
		const requestRender = vi.fn();
		const first = pass[prepareFullscreenPass]({
			device: runtime.device,
			owner: {},
			inputFormat: context.input.format,
			outputFormat: context.output.format,
			retainOwnerOnFailure: true,
			reportRecoverableError,
			requestRender
		});
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.reject(new Error('first invalid edit'));
		await expect(first).rejects.toThrow('first invalid edit');
		expect(reportRecoverableError).not.toHaveBeenCalled();

		pass.setFragment(fragment(1));
		await settleCompilationInfo(runtime.compilationInfos, 1);
		runtime.pipelineRequests[1]?.reject(new Error('second invalid edit'));
		await vi.waitFor(() => expect(reportRecoverableError).toHaveBeenCalledTimes(1));
		expect(reportRecoverableError.mock.calls[0]?.[0]).toMatchObject({
			message: expect.stringContaining('second invalid edit')
		});

		pass.setFragment(fragment(2));
		await settleCompilationInfo(runtime.compilationInfos, 2);
		runtime.pipelineRequests[2]?.resolve({ id: 'finally-valid' } as unknown as GPURenderPipeline);
		await vi.waitFor(() => expect(requestRender).toHaveBeenCalledTimes(1));
	});

	it('moves the same owner to a replacement device without retaining old device state', async () => {
		const pass = new BlitPass();
		const first = createDeferredDevice();
		const second = createDeferredDevice();
		const firstContext = createContext(first.device).context;
		const secondRuntime = createContext(second.device);
		const owner = {};
		const firstPreparation = prepare(pass, firstContext, owner);
		await settleCompilationInfo(first.compilationInfos, 0);
		first.pipelineRequests[0]?.resolve({ id: 'first' } as unknown as GPURenderPipeline);
		await firstPreparation;

		const secondPreparation = prepare(pass, secondRuntime.context, owner);
		await settleCompilationInfo(second.compilationInfos, 0);
		const secondPipeline = { id: 'second' } as unknown as GPURenderPipeline;
		second.pipelineRequests[0]?.resolve(secondPipeline);
		await secondPreparation;

		expect(() => pass.render(firstContext)).toThrow(/not prepared/);
		pass.render(secondRuntime.context);
		expect(secondRuntime.encoder.setPipeline).toHaveBeenLastCalledWith(secondPipeline);
	});

	it('CopyPass prepares and releases its fallback without affecting direct copies', async () => {
		const pass = new CopyPass();
		const runtime = createDeferredDevice();
		const direct = createContext(runtime.device);
		const fallback = createContext(runtime.device, true);
		const owner = {};
		const preparation = prepare(pass, fallback.context, owner);
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.resolve({ id: 'copy-fallback' } as unknown as GPURenderPipeline);
		await preparation;

		pass.render(direct.context);
		expect(direct.commandEncoder.copyTextureToTexture).toHaveBeenCalledTimes(1);
		pass.render(fallback.context);
		expect(fallback.encoder.draw).toHaveBeenCalledWith(3);

		pass[releaseFullscreenPass](runtime.device, owner);
		expect(() => pass.render(fallback.context)).toThrow(/not prepared/);
		pass.render(direct.context);
		expect(direct.commandEncoder.copyTextureToTexture).toHaveBeenCalledTimes(2);
	});

	it('cleans a failed first preparation so the next renderer owner can retry', async () => {
		const pass = new BlitPass();
		const runtime = createDeferredDevice();
		const { context, encoder } = createContext(runtime.device);
		const reportRecoverableError = vi.fn();
		const first = pass[prepareFullscreenPass]({
			device: runtime.device,
			owner: {},
			inputFormat: context.input.format,
			outputFormat: context.output.format,
			reportRecoverableError
		});
		await settleCompilationInfo(runtime.compilationInfos, 0);
		runtime.pipelineRequests[0]?.reject(new Error('first prepare failed'));
		await expect(first).rejects.toThrow('first prepare failed');
		expect(reportRecoverableError).not.toHaveBeenCalled();
		expect(() => pass.render(context)).toThrow(/not prepared/);

		const retry = prepare(pass, context, {});
		await settleCompilationInfo(runtime.compilationInfos, 1);
		const recovered = { id: 'recovered' } as unknown as GPURenderPipeline;
		runtime.pipelineRequests[1]?.resolve(recovered);
		await retry;
		pass.render(context);
		expect(encoder.setPipeline).toHaveBeenLastCalledWith(recovered);
	});

	it('keeps public custom RenderPass synchronous and excludes PingPongShaderPass', () => {
		const custom = { render: vi.fn() };
		const feedback = new PingPongShaderPass({
			target: 'history',
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
		});
		expect(isPreparedFullscreenPass(custom)).toBe(false);
		expect(isPreparedFullscreenPass(feedback)).toBe(false);
		expect(prepareFullscreenPass in custom).toBe(false);
	});
});
