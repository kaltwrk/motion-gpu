<script lang="ts">
	import { onMount } from 'svelte';
	import FragCanvas from '../../../src/lib/svelte/FragCanvas.svelte';
	import { defineMaterial } from '../../../src/lib/core/material';
	import type { SpektralErrorReport } from '../../../src/lib/core/error-report';
	import type { RenderMode, RenderPass } from '../../../src/lib/core/types';
	import RuntimeProbe, { type RuntimeControls } from '../RuntimeProbe.svelte';

	type PerfWindow = Window &
		typeof globalThis & {
			__SPEKTRAL_PERF__?: {
				setMode: (mode: RenderMode) => void;
				invalidate: () => void;
				advance: () => void;
				setTaskActive: (active: boolean) => void;
			};
		};

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

	let gpuStatus = $state<'checking' | 'unavailable' | 'no-adapter' | 'ready'>('checking');
	let schedulerCount = $state(0);
	let renderCount = $state(0);
	let renderMode = $state<RenderMode>('always');
	let lastError = $state('none');
	let controls = $state<RuntimeControls | null>(null);

	const counterPass: RenderPass = {
		enabled: true,
		needsSwap: false,
		input: 'source',
		output: 'source',
		clear: false,
		preserve: true,
		render: () => {
			renderCount += 1;
		}
	};

	const passes: RenderPass[] = [counterPass];

	const setMode = (mode: RenderMode): void => {
		if (!controls) {
			return;
		}

		controls.setRenderMode(mode);
		renderMode = mode;
	};

	const handleError = (report: SpektralErrorReport): void => {
		lastError = `${report.title}: ${report.rawMessage}`;
	};

	$effect(() => {
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
	});

	onMount(async () => {
		if (!navigator.gpu) {
			gpuStatus = 'unavailable';
			return;
		}

		try {
			const adapter = await navigator.gpu.requestAdapter();
			gpuStatus = adapter ? 'ready' : 'no-adapter';
		} catch {
			gpuStatus = 'no-adapter';
		}
	});
</script>

<main>
	<section class="controls">
		<div data-testid="gpu-status">{gpuStatus}</div>
		<div data-testid="controls-ready">{controls ? 'yes' : 'no'}</div>
		<div data-testid="scheduler-count">{schedulerCount}</div>
		<div data-testid="render-count">{renderCount}</div>
		<div data-testid="render-mode">{renderMode}</div>
		<div data-testid="last-error">{lastError}</div>

		<button data-testid="set-mode-always" onclick={() => setMode('always')}>always</button>
		<button data-testid="set-mode-on-demand" onclick={() => setMode('on-demand')}>on-demand</button>
		<button data-testid="set-mode-manual" onclick={() => setMode('manual')}>manual</button>
		<button data-testid="invalidate-once" onclick={() => controls?.invalidate()}>invalidate</button>
		<button data-testid="advance-once" onclick={() => controls?.advance()}>advance</button>
	</section>

	<div class="canvas-shell">
		<FragCanvas {material} {passes} showErrorOverlay={false} onError={handleError}>
			<RuntimeProbe
				passive
				onFrame={(count) => {
					schedulerCount = count;
				}}
				onReady={(nextControls) => {
					controls = nextControls;
					setMode(renderMode);
				}}
			/>
		</FragCanvas>
	</div>
</main>

<style>
	main {
		font-family: sans-serif;
		display: grid;
		gap: 0.75rem;
		padding: 0.75rem;
	}

	.controls {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	button {
		padding: 0.35rem 0.5rem;
		font: inherit;
	}

	.canvas-shell {
		width: 320px;
		height: 220px;
		border: 1px solid #d0d0d0;
	}
</style>
