import { createCurrentWritable as currentWritable } from '../core/current-value.js';
import { toSpektralErrorReport, type SpektralErrorReport } from '../core/error-report.js';
import type { FragMaterial } from '../core/material.js';
import { createSpektralGraphBridge } from '../core/render-graph-reader.js';
import { createSpektralUserContextStore } from '../core/spektral-context.js';
import { createFrameRegistry } from '../core/frame-registry.js';
import { createSpektralRuntimeLoop } from '../core/runtime-loop.js';
import type {
	AnyPass,
	ColorPipelineOptions,
	RenderMode,
	RenderTargetDefinitionMap
} from '../core/types.js';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ComponentPropsWithoutRef,
	type CSSProperties,
	type ReactNode,
	type Ref
} from 'react';
import { FrameRegistryReactContext } from './frame-context.js';
import { SpektralErrorOverlay } from './SpektralErrorOverlay.js';
import { SpektralReactContext, type SpektralContext } from './spektral-context.js';

interface FragCanvasOwnProps {
	material: FragMaterial;
	renderTargets?: RenderTargetDefinitionMap;
	passes?: AnyPass[];
	clearColor?: [number, number, number, number];
	color?: ColorPipelineOptions;
	renderMode?: RenderMode;
	autoRender?: boolean;
	maxDelta?: number;
	adapterOptions?: GPURequestAdapterOptions;
	deviceDescriptor?: GPUDeviceDescriptor;
	dpr?: number;
	showErrorOverlay?: boolean;
	errorRenderer?: (report: SpektralErrorReport) => ReactNode;
	onError?: (report: SpektralErrorReport) => void;
	errorHistoryLimit?: number;
	onErrorHistory?: (history: readonly SpektralErrorReport[]) => void;
	children?: ReactNode;
	ref?: Ref<HTMLCanvasElement>;
}

type BlockedCanvasProps = {
	height?: undefined;
	width?: undefined;
};

type CanvasDOMProps = Omit<
	ComponentPropsWithoutRef<'canvas'>,
	keyof FragCanvasOwnProps | keyof BlockedCanvasProps | 'color' | 'children'
>;

export type FragCanvasProps = FragCanvasOwnProps & CanvasDOMProps & BlockedCanvasProps;

interface RuntimePropsSnapshot {
	material: FragMaterial;
	renderTargets: RenderTargetDefinitionMap;
	passes: AnyPass[];
	clearColor: [number, number, number, number];
	color: ColorPipelineOptions | undefined;
	adapterOptions: GPURequestAdapterOptions | undefined;
	deviceDescriptor: GPUDeviceDescriptor | undefined;
	onError: ((report: SpektralErrorReport) => void) | undefined;
	errorHistoryLimit: number;
	onErrorHistory: ((history: readonly SpektralErrorReport[]) => void) | undefined;
}

interface FragCanvasRuntimeState {
	defaults: Pick<RuntimePropsSnapshot, 'renderTargets' | 'passes' | 'clearColor'>;
	registry: ReturnType<typeof createFrameRegistry>;
	context: SpektralContext;
	canvasRef: { current: HTMLCanvasElement | undefined };
	size: ReturnType<typeof currentWritable<{ width: number; height: number }>>;
	dprState: ReturnType<typeof currentWritable<number>>;
	maxDeltaState: ReturnType<typeof currentWritable<number>>;
	renderModeState: ReturnType<typeof currentWritable<RenderMode>>;
	autoRenderState: ReturnType<typeof currentWritable<boolean>>;
	graphBridge: ReturnType<typeof createSpektralGraphBridge>;
	requestFrameSignalRef: { current: (() => void) | null };
	requestFrame: () => void;
	invalidateFrame: () => void;
	advanceFrame: () => void;
}

function getInitialDpr(): number {
	if (typeof window === 'undefined') {
		return 1;
	}

	return window.devicePixelRatio ?? 1;
}

function createRuntimeState(initialDpr: number): FragCanvasRuntimeState {
	const registry = createFrameRegistry({ maxDelta: 0.1 });
	const canvasRef = { current: undefined as HTMLCanvasElement | undefined };
	const requestFrameSignalRef = { current: null as (() => void) | null };
	const requestFrame = (): void => {
		requestFrameSignalRef.current?.();
	};
	const invalidateFrame = (): void => {
		registry.invalidate();
		requestFrame();
	};
	const advanceFrame = (): void => {
		registry.advance();
		requestFrame();
	};

	const size = currentWritable({ width: 0, height: 0 });
	const dprState = currentWritable(initialDpr, requestFrame);
	const maxDeltaState = currentWritable(0.1, (value) => {
		registry.setMaxDelta(value);
		requestFrame();
	});
	const renderModeState = currentWritable<RenderMode>('always', (value) => {
		registry.setRenderMode(value);
		requestFrame();
	});
	const autoRenderState = currentWritable<boolean>(true, (value) => {
		registry.setAutoRender(value);
		requestFrame();
	});
	const userState = createSpektralUserContextStore();
	const graphBridge = createSpektralGraphBridge();

	const context: SpektralContext = {
		get canvas() {
			return canvasRef.current;
		},
		size,
		dpr: dprState,
		maxDelta: maxDeltaState,
		renderMode: renderModeState,
		autoRender: autoRenderState,
		user: userState,
		graph: graphBridge.graph,
		invalidate: invalidateFrame,
		advance: advanceFrame,
		scheduler: {
			createStage: registry.createStage,
			getStage: registry.getStage,
			setDiagnosticsEnabled: registry.setDiagnosticsEnabled,
			getDiagnosticsEnabled: registry.getDiagnosticsEnabled,
			getLastRunTimings: registry.getLastRunTimings,
			getSchedule: registry.getSchedule,
			setProfilingEnabled: registry.setProfilingEnabled,
			setProfilingWindow: registry.setProfilingWindow,
			resetProfiling: registry.resetProfiling,
			getProfilingEnabled: registry.getProfilingEnabled,
			getProfilingWindow: registry.getProfilingWindow,
			getProfilingSnapshot: registry.getProfilingSnapshot
		}
	};

	return {
		defaults: { renderTargets: {}, passes: [], clearColor: [0, 0, 0, 1] },
		registry,
		context,
		canvasRef,
		size,
		dprState,
		maxDeltaState,
		renderModeState,
		autoRenderState,
		graphBridge,
		requestFrameSignalRef,
		requestFrame,
		invalidateFrame,
		advanceFrame
	};
}

function setExternalRef<T>(ref: Ref<T> | undefined, value: T | null): (() => void) | undefined {
	if (!ref) {
		return undefined;
	}

	if (typeof ref === 'function') {
		const cleanup = ref(value);
		return typeof cleanup === 'function'
			? cleanup
			: () => {
					ref(null);
				};
	}

	ref.current = value;
	return () => {
		ref.current = null;
	};
}

export function FragCanvas({
	material,
	renderTargets: providedRenderTargets,
	passes: providedPasses,
	clearColor: providedClearColor,
	color = undefined,
	renderMode = 'always',
	autoRender = true,
	maxDelta = 0.1,
	adapterOptions = undefined,
	deviceDescriptor = undefined,
	dpr = getInitialDpr(),
	showErrorOverlay = true,
	errorRenderer,
	onError = undefined,
	errorHistoryLimit = 0,
	onErrorHistory = undefined,
	ref = undefined,
	className = '',
	style,
	children,
	height: blockedHeight = undefined,
	width: blockedWidth = undefined,
	...canvasProps
}: FragCanvasProps) {
	void blockedHeight;
	void blockedWidth;

	const runtimeRef = useRef<FragCanvasRuntimeState | null>(null);
	if (!runtimeRef.current) {
		runtimeRef.current = createRuntimeState(getInitialDpr());
	}
	const runtime = runtimeRef.current;
	const renderTargets = providedRenderTargets ?? runtime.defaults.renderTargets;
	const passes = providedPasses ?? runtime.defaults.passes;
	const clearColor = providedClearColor ?? runtime.defaults.clearColor;

	const runtimePropsRef = useRef<RuntimePropsSnapshot>({
		material,
		renderTargets,
		passes,
		clearColor,
		color,
		adapterOptions,
		deviceDescriptor,
		onError,
		errorHistoryLimit,
		onErrorHistory
	});
	useLayoutEffect(() => {
		runtimePropsRef.current = {
			material,
			renderTargets,
			passes,
			clearColor,
			color,
			adapterOptions,
			deviceDescriptor,
			onError,
			errorHistoryLimit,
			onErrorHistory
		};
	}, [
		material,
		renderTargets,
		passes,
		clearColor,
		color,
		adapterOptions,
		deviceDescriptor,
		onError,
		errorHistoryLimit,
		onErrorHistory
	]);

	const [errorReport, setErrorReport] = useState<SpektralErrorReport | null>(null);
	const dismissErrorOverlay = useCallback((): void => {
		setErrorReport(null);
	}, []);

	useEffect(() => {
		runtime.renderModeState.set(renderMode);
	}, [renderMode, runtime]);

	useEffect(() => {
		runtime.autoRenderState.set(autoRender);
	}, [autoRender, runtime]);

	useEffect(() => {
		runtime.maxDeltaState.set(maxDelta);
	}, [maxDelta, runtime]);

	useEffect(() => {
		runtime.dprState.set(dpr);
	}, [dpr, runtime]);

	useEffect(() => {
		const canvas = runtime.canvasRef.current;
		if (!canvas) {
			const report = toSpektralErrorReport(
				new Error('Canvas element is not available'),
				'initialization'
			);
			setErrorReport(report);
			runtimePropsRef.current.onError?.(report);
			return () => {
				runtime.graphBridge.updater.reset();
				runtime.registry.clear();
			};
		}

		const runtimeLoop = createSpektralRuntimeLoop({
			canvas,
			registry: runtime.registry,
			graphUpdater: runtime.graphBridge.updater,
			size: runtime.size,
			dpr: runtime.dprState,
			maxDelta: runtime.maxDeltaState,
			getMaterial: () => runtimePropsRef.current.material,
			getRenderTargets: () => runtimePropsRef.current.renderTargets,
			getPasses: () => runtimePropsRef.current.passes,
			getClearColor: () => runtimePropsRef.current.clearColor,
			getColor: () => runtimePropsRef.current.color,
			getAdapterOptions: () => runtimePropsRef.current.adapterOptions,
			getDeviceDescriptor: () => runtimePropsRef.current.deviceDescriptor,
			getOnError: () => runtimePropsRef.current.onError,
			getErrorHistoryLimit: () => runtimePropsRef.current.errorHistoryLimit,
			getOnErrorHistory: () => runtimePropsRef.current.onErrorHistory,
			reportError: (report) => {
				setErrorReport(report);
			}
		});
		runtime.requestFrameSignalRef.current = runtimeLoop.requestFrame;

		return () => {
			runtime.requestFrameSignalRef.current = null;
			runtimeLoop.destroy();
			runtime.graphBridge.updater.reset();
		};
	}, [runtime]);

	useEffect(() => {
		runtime.requestFrame();
	}, [
		adapterOptions,
		clearColor,
		color,
		deviceDescriptor,
		errorHistoryLimit,
		material,
		passes,
		renderTargets,
		runtime
	]);

	const resolvedCanvasStyle: CSSProperties = {
		position: 'absolute',
		inset: 0,
		display: 'block',
		width: '100%',
		height: '100%',
		...style
	};

	const bindCanvasRef = useCallback(
		(node: HTMLCanvasElement | null) => {
			runtime.canvasRef.current = node ?? undefined;
			const cleanupExternalRef = setExternalRef(ref, node);

			return () => {
				runtime.canvasRef.current = undefined;
				cleanupExternalRef?.();
			};
		},
		[ref, runtime]
	);

	return (
		<FrameRegistryReactContext.Provider value={runtime.registry}>
			<SpektralReactContext.Provider value={runtime.context}>
				<div
					className="spektral-canvas-wrap"
					style={{
						position: 'relative',
						width: '100%',
						height: '100%',
						minWidth: 0,
						minHeight: 0,
						overflow: 'hidden'
					}}
				>
					<canvas
						{...canvasProps}
						className={className}
						style={resolvedCanvasStyle}
						ref={bindCanvasRef}
					/>
					{showErrorOverlay && errorReport ? (
						errorRenderer ? (
							errorRenderer(errorReport)
						) : (
							<SpektralErrorOverlay report={errorReport} onDismiss={dismissErrorOverlay} />
						)
					) : null}
					{children}
				</div>
			</SpektralReactContext.Provider>
		</FrameRegistryReactContext.Provider>
	);
}
