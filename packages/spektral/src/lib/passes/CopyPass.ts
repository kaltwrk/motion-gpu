import type {
	RenderPass,
	RenderPassContext,
	RenderPassFlags,
	RenderPassInputSlot,
	RenderPassOutputSlot
} from '../core/types.js';
import { BlitPass } from './BlitPass.js';
import {
	assertFloatRenderableFormat,
	assertFloatSampledFormat
} from '../core/format-capabilities.js';
import {
	builtInRenderPassBrand,
	isFullscreenPassPrepared,
	preparedFullscreenPassBrand,
	prepareFullscreenPass,
	releaseFullscreenPass,
	type BuiltInRenderPassFormatContract,
	type FullscreenPassPreparation
} from '../core/pass-brand.js';

export interface CopyPassOptions extends RenderPassFlags {
	label?: string;
	enabled?: boolean;
	needsSwap?: boolean;
	input?: RenderPassInputSlot;
	output?: RenderPassOutputSlot;
	filter?: GPUFilterMode;
}

class CopyFallbackBlitPass extends BlitPass {
	protected override getDiagnosticPassKind(): string {
		return 'CopyPass';
	}
}

/**
 * Texture copy pass with fullscreen-blit fallback.
 */
export class CopyPass implements RenderPass {
	readonly [builtInRenderPassBrand]: BuiltInRenderPassFormatContract = Object.freeze({
		passName: 'CopyPass',
		input: 'float-sampled',
		output: 'float-renderable'
	});
	readonly [preparedFullscreenPassBrand] = true as const;
	readonly label?: string;
	enabled: boolean;
	needsSwap: boolean;
	input: RenderPassInputSlot;
	output: RenderPassOutputSlot;
	clear: boolean;
	clearColor: [number, number, number, number];
	preserve: boolean;
	private readonly fallbackBlit: BlitPass;

	constructor(options: CopyPassOptions = {}) {
		if (options.label !== undefined) this.label = options.label;
		this.enabled = options.enabled ?? true;
		this.needsSwap = options.needsSwap ?? true;
		this.input = options.input ?? 'source';
		this.output = options.output ?? (this.needsSwap ? 'target' : 'source');
		this.clear = options.clear ?? false;
		this.clearColor = options.clearColor ?? [0, 0, 0, 1];
		this.preserve = options.preserve ?? true;
		this.fallbackBlit = new CopyFallbackBlitPass({
			...(options.label !== undefined ? { label: options.label } : {}),
			enabled: true,
			needsSwap: false,
			input: this.input,
			output: this.output,
			...(options.filter !== undefined ? { filter: options.filter } : {})
		});
	}

	setSize(width: number, height: number): void {
		this.fallbackBlit.setSize(width, height);
	}

	[prepareFullscreenPass](input: FullscreenPassPreparation): Promise<void> {
		return this.fallbackBlit[prepareFullscreenPass](input);
	}

	[releaseFullscreenPass](device: GPUDevice, owner: object): void {
		this.fallbackBlit[releaseFullscreenPass](device, owner);
	}

	[isFullscreenPassPrepared](
		device: GPUDevice,
		inputFormat: GPUTextureFormat,
		outputFormat: GPUTextureFormat
	): boolean {
		return this.fallbackBlit[isFullscreenPassPrepared](device, inputFormat, outputFormat);
	}

	render(context: RenderPassContext): void {
		assertFloatSampledFormat({
			format: context.input.format,
			target: String(this.input),
			pass: 'CopyPass',
			deviceFeatures: context.device.features
		});
		assertFloatRenderableFormat({
			format: context.output.format,
			target: String(this.output),
			pass: 'CopyPass',
			deviceFeatures: context.device.features
		});
		const source = context.input;
		const target = context.output;
		const canDirectCopy =
			context.clear === false &&
			context.preserve === true &&
			source.texture !== target.texture &&
			this.input !== 'canvas' &&
			this.output !== 'canvas' &&
			// Inspect the resolved textures without allocating the lazy canvas surface.
			(source.texture.usage & GPUTextureUsage.COPY_SRC) !== 0 &&
			(target.texture.usage & GPUTextureUsage.COPY_DST) !== 0 &&
			source.width === target.width &&
			source.height === target.height &&
			source.format === target.format;

		if (canDirectCopy) {
			context.commandEncoder.copyTextureToTexture(
				{ texture: source.texture },
				{ texture: target.texture },
				{ width: source.width, height: source.height, depthOrArrayLayers: 1 }
			);
			return;
		}

		this.fallbackBlit.render(context);
	}

	dispose(): void {
		this.fallbackBlit.dispose();
	}
}
