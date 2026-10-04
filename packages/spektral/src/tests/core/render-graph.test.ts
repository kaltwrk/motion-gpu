import { describe, expect, it } from 'vitest';
import {
	hasSameRenderGraphPhysicalAccessSignature,
	planRenderGraph
} from '../../lib/core/render-graph';
import type {
	ResolvedComputePassResources,
	ResolvedTextureSubresourceRange
} from '../../lib/core/compute-resources';
import { toSpektralErrorReport } from '../../lib/core/error-report';
import type { AnyPass, RenderPass } from '../../lib/core/types';
import { ComputePass } from '../../lib/passes/ComputePass';
import { PingPongComputePass } from '../../lib/passes/PingPongComputePass';
import { PingPongShaderPass } from '../../lib/passes/PingPongShaderPass';
import { createManagedComputePass, createManagedFeedbackPass } from '../helpers/managed-pass';

function createPass(input?: Partial<RenderPass>): RenderPass {
	return {
		render: () => {},
		...input
	};
}

function mipRange(baseMipLevel: number): ResolvedTextureSubresourceRange {
	return { baseMipLevel, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1 };
}

/**
 * Builds resolved compute resources with explicit logical and physical identities.
 */
function computeResources(input: {
	reads?: Array<{
		logicalId: string;
		physicalId?: object | string | symbol;
		version?: 'current' | 'initial';
		alias?: string;
		subresource?: ResolvedTextureSubresourceRange;
	}>;
	writes?: Array<{
		logicalId: string;
		physicalId?: object | string | symbol;
		alias?: string;
		subresource?: ResolvedTextureSubresourceRange;
	}>;
}): ResolvedComputePassResources {
	return {
		entries: [],
		reads: (input.reads ?? []).map((read) => ({
			alias: read.alias ?? `${read.logicalId}In`,
			resourceKind: 'texture' as const,
			logicalId: read.logicalId,
			physicalId: read.physicalId ?? read.logicalId,
			mode: 'read' as const,
			version: read.version ?? 'current',
			...(read.subresource ? { subresource: read.subresource } : {})
		})),
		writes: (input.writes ?? []).map((write) => ({
			alias: write.alias ?? `${write.logicalId}Out`,
			resourceKind: 'texture' as const,
			logicalId: write.logicalId,
			physicalId: write.physicalId ?? write.logicalId,
			mode: 'write' as const,
			version: 'current' as const,
			...(write.subresource ? { subresource: write.subresource } : {})
		})),
		topologyKey: JSON.stringify(input),
		bindingCount: 0
	};
}

function computeGraphOptions(entries: Array<[AnyPass, ResolvedComputePassResources]>) {
	const resources = new Map(entries);
	const labels = new Map(entries.map(([pass], index) => [pass, `Compute pass #${index}`]));
	return {
		getResolvedResources: (pass: AnyPass) => resources.get(pass),
		getPassLabel: (pass: AnyPass) => labels.get(pass) ?? 'Compute pass'
	};
}

describe('render graph planner', () => {
	it('returns canvas output when no passes are enabled', () => {
		const plan = planRenderGraph([], [0, 0, 0, 1]);
		expect(plan.steps).toEqual([]);
		expect(plan.preSceneSteps).toEqual([]);
		expect(plan.computeSteps).toEqual([]);
		expect(plan.renderSteps).toEqual([]);
		expect(plan.finalOutput).toBe('canvas');
	});

	it('applies default source->target swap flow', () => {
		const plan = planRenderGraph([createPass()], [0.1, 0.2, 0.3, 1]);
		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0]).toMatchObject({
			input: 'source',
			output: 'target',
			needsSwap: true,
			clear: false,
			preserve: true,
			clearColor: [0.1, 0.2, 0.3, 1]
		});
		expect(plan.preSceneSteps).toEqual([]);
		expect(plan.computeSteps).toEqual([]);
		expect(plan.renderSteps).toEqual([plan.steps[0]]);
		expect(plan.finalOutput).toBe('source');
	});

	it('skips disabled passes', () => {
		const plan = planRenderGraph(
			[createPass({ enabled: false }), createPass({ needsSwap: false, output: 'canvas' })],
			[0, 0, 0, 1]
		);

		expect(plan.steps).toHaveLength(1);
		expect(plan.finalOutput).toBe('canvas');
	});

	it('supports target->canvas flow without swap', () => {
		const plan = planRenderGraph(
			[
				createPass({ needsSwap: false, output: 'target' }),
				createPass({ needsSwap: false, input: 'target', output: 'canvas' })
			],
			[0, 0, 0, 1]
		);

		expect(plan.steps).toHaveLength(2);
		expect(plan.steps[1]).toMatchObject({
			input: 'target',
			output: 'canvas',
			needsSwap: false
		});
		expect(plan.finalOutput).toBe('canvas');
	});

	it('supports named target flow and tracks named final output', () => {
		const plan = planRenderGraph(
			[createPass({ needsSwap: false, output: 'fxMain' })],
			[0, 0, 0, 1],
			['fxMain']
		);

		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0]).toMatchObject({
			input: 'source',
			output: 'fxMain',
			needsSwap: false
		});
		expect(plan.finalOutput).toBe('fxMain');
	});

	it('supports reading from named target after write', () => {
		const plan = planRenderGraph(
			[
				createPass({ needsSwap: false, output: 'fxMain' }),
				createPass({ needsSwap: false, input: 'fxMain', output: 'canvas' })
			],
			[0, 0, 0, 1],
			['fxMain']
		);

		expect(plan.steps).toHaveLength(2);
		expect(plan.steps[1]).toMatchObject({
			input: 'fxMain',
			output: 'canvas'
		});
		expect(plan.finalOutput).toBe('canvas');
	});

	it('clones clear color values to avoid shared mutable references', () => {
		const clearColor: [number, number, number, number] = [0.2, 0.3, 0.4, 1];
		const plan = planRenderGraph([createPass({ clear: true, clearColor })], [0, 0, 0, 1]);

		clearColor[0] = 0.99;
		expect(plan.steps[0]?.clearColor).toEqual([0.2, 0.3, 0.4, 1]);
	});

	it('counts pass index using enabled passes when reporting validation errors', () => {
		expect(() =>
			planRenderGraph(
				[
					createPass({ enabled: false, needsSwap: true, output: 'canvas' }),
					createPass({ needsSwap: false, output: 'target' }),
					createPass({ needsSwap: true, output: 'canvas' })
				],
				[0, 0, 0, 1]
			)
		).toThrow(/Render pass #1 uses needsSwap=true/);
	});

	it('rejects invalid needsSwap configuration', () => {
		expect(() =>
			planRenderGraph([createPass({ needsSwap: true, output: 'canvas' })], [0, 0, 0, 1])
		).toThrow(/source->target flow/);
	});

	it('rejects reading target before it is written', () => {
		expect(() =>
			planRenderGraph(
				[createPass({ needsSwap: false, input: 'target', output: 'canvas' })],
				[0, 0, 0, 1]
			)
		).toThrow(/before it is written/);
	});

	it('rejects writing unknown named targets', () => {
		expect(() =>
			planRenderGraph([createPass({ needsSwap: false, output: 'fxMain' })], [0, 0, 0, 1])
		).toThrow(/writes unknown target "fxMain"/);
	});

	it('rejects reading unknown named targets', () => {
		expect(() =>
			planRenderGraph(
				[createPass({ needsSwap: false, input: 'fxMain', output: 'canvas' })],
				[0, 0, 0, 1]
			)
		).toThrow(/reads unknown target "fxMain"/);
	});

	it('rejects reading named target before it is written', () => {
		expect(() =>
			planRenderGraph(
				[createPass({ needsSwap: false, input: 'fxMain', output: 'canvas' })],
				[0, 0, 0, 1],
				['fxMain']
			)
		).toThrow(/before it is written/);
	});

	// --- Compute pass tests ---

	it('rejects structural compute and feedback markers at the JavaScript boundary', () => {
		expect(() =>
			planRenderGraph([{ isCompute: true } as unknown as AnyPass], [0, 0, 0, 1])
		).toThrow(/Use ComputePass or PingPongComputePass/);
		expect(() =>
			planRenderGraph([{ isPingPongShader: true } as unknown as AnyPass], [0, 0, 0, 1])
		).toThrow(/Use PingPongShaderPass/);
	});

	it('plans every built-in managed pass through the nominal contract', () => {
		const computeSource = `
@compute @workgroup_size(1)
fn compute(@builtin(global_invocation_id) id: vec3u) { _ = id; }
`;
		const compute = new ComputePass({ compute: computeSource });
		const pingPongCompute = new PingPongComputePass({
			compute: computeSource,
			resources: {
				previous: { texture: 'state', access: 'sampled', pingPong: 'read' },
				next: { texture: 'state', access: 'storage-write', pingPong: 'write' }
			}
		});
		const feedback = new PingPongShaderPass({
			target: 'state',
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
		});

		const plan = planRenderGraph([compute, pingPongCompute, feedback], [0, 0, 0, 1]);
		expect(plan.preSceneSteps.map((step) => step.kind)).toEqual(['compute', 'compute', 'feedback']);
	});

	it('plans compute pass as kind="compute" step', () => {
		const computePass = createManagedComputePass();
		const plan = planRenderGraph([computePass], [0, 0, 0, 1]);
		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0]?.kind).toBe('compute');
		expect(plan.preSceneSteps).toEqual([plan.steps[0]]);
		expect(plan.computeSteps).toEqual([plan.steps[0]]);
		expect(plan.renderSteps).toEqual([]);
	});

	it('compute pass does not affect slot availability', () => {
		const computePass = createManagedComputePass();
		// After compute pass, 'target' should still not be available
		expect(() =>
			planRenderGraph(
				[computePass, createPass({ needsSwap: false, input: 'target', output: 'canvas' })],
				[0, 0, 0, 1]
			)
		).toThrow(/before it is written/);
	});

	it('compute-only passes keep finalOutput at canvas so the scene can render directly', () => {
		const computePass = createManagedComputePass();
		const plan = planRenderGraph([computePass], [0, 0, 0, 1]);
		expect(plan.preSceneSteps).toHaveLength(1);
		expect(plan.computeSteps).toHaveLength(1);
		expect(plan.renderSteps).toHaveLength(0);
		expect(plan.finalOutput).toBe('canvas');
	});

	it('preserves declaration order while splitting pre-scene compute from post-scene render steps', () => {
		const computePass = createManagedComputePass();
		const renderPass = createPass({ needsSwap: false, output: 'canvas' });
		const plan = planRenderGraph([computePass, renderPass], [0, 0, 0, 1]);
		expect(plan.steps).toHaveLength(2);
		expect(plan.steps[0]?.kind).toBe('compute');
		expect(plan.steps[1]?.kind).toBe('render');
		expect(plan.preSceneSteps).toEqual([plan.steps[0]]);
		expect(plan.computeSteps).toEqual([plan.steps[0]]);
		expect(plan.renderSteps).toEqual([plan.steps[1]]);
	});

	it('skips disabled compute passes', () => {
		const computePass = createManagedComputePass({ enabled: false });
		const plan = planRenderGraph([computePass], [0, 0, 0, 1]);
		expect(plan.steps).toHaveLength(0);
		expect(plan.preSceneSteps).toHaveLength(0);
		expect(plan.computeSteps).toHaveLength(0);
		expect(plan.renderSteps).toHaveLength(0);
	});

	it('mixed compute and render passes preserve declaration order and expose execution groups', () => {
		const compute1 = createManagedComputePass();
		const render1 = createPass({ needsSwap: false, output: 'target' });
		const compute2 = createManagedComputePass();
		const render2 = createPass({ needsSwap: false, input: 'target', output: 'canvas' });

		const plan = planRenderGraph([compute1, render1, compute2, render2], [0, 0, 0, 1]);

		expect(plan.steps.map((s) => s.kind)).toEqual(['compute', 'render', 'compute', 'render']);
		expect(plan.preSceneSteps).toEqual([plan.steps[0], plan.steps[2]]);
		expect(plan.computeSteps).toEqual([plan.steps[0], plan.steps[2]]);
		expect(plan.renderSteps).toEqual([plan.steps[1], plan.steps[3]]);
	});

	it('plans ping-pong shader pass as a pre-scene feedback step', () => {
		const feedbackPass = createManagedFeedbackPass();
		const plan = planRenderGraph([feedbackPass], [0, 0, 0, 1]);

		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0]?.kind).toBe('feedback');
		expect(plan.preSceneSteps).toEqual([plan.steps[0]]);
		expect(plan.computeSteps).toEqual([]);
		expect(plan.renderSteps).toEqual([]);
		expect(plan.finalOutput).toBe('canvas');
	});

	it('preserves declaration order for compute and ping-pong shader pre-scene passes', () => {
		const computePass = createManagedComputePass();
		const feedbackPass = createManagedFeedbackPass();
		const renderPass = createPass({ needsSwap: false, output: 'canvas' });
		const plan = planRenderGraph([feedbackPass, computePass, renderPass], [0, 0, 0, 1]);

		expect(plan.steps.map((step) => step.kind)).toEqual(['feedback', 'compute', 'render']);
		expect(plan.preSceneSteps).toEqual([plan.steps[0], plan.steps[1]]);
		expect(plan.computeSteps).toEqual([plan.steps[1]]);
		expect(plan.renderSteps).toEqual([plan.steps[2]]);
	});

	it('stably topologically sorts current readers after their unique writer', () => {
		const reader = createManagedComputePass();
		const writer = createManagedComputePass();
		const independent = createManagedComputePass();
		const plan = planRenderGraph(
			[reader, independent, writer],
			[0, 0, 0, 1],
			undefined,
			computeGraphOptions([
				[reader, computeResources({ reads: [{ logicalId: 'velocity' }] })],
				[independent, computeResources({})],
				[writer, computeResources({ writes: [{ logicalId: 'velocity' }] })]
			])
		);
		expect(plan.computeSteps.map((step) => step.pass)).toEqual([independent, writer, reader]);
		expect(plan.computeSteps[2]?.resolvedResources?.reads[0]?.logicalId).toBe('velocity');
	});

	it('orders initial-version reads before the writer', () => {
		const writer = createManagedComputePass();
		const initialReader = createManagedComputePass();
		const plan = planRenderGraph(
			[writer, initialReader],
			[0, 0, 0, 1],
			undefined,
			computeGraphOptions([
				[writer, computeResources({ writes: [{ logicalId: 'state' }] })],
				[initialReader, computeResources({ reads: [{ logicalId: 'state', version: 'initial' }] })]
			])
		);
		expect(plan.computeSteps.map((step) => step.pass)).toEqual([initialReader, writer]);
	});

	it('rejects multiple writers with pass labels and logical resource identity', () => {
		const first = createManagedComputePass();
		const second = createManagedComputePass();
		expect(() =>
			planRenderGraph(
				[first, second],
				[0, 0, 0, 1],
				undefined,
				computeGraphOptions([
					[first, computeResources({ writes: [{ logicalId: 'motion', alias: 'firstOut' }] })],
					[second, computeResources({ writes: [{ logicalId: 'motion', alias: 'secondOut' }] })]
				])
			)
		).toThrow(/multiple writers.*texture "motion".*Compute pass #0.*Compute pass #1.*secondOut/i);
		try {
			planRenderGraph(
				[first, second],
				[0, 0, 0, 1],
				undefined,
				computeGraphOptions([
					[first, computeResources({ writes: [{ logicalId: 'motion' }] })],
					[second, computeResources({ writes: [{ logicalId: 'motion' }] })]
				])
			);
			expect.fail('Expected duplicate compute writers to throw.');
		} catch (error) {
			expect(toSpektralErrorReport(error, 'render').code).toBe('COMPUTE_GRAPH_MULTIPLE_WRITERS');
		}
	});

	it('keeps material and external resources with the same logical ID independent', () => {
		const materialWriter = createManagedComputePass();
		const externalWriter = createManagedComputePass();
		const materialPhysicalId = {};

		const plan = planRenderGraph(
			[materialWriter, externalWriter],
			[0, 0, 0, 1],
			undefined,
			computeGraphOptions([
				[
					materialWriter,
					computeResources({
						writes: [{ logicalId: 'shared-name', physicalId: materialPhysicalId }]
					})
				],
				[
					externalWriter,
					computeResources({
						writes: [{ logicalId: 'shared-name', physicalId: 'external-resource-id' }]
					})
				]
			])
		);

		expect(plan.computeSteps.map((step) => step.pass)).toEqual([materialWriter, externalWriter]);
	});

	it('detects aliases with different logical IDs that resolve to one physical resource', () => {
		const first = createManagedComputePass();
		const second = createManagedComputePass();
		const physicalId = {};

		expect(() =>
			planRenderGraph(
				[first, second],
				[0, 0, 0, 1],
				undefined,
				computeGraphOptions([
					[first, computeResources({ writes: [{ logicalId: 'first-alias', physicalId }] })],
					[second, computeResources({ writes: [{ logicalId: 'second-alias', physicalId }] })]
				])
			)
		).toThrow(/multiple writers/i);
	});

	it('keeps disjoint mip ranges of one physical texture independent', () => {
		const first = createManagedComputePass();
		const second = createManagedComputePass();
		const physicalId = {};
		const mip = (baseMipLevel: number): ResolvedTextureSubresourceRange => ({
			baseMipLevel,
			mipLevelCount: 1,
			baseArrayLayer: 0,
			arrayLayerCount: 1
		});

		const plan = planRenderGraph(
			[first, second],
			[0, 0, 0, 1],
			undefined,
			computeGraphOptions([
				[
					first,
					computeResources({
						writes: [{ logicalId: 'texture-mip-0', physicalId, subresource: mip(0) }]
					})
				],
				[
					second,
					computeResources({
						writes: [{ logicalId: 'texture-mip-1', physicalId, subresource: mip(1) }]
					})
				]
			])
		);

		expect(plan.computeSteps.map((step) => step.pass)).toEqual([first, second]);
	});

	it('does not add dependencies between disjoint read and write mip ranges', () => {
		const reader = createManagedComputePass();
		const writer = createManagedComputePass();
		const physicalId = {};
		const mip = (baseMipLevel: number): ResolvedTextureSubresourceRange => ({
			baseMipLevel,
			mipLevelCount: 1,
			baseArrayLayer: 0,
			arrayLayerCount: 1
		});

		const plan = planRenderGraph(
			[reader, writer],
			[0, 0, 0, 1],
			undefined,
			computeGraphOptions([
				[
					reader,
					computeResources({
						reads: [{ logicalId: 'texture-mip-0', physicalId, subresource: mip(0) }]
					})
				],
				[
					writer,
					computeResources({
						writes: [{ logicalId: 'texture-mip-1', physicalId, subresource: mip(1) }]
					})
				]
			])
		);

		expect(plan.computeSteps.map((step) => step.pass)).toEqual([reader, writer]);
	});

	it('reports dependency cycles with aliases and the complete resource path', () => {
		const passA = createManagedComputePass();
		const passB = createManagedComputePass();
		expect(() =>
			planRenderGraph(
				[passA, passB],
				[0, 0, 0, 1],
				undefined,
				computeGraphOptions([
					[
						passA,
						computeResources({
							reads: [{ logicalId: 'b', alias: 'bIn' }],
							writes: [{ logicalId: 'a', alias: 'aOut' }]
						})
					],
					[
						passB,
						computeResources({
							reads: [{ logicalId: 'a', alias: 'aIn' }],
							writes: [{ logicalId: 'b', alias: 'bOut' }]
						})
					]
				])
			)
		).toThrow(/cycle.*Compute pass #0.*Compute pass #1.*texture "b".*bIn.*texture "a".*aIn/i);
		try {
			planRenderGraph(
				[passA, passB],
				[0, 0, 0, 1],
				undefined,
				computeGraphOptions([
					[passA, computeResources({ reads: [{ logicalId: 'b' }], writes: [{ logicalId: 'a' }] })],
					[passB, computeResources({ reads: [{ logicalId: 'a' }], writes: [{ logicalId: 'b' }] })]
				])
			);
			expect.fail('Expected a compute dependency cycle to throw.');
		} catch (error) {
			expect(toSpektralErrorReport(error, 'render').code).toBe('COMPUTE_GRAPH_CYCLE');
		}
	});

	it('does not reorder compute nodes across an opaque feedback barrier', () => {
		const reader = createManagedComputePass();
		const feedback = createManagedFeedbackPass();
		const writer = createManagedComputePass();
		const plan = planRenderGraph(
			[reader, feedback, writer],
			[0, 0, 0, 1],
			undefined,
			computeGraphOptions([
				[reader, computeResources({ reads: [{ logicalId: 'state' }] })],
				[writer, computeResources({ writes: [{ logicalId: 'state' }] })]
			])
		);
		expect(plan.preSceneSteps.map((step) => step.pass)).toEqual([reader, feedback, writer]);
	});

	it('backward compat: existing render-only plans set kind to render', () => {
		const plan = planRenderGraph([createPass()], [0, 0, 0, 1]);
		expect(plan.steps[0]?.kind).toBe('render');
	});

	it('rejects reading from canvas as input', () => {
		expect(() =>
			planRenderGraph(
				[
					createPass({
						input: 'canvas' as Exclude<RenderPass['input'], undefined>,
						needsSwap: false,
						output: 'target'
					})
				],
				[0, 0, 0, 1]
			)
		).toThrow(/cannot read from "canvas"/);
	});

	it('rejects needsSwap=true with input=target', () => {
		expect(() =>
			planRenderGraph(
				[createPass({ needsSwap: true, input: 'target', output: 'target' })],
				[0, 0, 0, 1]
			)
		).toThrow(/source->target flow/);
	});

	it('chains multiple swap passes correctly', () => {
		const plan = planRenderGraph([createPass(), createPass(), createPass()], [0, 0, 0, 1]);

		expect(plan.steps).toHaveLength(3);
		for (const step of plan.steps) {
			expect(step.input).toBe('source');
			expect(step.output).toBe('target');
			expect(step.needsSwap).toBe(true);
		}
		expect(plan.finalOutput).toBe('source');
	});

	it('handles undefined passes parameter like empty array', () => {
		const plan = planRenderGraph(undefined, [0, 0, 0, 1]);
		expect(plan.steps).toEqual([]);
		expect(plan.preSceneSteps).toEqual([]);
		expect(plan.computeSteps).toEqual([]);
		expect(plan.renderSteps).toEqual([]);
		expect(plan.finalOutput).toBe('canvas');
	});

	it('supports writing to source without swap', () => {
		const plan = planRenderGraph(
			[createPass({ needsSwap: false, output: 'source' })],
			[0, 0, 0, 1]
		);

		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0]).toMatchObject({
			input: 'source',
			output: 'source',
			needsSwap: false
		});
		expect(plan.finalOutput).toBe('source');
	});

	it('uses default clear color when pass does not specify one', () => {
		const plan = planRenderGraph([createPass({ clear: true })], [0.5, 0.6, 0.7, 1]);

		expect(plan.steps[0]?.clearColor).toEqual([0.5, 0.6, 0.7, 1]);
	});

	it.each([32, 128, 512])('checks %i compute steps with a linear number of pass reads', (count) => {
		const passes = Array.from({ length: count }, () => createManagedComputePass());
		const resources = new Map<AnyPass, ResolvedComputePassResources>(
			passes.map((pass) => [pass, computeResources({})])
		);
		const plan = planRenderGraph(passes, [0, 0, 0, 1], undefined, {
			getResolvedResources: (pass) => resources.get(pass)
		});
		let reads = 0;
		for (const step of plan.computeSteps) {
			const pass = step.pass;
			Object.defineProperty(step, 'pass', {
				get() {
					reads++;
					return pass;
				}
			});
		}
		expect(hasSameRenderGraphPhysicalAccessSignature(plan, resources)).toBe(true);
		expect(reads).toBeLessThanOrEqual(count * 2);
		resources.delete(passes[0]!);
		expect(hasSameRenderGraphPhysicalAccessSignature(plan, resources)).toBe(false);
		resources.set(createManagedComputePass(), computeResources({}));
		expect(hasSameRenderGraphPhysicalAccessSignature(plan, resources)).toBe(false);
	});

	it('reuses duplicate pass occurrences only while their full physical signature is unchanged', () => {
		const pass = createManagedComputePass();
		const physicalA = {};
		const physicalB = {};
		const initial = computeResources({
			reads: [{ logicalId: 'state', physicalId: physicalA, subresource: mipRange(0) }]
		});
		const plan = planRenderGraph([pass, pass], [0, 0, 0, 1], undefined, {
			getResolvedResources: () => initial
		});

		expect(hasSameRenderGraphPhysicalAccessSignature(plan, new Map([[pass, initial]]))).toBe(true);
		const swapped = computeResources({
			reads: [{ logicalId: 'state', physicalId: physicalB, subresource: mipRange(0) }]
		});
		expect(hasSameRenderGraphPhysicalAccessSignature(plan, new Map([[pass, swapped]]))).toBe(false);
		const differentMip = computeResources({
			reads: [{ logicalId: 'state', physicalId: physicalA, subresource: mipRange(1) }]
		});
		expect(hasSameRenderGraphPhysicalAccessSignature(plan, new Map([[pass, differentMip]]))).toBe(
			false
		);
	});
});
