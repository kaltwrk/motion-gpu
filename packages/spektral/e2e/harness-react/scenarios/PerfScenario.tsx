import { useCallback, useEffect, useMemo, useState } from 'react';
import { FragCanvas, defineMaterial } from '../../../src/lib/react';
import type { SpektralErrorReport } from '../../../src/lib/core/error-report';
import type { RenderMode, RenderPass } from '../../../src/lib/core/types';
import { detectGpuStatus, type GpuStatus } from '../gpu-status';
import { RuntimeProbe, type RuntimeControls } from '../RuntimeProbe';

type PerfWindow = Window &
	typeof globalThis & {
		__SPEKTRAL_PERF__?: {
			setMode: (mode: RenderMode) => void;
			invalidate: () => void;
			advance: () => void;
			setTaskActive: (active: boolean) => void;
		};
	};

const clearColor: [number, number, number, number] = [0, 0, 0, 1];
const renderTargets = {};

const material = defineMaterial({
	fragment: `
fn getFragmentUv() -> vec2f {
	return spektralFragment.uv;
}

fn frag(uv: vec2f) -> vec4f {
	let contextUv = getFragmentUv();
	let wave = 0.5 + 0.5 * sin(spektralFrame.time * 2.5 + contextUv.x * 6.0);
	return vec4f(wave, contextUv.y, 1.0 - wave, 1.0);
}
`
});

export function PerfScenario() {
	const [gpuStatus, setGpuStatus] = useState<GpuStatus>('checking');
	const [schedulerCount, setSchedulerCount] = useState(0);
	const [renderCount, setRenderCount] = useState(0);
	const [renderMode, setRenderMode] = useState<RenderMode>('always');
	const [lastError, setLastError] = useState('none');
	const [controls, setControls] = useState<RuntimeControls | null>(null);

	const counterPass = useMemo<RenderPass>(
		() => ({
			enabled: true,
			needsSwap: false,
			input: 'source',
			output: 'source',
			clear: false,
			preserve: true,
			render: () => {
				setRenderCount((count) => count + 1);
			}
		}),
		[]
	);
	const passes = useMemo<RenderPass[]>(() => [counterPass], [counterPass]);

	const setMode = useCallback(
		(mode: RenderMode): void => {
			if (!controls) {
				return;
			}

			controls.setRenderMode(mode);
			setRenderMode(mode);
		},
		[controls]
	);

	const handleError = useCallback((report: SpektralErrorReport): void => {
		setLastError(`${report.title}: ${report.rawMessage}`);
	}, []);

	const handleReady = useCallback(
		(nextControls: RuntimeControls): void => {
			setControls(nextControls);
			nextControls.setRenderMode(renderMode);
		},
		[renderMode]
	);

	useEffect(() => {
		void detectGpuStatus().then((status) => {
			setGpuStatus(status);
		});
	}, []);

	useEffect(() => {
		if (!controls) {
			return;
		}

		const perfWindow = window as PerfWindow;
		perfWindow.__SPEKTRAL_PERF__ = {
			setMode,
			invalidate: controls.invalidate,
			advance: controls.advance,
			setTaskActive: controls.setTaskActive
		};

		return () => {
			if (perfWindow.__SPEKTRAL_PERF__) {
				delete perfWindow.__SPEKTRAL_PERF__;
			}
		};
	}, [controls, setMode]);

	return (
		<main className="harness-main">
			<section className="harness-controls">
				<div data-testid="gpu-status">{gpuStatus}</div>
				<div data-testid="controls-ready">{controls ? 'yes' : 'no'}</div>
				<div data-testid="scheduler-count">{schedulerCount}</div>
				<div data-testid="render-count">{renderCount}</div>
				<div data-testid="render-mode">{renderMode}</div>
				<div data-testid="last-error">{lastError}</div>

				<button
					className="harness-button"
					data-testid="set-mode-always"
					onClick={() => setMode('always')}
				>
					always
				</button>
				<button
					className="harness-button"
					data-testid="set-mode-on-demand"
					onClick={() => setMode('on-demand')}
				>
					on-demand
				</button>
				<button
					className="harness-button"
					data-testid="set-mode-manual"
					onClick={() => setMode('manual')}
				>
					manual
				</button>
				<button
					className="harness-button"
					data-testid="invalidate-once"
					onClick={() => controls?.invalidate()}
				>
					invalidate
				</button>
				<button
					className="harness-button"
					data-testid="advance-once"
					onClick={() => controls?.advance()}
				>
					advance
				</button>
			</section>

			<div className="canvas-shell">
				<FragCanvas
					material={material}
					clearColor={clearColor}
					renderTargets={renderTargets}
					passes={passes}
					showErrorOverlay={false}
					onError={handleError}
				>
					<RuntimeProbe passive onFrame={setSchedulerCount} onReady={handleReady} />
				</FragCanvas>
			</div>
		</main>
	);
}
