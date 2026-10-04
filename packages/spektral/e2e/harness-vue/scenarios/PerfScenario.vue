<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue';
import { FragCanvas, defineMaterial } from '../../../src/lib/vue';
import type { SpektralErrorReport } from '../../../src/lib/core/error-report';
import type { RenderMode, RenderPass } from '../../../src/lib/core/types';
import { detectGpuStatus, type GpuStatus } from '../gpu-status';
import RuntimeProbe from '../RuntimeProbe.vue';
import type { RuntimeControls } from '../runtime-controls';

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

const gpuStatus = ref<GpuStatus>('checking');
const schedulerCount = ref(0);
const renderCount = ref(0);
const renderMode = ref<RenderMode>('always');
const lastError = ref('none');
const controls = ref<RuntimeControls | null>(null);

const counterPass = {
	enabled: true,
	needsSwap: false,
	input: 'source',
	output: 'source',
	clear: false,
	preserve: true,
	render: () => {
		renderCount.value += 1;
	}
} satisfies RenderPass;

const passes = computed(() => [counterPass]);

function setMode(mode: RenderMode): void {
	if (!controls.value) {
		return;
	}

	controls.value.setRenderMode(mode);
	renderMode.value = mode;
}

function handleError(report: SpektralErrorReport): void {
	lastError.value = `${report.title}: ${report.rawMessage}`;
}

function handleReady(nextControls: RuntimeControls): void {
	controls.value = nextControls;
	nextControls.setRenderMode(renderMode.value);
}

onMounted(async () => {
	gpuStatus.value = await detectGpuStatus();
});

watchEffect((onCleanup) => {
	if (!controls.value) {
		return;
	}

	const perfWindow = window as PerfWindow;
	perfWindow.__SPEKTRAL_PERF__ = {
		setMode,
		invalidate: controls.value.invalidate,
		advance: controls.value.advance,
		setTaskActive: controls.value.setTaskActive
	};

	onCleanup(() => {
		if (perfWindow.__SPEKTRAL_PERF__) {
			delete perfWindow.__SPEKTRAL_PERF__;
		}
	});
});
</script>

<template>
	<main class="harness-main">
		<section class="harness-controls">
			<div data-testid="gpu-status">{{ gpuStatus }}</div>
			<div data-testid="controls-ready">{{ controls ? 'yes' : 'no' }}</div>
			<div data-testid="scheduler-count">{{ schedulerCount }}</div>
			<div data-testid="render-count">{{ renderCount }}</div>
			<div data-testid="render-mode">{{ renderMode }}</div>
			<div data-testid="last-error">{{ lastError }}</div>

			<button class="harness-button" data-testid="set-mode-always" @click="setMode('always')">
				always
			</button>
			<button class="harness-button" data-testid="set-mode-on-demand" @click="setMode('on-demand')">
				on-demand
			</button>
			<button class="harness-button" data-testid="set-mode-manual" @click="setMode('manual')">
				manual
			</button>
			<button class="harness-button" data-testid="invalidate-once" @click="controls?.invalidate()">
				invalidate
			</button>
			<button class="harness-button" data-testid="advance-once" @click="controls?.advance()">
				advance
			</button>
		</section>

		<div class="canvas-shell">
			<FragCanvas
				:material="material"
				:passes="passes"
				:showErrorOverlay="false"
				:onError="handleError"
			>
				<RuntimeProbe
					passive
					:onFrame="(count) => (schedulerCount = count)"
					:onReady="handleReady"
				/>
			</FragCanvas>
		</div>
	</main>
</template>
