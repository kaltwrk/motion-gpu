import type { AnyPass, RenderPass, RenderPassInputSlot, RenderPassOutputSlot } from './types.js';
import type { ResolvedComputeAccess, ResolvedComputePassResources } from './compute-resources.js';
import { createSpektralError } from './error-report.js';
import {
	analyzeComputeDependencies,
	ComputeDependencyAnalysisError,
	type ComputeDependencyEdge
} from './render-graph-dependencies.js';
import {
	assertSpektralPass,
	isManagedComputePass,
	isManagedFeedbackPass
} from './pass-contract.js';

/**
 * Resolved render-pass step with defaults applied.
 */
export interface RenderGraphStep {
	/** Position of this pass in the user declaration. */
	declarationIndex: number;
	/**
	 * Step kind. 'render' for post-scene render passes, 'compute' for pre-scene
	 * compute passes, 'feedback' for pre-scene fragment ping-pong passes.
	 */
	kind: 'render' | 'compute' | 'feedback';
	/**
	 * User pass instance.
	 */
	pass: AnyPass;
	/**
	 * Resolved input slot. Ignored for compute steps.
	 */
	input: RenderPassInputSlot;
	/**
	 * Resolved output slot. Ignored for compute steps.
	 */
	output: RenderPassOutputSlot;
	/**
	 * Whether ping-pong swap should be performed after render.
	 */
	needsSwap: boolean;
	/**
	 * Whether pass should clear output before drawing.
	 */
	clear: boolean;
	/**
	 * Effective clear color.
	 */
	clearColor: [number, number, number, number];
	/**
	 * Whether output should be preserved after pass ends.
	 */
	preserve: boolean;
	/** Frame-snapshot resources consumed by a compute step. */
	resolvedResources?: ResolvedComputePassResources;
	/** Stable diagnostic label assigned by the renderer. */
	computeLabel?: string;
}

export interface ComputeRenderGraphOptions {
	getResolvedResources: (pass: AnyPass) => ResolvedComputePassResources | undefined;
	getPassLabel?: (pass: AnyPass) => string;
}

/**
 * Immutable render-graph execution plan for one frame.
 */
export interface RenderGraphPlan {
	/**
	 * Resolved enabled steps in declaration order.
	 */
	steps: RenderGraphStep[];
	/**
	 * Enabled pre-scene steps in declaration order.
	 */
	preSceneSteps: RenderGraphStep[];
	/**
	 * Enabled compute steps. These always execute before the base scene render.
	 */
	computeSteps: RenderGraphStep[];
	/** Number of distinct compute pass identities captured while planning. */
	readonly uniqueComputePassCount: number;
	/**
	 * Enabled render steps. These always execute after the base scene render.
	 */
	renderSteps: RenderGraphStep[];
	/**
	 * Output slot holding final post-scene render result before presentation.
	 * Remains 'canvas' when there are no render steps.
	 */
	finalOutput: RenderPassOutputSlot;
	/** Physical compute hazards used to derive pre-scene execution order. */
	dependencyEdges: readonly ComputeDependencyEdge<RenderGraphStep>[];
}

function subresourceEqual(
	left: ResolvedComputeAccess['subresource'],
	right: ResolvedComputeAccess['subresource']
): boolean {
	if (left === right) return true;
	return (
		left !== undefined &&
		right !== undefined &&
		left.baseMipLevel === right.baseMipLevel &&
		left.mipLevelCount === right.mipLevelCount &&
		left.baseArrayLayer === right.baseArrayLayer &&
		left.arrayLayerCount === right.arrayLayerCount
	);
}

function accessEqual(left: ResolvedComputeAccess, right: ResolvedComputeAccess): boolean {
	return (
		left.alias === right.alias &&
		left.resourceKind === right.resourceKind &&
		Object.is(left.logicalId, right.logicalId) &&
		Object.is(left.physicalId, right.physicalId) &&
		left.source === right.source &&
		left.mode === right.mode &&
		left.version === right.version &&
		subresourceEqual(left.subresource, right.subresource)
	);
}

function accessListEqual(
	left: readonly ResolvedComputeAccess[],
	right: readonly ResolvedComputeAccess[]
): boolean {
	if (left === right) return true;
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		const leftAccess = left[index];
		const rightAccess = right[index];
		if (!leftAccess || !rightAccess || !accessEqual(leftAccess, rightAccess)) return false;
	}
	return true;
}

/**
 * Compares the complete physical-access signature used by dependency analysis.
 * No strings or descriptor arrays are allocated on the steady-state path.
 */
export function hasSameRenderGraphPhysicalAccessSignature(
	plan: RenderGraphPlan,
	resolvedByPass: ReadonlyMap<AnyPass, ResolvedComputePassResources>
): boolean {
	if (plan.uniqueComputePassCount !== resolvedByPass.size) return false;
	for (const step of plan.computeSteps) {
		const previous = step.resolvedResources;
		const current = resolvedByPass.get(step.pass);
		if (
			!previous ||
			!current ||
			!accessListEqual(previous.reads, current.reads) ||
			!accessListEqual(previous.writes, current.writes)
		) {
			return false;
		}
	}
	return true;
}

/**
 * Creates a copy of RGBA clear color.
 */
function cloneClearColor(
	color: [number, number, number, number]
): [number, number, number, number] {
	return [color[0], color[1], color[2], color[3]];
}

/**
 * Formats a logical compute resource for actionable graph diagnostics.
 */
function formatLogicalResource(access: ResolvedComputeAccess): string {
	const id =
		typeof access.logicalId === 'symbol'
			? (access.logicalId.description ?? access.logicalId.toString())
			: access.logicalId;
	return `${access.resourceKind} "${id}"`;
}

/**
 * Orders a compute segment by physical hazards while preserving stable source order.
 */
function stableTopologicalComputeSegment(segment: RenderGraphStep[]): {
	ordered: readonly RenderGraphStep[];
	edges: readonly ComputeDependencyEdge<RenderGraphStep>[];
} {
	try {
		const analysis = analyzeComputeDependencies(
			segment.map((step, index) => ({
				value: step,
				label: step.computeLabel ?? `compute pass #${index}`,
				...(step.resolvedResources ? { resources: step.resolvedResources } : {})
			}))
		);
		return { ordered: analysis.orderedNodes, edges: analysis.edges };
	} catch (error) {
		if (!(error instanceof ComputeDependencyAnalysisError)) throw error;
		const diagnostic = error.diagnostic;
		if (diagnostic.kind === 'multiple-writers') {
			throw createSpektralError(
				'COMPUTE_GRAPH_MULTIPLE_WRITERS',
				`Compute graph has multiple writers for ${formatLogicalResource(diagnostic.secondAccess)}: ${diagnostic.firstLabel} and ${diagnostic.secondLabel} (alias "${diagnostic.secondAccess.alias}").`
			);
		}
		const cycleEdges = diagnostic.edges.flatMap((edge) =>
			edge.reasons.map(
				(reason) =>
					`${edge.from.computeLabel ?? `compute pass #${segment.indexOf(edge.from)}`} -> ${edge.to.computeLabel ?? `compute pass #${segment.indexOf(edge.to)}`} via ${formatLogicalResource(reason.reader)} (alias "${reason.reader.alias}")`
			)
		);
		throw createSpektralError(
			'COMPUTE_GRAPH_CYCLE',
			`Compute dependency cycle detected among ${diagnostic.blockedLabels.join(', ')}: ${cycleEdges.join('; ')}.`
		);
	}
}

/**
 * Reorders only contiguous compute blocks, leaving render-pass boundaries fixed.
 */
function planComputeSegments(preSceneSteps: RenderGraphStep[]): {
	steps: RenderGraphStep[];
	edges: ComputeDependencyEdge<RenderGraphStep>[];
} {
	const ordered: RenderGraphStep[] = [];
	const edges: ComputeDependencyEdge<RenderGraphStep>[] = [];
	let segment: RenderGraphStep[] = [];
	const flush = (): void => {
		if (segment.length === 0) return;
		const analysis = stableTopologicalComputeSegment(segment);
		ordered.push(...analysis.ordered);
		edges.push(...analysis.edges);
		segment = [];
	};

	for (const step of preSceneSteps) {
		if (step.kind === 'compute') {
			segment.push(step);
		} else {
			flush();
			ordered.push(step);
		}
	}
	flush();
	return { steps: ordered, edges };
}

/**
 * Builds validated render graph plan from runtime pass list.
 *
 * @param passes - Runtime passes.
 * @param defaultClearColor - Global clear color fallback.
 * @returns Resolved render graph plan.
 */
export function planRenderGraph(
	passes: AnyPass[] | undefined,
	defaultClearColor: [number, number, number, number],
	renderTargetSlots?: Iterable<string>,
	computeOptions?: ComputeRenderGraphOptions
): RenderGraphPlan {
	const steps: RenderGraphStep[] = [];
	const preSceneSteps: RenderGraphStep[] = [];
	const computeSteps: RenderGraphStep[] = [];
	const renderSteps: RenderGraphStep[] = [];
	const declaredTargets = new Set(renderTargetSlots ?? []);
	const availableSlots = new Set<RenderPassInputSlot | RenderPassOutputSlot>(['source']);
	let finalOutput: RenderPassOutputSlot = 'canvas';
	let enabledIndex = 0;

	for (const [declarationIndex, pass] of (passes ?? []).entries()) {
		assertSpektralPass(pass);
		if (pass.enabled === false) {
			continue;
		}

		// Compute passes don't participate in slot routing
		if (isManagedComputePass(pass)) {
			const resolvedResources = computeOptions?.getResolvedResources(pass);
			const step: RenderGraphStep = {
				declarationIndex,
				kind: 'compute',
				pass,
				input: 'source',
				output: 'source',
				needsSwap: false,
				clear: false,
				clearColor: cloneClearColor(defaultClearColor),
				preserve: true,
				...(resolvedResources ? { resolvedResources } : {}),
				...(computeOptions?.getPassLabel ? { computeLabel: computeOptions.getPassLabel(pass) } : {})
			};
			steps.push(step);
			preSceneSteps.push(step);
			computeSteps.push(step);
			continue;
		}

		if (isManagedFeedbackPass(pass)) {
			const step: RenderGraphStep = {
				declarationIndex,
				kind: 'feedback',
				pass,
				input: 'source',
				output: 'source',
				needsSwap: false,
				clear: false,
				clearColor: cloneClearColor(defaultClearColor),
				preserve: true
			};
			steps.push(step);
			preSceneSteps.push(step);
			continue;
		}

		// After compute guard, pass is a render pass
		const rp = pass as RenderPass;
		const needsSwap = rp.needsSwap ?? true;
		const input: RenderPassInputSlot = rp.input ?? 'source';
		const output: RenderPassOutputSlot = rp.output ?? (needsSwap ? 'target' : 'source');

		if (input === 'canvas') {
			throw new Error(`Render pass #${enabledIndex} cannot read from "canvas".`);
		}

		const inputIsNamed = input !== 'source' && input !== 'target';
		if (inputIsNamed && !declaredTargets.has(input)) {
			throw new Error(`Render pass #${enabledIndex} reads unknown target "${input}".`);
		}

		const outputIsNamed = output !== 'source' && output !== 'target' && output !== 'canvas';
		if (outputIsNamed && !declaredTargets.has(output)) {
			throw new Error(`Render pass #${enabledIndex} writes unknown target "${output}".`);
		}

		if (needsSwap && (input !== 'source' || output !== 'target')) {
			throw new Error(
				`Render pass #${enabledIndex} uses needsSwap=true but does not follow source->target flow.`
			);
		}

		if (!availableSlots.has(input)) {
			throw new Error(`Render pass #${enabledIndex} reads "${input}" before it is written.`);
		}

		const clear = rp.clear ?? false;
		const clearColor = cloneClearColor(rp.clearColor ?? defaultClearColor);
		const preserve = rp.preserve ?? true;

		const step: RenderGraphStep = {
			declarationIndex,
			kind: 'render',
			pass,
			input,
			output,
			needsSwap,
			clear,
			clearColor,
			preserve
		};
		steps.push(step);
		renderSteps.push(step);

		if (needsSwap) {
			availableSlots.add('target');
			availableSlots.add('source');
			finalOutput = 'source';
		} else {
			if (output !== 'canvas') {
				availableSlots.add(output);
			}
			finalOutput = output;
		}

		enabledIndex += 1;
	}

	const computePlan = computeOptions
		? planComputeSegments(preSceneSteps)
		: { steps: preSceneSteps, edges: [] };
	const orderedPreSceneSteps = computePlan.steps;
	const orderedComputeSteps = orderedPreSceneSteps.filter((step) => step.kind === 'compute');
	const effectiveComputeSteps = computeOptions ? orderedComputeSteps : computeSteps;

	return {
		steps,
		preSceneSteps: orderedPreSceneSteps,
		computeSteps: effectiveComputeSteps,
		uniqueComputePassCount: new Set(effectiveComputeSteps.map((step) => step.pass)).size,
		renderSteps,
		finalOutput,
		dependencyEdges: computePlan.edges
	};
}
