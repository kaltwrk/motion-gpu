import type { RenderGraphPlan } from '../render-graph.js';
import type {
	AnyPass,
	RenderPass,
	RenderPassInputSlot,
	RenderPassOutputSlot,
	RenderTarget
} from '../types.js';
import type { RenderGraphPassSnapshot } from './internal-types.js';
import { toClearValue } from './presentation.js';

export function isRenderGraphPlanCacheValid(input: {
	cachedPlan: RenderGraphPlan | null;
	cachedRenderTargetSignature: string;
	renderTargetSignature: string;
	cachedClearColor: [number, number, number, number];
	clearColor: [number, number, number, number];
	cachedPasses: RenderGraphPassSnapshot[];
	passes: AnyPass[];
}): boolean {
	if (!input.cachedPlan || input.cachedRenderTargetSignature !== input.renderTargetSignature) {
		return false;
	}
	for (let index = 0; index < 4; index += 1) {
		if (input.cachedClearColor[index] !== input.clearColor[index]) return false;
	}
	if (input.cachedPasses.length !== input.passes.length) return false;
	for (let index = 0; index < input.passes.length; index += 1) {
		const pass = input.passes[index];
		const renderPass = pass as Partial<RenderPass>;
		const snapshot = input.cachedPasses[index];
		if (!pass || !snapshot || snapshot.pass !== pass) return false;
		if (
			snapshot.enabled !== pass.enabled ||
			snapshot.needsSwap !== renderPass.needsSwap ||
			snapshot.input !== renderPass.input ||
			snapshot.output !== renderPass.output ||
			snapshot.clear !== renderPass.clear ||
			snapshot.preserve !== renderPass.preserve
		) {
			return false;
		}
		const passClearColor = renderPass.clearColor;
		if (snapshot.hasClearColor !== (passClearColor !== undefined)) return false;
		if (
			passClearColor &&
			(snapshot.clearColor0 !== passClearColor[0] ||
				snapshot.clearColor1 !== passClearColor[1] ||
				snapshot.clearColor2 !== passClearColor[2] ||
				snapshot.clearColor3 !== passClearColor[3])
		) {
			return false;
		}
	}
	return true;
}

export function updateRenderGraphPassSnapshots(
	snapshots: RenderGraphPassSnapshot[],
	passes: AnyPass[]
): void {
	snapshots.length = passes.length;
	let index = 0;
	for (const pass of passes) {
		const renderPass = pass as Partial<RenderPass>;
		const passClearColor = renderPass.clearColor;
		const snapshot = snapshots[index];
		const values: RenderGraphPassSnapshot = {
			pass,
			enabled: pass.enabled,
			needsSwap: renderPass.needsSwap,
			input: renderPass.input,
			output: renderPass.output,
			clear: renderPass.clear,
			preserve: renderPass.preserve,
			hasClearColor: passClearColor !== undefined,
			clearColor0: passClearColor?.[0] ?? 0,
			clearColor1: passClearColor?.[1] ?? 0,
			clearColor2: passClearColor?.[2] ?? 0,
			clearColor3: passClearColor?.[3] ?? 0
		};
		if (!snapshot) {
			snapshots[index] = values;
		} else {
			Object.assign(snapshot, values);
		}
		index += 1;
	}
}

export function executePostSceneRenderGraph(input: {
	device: GPUDevice;
	commandEncoder: GPUCommandEncoder;
	graphPlan: RenderGraphPlan;
	slots: { source: RenderTarget; target: RenderTarget; canvas: RenderTarget } | null;
	sceneOutput: RenderTarget;
	canvasSurface: RenderTarget;
	runtimeTargets: Readonly<Record<string, RenderTarget>>;
	time: number;
	delta: number;
	width: number;
	height: number;
	clearColor: [number, number, number, number];
	presentationRequired: boolean;
	present: (
		sourceView: GPUTextureView,
		canvasView: GPUTextureView,
		applyFinalTransform: boolean
	) => void;
}): RenderTarget {
	let finalPresentationSurface = input.sceneOutput;
	if (input.slots) {
		const resolveStepSurface = (slot: RenderPassInputSlot | RenderPassOutputSlot): RenderTarget => {
			if (slot === 'source') return input.slots!.source;
			if (slot === 'target') return input.slots!.target;
			if (slot === 'canvas') return input.slots!.canvas;
			const named = input.runtimeTargets[slot];
			if (!named) throw new Error(`Render graph references unknown runtime target "${slot}".`);
			return named;
		};

		for (const step of input.graphPlan.renderSteps) {
			const source = input.slots.source;
			let target: RenderTarget | undefined;
			const output = resolveStepSurface(step.output);
			(step.pass as RenderPass).render({
				device: input.device,
				commandEncoder: input.commandEncoder,
				source,
				get target() {
					return (target ??= input.slots!.target);
				},
				get canvas() {
					return input.slots!.canvas;
				},
				input: resolveStepSurface(step.input),
				output,
				targets: input.runtimeTargets,
				time: input.time,
				delta: input.delta,
				width: input.width,
				height: input.height,
				clear: step.clear,
				clearColor: step.clearColor,
				preserve: step.preserve,
				beginRenderPass: (options) => {
					const clear = options?.clear ?? step.clear;
					const preserve = options?.preserve ?? step.preserve;
					return input.commandEncoder.beginRenderPass({
						colorAttachments: [
							{
								view: options?.view ?? output.view,
								clearValue: toClearValue(options?.clearColor ?? step.clearColor),
								loadOp: clear ? 'clear' : 'load',
								storeOp: preserve ? 'store' : 'discard'
							}
						]
					});
				}
			});
			if (step.needsSwap) {
				input.slots.source = target ?? input.slots.target;
				input.slots.target = source;
			}
		}

		finalPresentationSurface = resolveStepSurface(input.graphPlan.finalOutput);
	}
	// Scene and postprocessing surfaces contain linear colors. Encode only when
	// presenting the final surface, including the default SDR postprocessing path.
	if (input.slots || input.presentationRequired) {
		input.present(finalPresentationSurface.view, input.canvasSurface.view, true);
	}
	return finalPresentationSurface;
}
