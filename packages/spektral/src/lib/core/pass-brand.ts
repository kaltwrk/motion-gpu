/** Internal nominal marker shared by Spektral-managed pass classes. */
export const managedPassBrand: unique symbol = Symbol('Spektral managed pass');

export type ManagedPassKind = 'compute' | 'feedback';

export interface FeedbackOwnerState {
	totalIterations: number;
	resetPending: boolean;
}

/** Internal selection of feedback state owned by a renderer's texture pair. */
export const selectFeedbackOwner: unique symbol = Symbol('Spektral select feedback owner');

/** Internal nominal marker for built-in render passes with a known WGSL format contract. */
export const builtInRenderPassBrand: unique symbol = Symbol('Spektral built-in render pass');

export interface BuiltInRenderPassFormatContract {
	readonly passName: string;
	readonly input: 'float-sampled';
	readonly output: 'float-renderable';
}

/** Internal nominal marker for fullscreen passes prepared by a renderer owner. */
export const preparedFullscreenPassBrand: unique symbol = Symbol(
	'Spektral prepared fullscreen pass'
);

/** Internal async preparation entry point. */
export const prepareFullscreenPass: unique symbol = Symbol('Spektral prepare fullscreen pass');

/** Internal renderer-owner release entry point. */
export const releaseFullscreenPass: unique symbol = Symbol('Spektral release fullscreen pass');

/** Internal readiness query used to keep asynchronous work out of frame encoding. */
export const isFullscreenPassPrepared: unique symbol = Symbol('Spektral fullscreen pass ready');

export interface FullscreenPassPreparation {
	device: GPUDevice;
	owner: object;
	inputFormat: GPUTextureFormat;
	outputFormat: GPUTextureFormat;
	/** Reports a current hot-edit failure without invalidating last-known-good output. */
	reportRecoverableError?: (error: Error) => void;
	/** Requests a frame after a current hot edit successfully replaces last-known-good. */
	requestRender?: () => void;
	/** Replaces obsolete format keys held by this owner after preparation succeeds. */
	replaceOwnerFormats?: boolean;
	/** Keeps a dynamic owner registered so a later shader edit can recover on demand. */
	retainOwnerOnFailure?: boolean;
}

export interface PreparedFullscreenPassContract {
	readonly [preparedFullscreenPassBrand]: true;
	[prepareFullscreenPass](input: FullscreenPassPreparation): Promise<void>;
	[releaseFullscreenPass](device: GPUDevice, owner: object): void;
	[isFullscreenPassPrepared](
		device: GPUDevice,
		inputFormat: GPUTextureFormat,
		outputFormat: GPUTextureFormat
	): boolean;
}
