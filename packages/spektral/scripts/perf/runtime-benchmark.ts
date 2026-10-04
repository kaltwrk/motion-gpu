import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { chromium, type Page } from '@playwright/test';
import { build, preview, type PreviewServer } from 'vite';
import { createComputeBindGroupCache } from '../../src/lib/core/compute-bindgroup-cache.js';
import {
	BENCHMARK_SCHEMA_VERSION,
	collectBenchmarkEnvironment,
	compareBenchmarkEnvironments,
	type AdapterIdentity,
	type BenchmarkEnvironment
} from './benchmark-schema';
import { compareBenchmarkMetrics } from './benchmark-regression';
import { computeRobustStats, type RobustStats } from './statistics';

const SCRIPT_DIR = import.meta.dirname;
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '../..');
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, '../..');
const E2E_CONFIG_PATH = resolve(PACKAGE_ROOT, 'e2e/vite.config.ts');
const PERF_SCENARIO_PATH = resolve(PACKAGE_ROOT, 'e2e/harness/scenarios/PerfScenario.svelte');
const BASELINE_PATH = resolve(PACKAGE_ROOT, 'benchmarks/baselines/runtime.json');
const LATEST_PATH = resolve(PACKAGE_ROOT, 'benchmarks/results/runtime-latest.json');

const BROWSER_LAUNCH_ARGS = [
	'--enable-unsafe-webgpu',
	'--use-angle=swiftshader',
	'--enable-features=Vulkan',
	'--disable-vulkan-surface'
] as const;

const MODE_SAMPLE_MS = 4_000;
const IDLE_SETTLE_MS = 700;
const MANUAL_ADVANCE_DURATION_MS = 4_000;
const MANUAL_ADVANCE_INTERVAL_MS = 16;
const MANUAL_ADVANCE_LATENCY_SAMPLES = 40;
const COMPUTE_STORAGE_SAMPLE_FRAMES = 1_000;
const STARTUP_CONTEXT_SAMPLES = 10;

const METRIC_RULES = {
	startup_cold_first_frame_median_ms: { direction: 'lower', maxRegressionPct: 25 },
	startup_warm_first_frame_median_ms: { direction: 'lower', maxRegressionPct: 25 },
	manual_advance_latency_p95_ms: { direction: 'lower', maxRegressionPct: 25 },
	compute_storage_bindgroup_creations_per_1000_frames: {
		direction: 'lower',
		maxRegressionPct: 25
	}
} as const;

type MetricKey = keyof typeof METRIC_RULES;

type MetricMap = Record<MetricKey, number>;

interface ModeSample {
	elapsedSec: number;
	schedulerDelta: number;
	renderDelta: number;
	schedulerHz: number;
	renderHz: number;
}

interface LatencySample {
	samplesMs: number[];
	meanMs: number;
	p50Ms: number;
	p95Ms: number;
	maxMs: number;
}

interface RuntimeBenchmarkDocument {
	schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
	generatedAt: string;
	environment: BenchmarkEnvironment;
	config: {
		serverMode: 'production-build-preview';
		startupContextSamples: number;
		modeSampleMs: number;
		idleSettleMs: number;
		manualAdvanceDurationMs: number;
		manualAdvanceIntervalMs: number;
		manualAdvanceLatencySamples: number;
		computeStorageSampleFrames: number;
		computeStorageMeasurement: 'synthetic-cache-helper';
		schedulerMeasurement: 'delivered-page-raf-callbacks';
	};
	metrics: MetricMap;
	invariants: {
		onDemandIdleExactZero: boolean;
		manualIdleExactZero: boolean;
		manualAdvanceOneSchedulerPerPulse: boolean;
		manualAdvanceOneRenderPerPulse: boolean;
	};
	samples: {
		startup: {
			cold: RobustStats;
			warm: RobustStats;
		};
		always: ModeSample;
		onDemandIdle: ModeSample;
		manualIdle: ModeSample;
		manualAdvance: ModeSample & { pulses: number };
		manualAdvanceLatency: LatencySample;
		computeStorage: {
			frames: number;
			bindGroupLayoutCreations: number;
			bindGroupCreations: number;
			creationsPer1000Frames: number;
		};
	};
}

interface RuntimeBaselineDocument {
	schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
	updatedAt: string;
	environment: BenchmarkEnvironment;
	config: RuntimeBenchmarkDocument['config'];
	metrics: Partial<MetricMap>;
}

type PerfWindow = Window &
	typeof globalThis & {
		__SPEKTRAL_PERF__?: {
			setMode: (mode: 'always' | 'on-demand' | 'manual') => void;
			invalidate: () => void;
			advance: () => void;
		};
	};

function parseArgs(argv: string[]): {
	updateBaseline: boolean;
	strict: boolean;
} {
	const flags = new Set(argv);
	return {
		updateBaseline: flags.has('--update-baseline'),
		strict: flags.has('--strict')
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => {
		setTimeout(resolveDelay, ms);
	});
}

async function waitForServer(url: string, timeoutMs = 45_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown = null;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				return;
			}
			lastError = new Error(`Server responded with status ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await delay(250);
	}

	throw new Error(`Timed out waiting for ${url}. Last error: ${String(lastError)}`);
}

interface HarnessServer {
	server: PreviewServer;
	outDir: string;
	url: string;
}

async function startHarnessServer(): Promise<HarnessServer> {
	const outDir = await mkdtemp(resolve(tmpdir(), 'spektral-runtime-perf-'));
	try {
		await build({
			configFile: E2E_CONFIG_PATH,
			logLevel: process.env['SPEKTRAL_PERF_VERBOSE'] === '1' ? 'info' : 'warn',
			build: { outDir, emptyOutDir: true }
		});
		const server = await preview({
			configFile: E2E_CONFIG_PATH,
			logLevel: process.env['SPEKTRAL_PERF_VERBOSE'] === '1' ? 'info' : 'warn',
			build: { outDir },
			preview: { host: '127.0.0.1', port: 0, strictPort: false }
		});
		const address = server.httpServer.address();
		if (!address || typeof address === 'string') {
			await server.close();
			throw new Error('Unable to resolve runtime benchmark preview server address');
		}
		const url = `http://127.0.0.1:${address.port}`;
		await waitForServer(url);
		return { server, outDir, url };
	} catch (error) {
		await rm(outDir, { recursive: true, force: true });
		throw error;
	}
}

async function stopHarnessServer(harness: HarnessServer): Promise<void> {
	await harness.server.close();
	await rm(harness.outDir, { recursive: true, force: true });
}

async function waitForTestIdText(
	page: Page,
	testId: string,
	expected: string,
	timeoutMs = 10_000
): Promise<void> {
	await page.waitForFunction(
		([id, expectedValue]) => {
			const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
			return element?.textContent?.trim() === expectedValue;
		},
		[testId, expected],
		{ timeout: timeoutMs }
	);
}

async function setMode(page: Page, mode: 'always' | 'on-demand' | 'manual'): Promise<void> {
	await page.evaluate((nextMode) => {
		const perfWindow = window as PerfWindow;
		perfWindow.__SPEKTRAL_PERF__?.setMode(nextMode);
	}, mode);
	await waitForTestIdText(page, 'render-mode', mode);
}

async function sampleMode(page: Page, durationMs: number): Promise<ModeSample> {
	return page.evaluate(async (duration) => {
		const startSchedulerElement = document.querySelector<HTMLElement>(
			'[data-testid="scheduler-count"]'
		);
		const startRenderElement = document.querySelector<HTMLElement>('[data-testid="render-count"]');
		if (!startSchedulerElement || !startRenderElement) {
			throw new Error('Missing scheduler/render counters');
		}

		const startScheduler = Number(startSchedulerElement.textContent ?? '');
		const startRender = Number(startRenderElement.textContent ?? '');
		if (!Number.isFinite(startScheduler) || !Number.isFinite(startRender)) {
			throw new Error('Expected numeric scheduler/render counters');
		}

		const startedAt = performance.now();

		await new Promise<void>((resolveSample) => {
			setTimeout(resolveSample, duration);
		});

		const endedAt = performance.now();
		const endSchedulerElement = document.querySelector<HTMLElement>(
			'[data-testid="scheduler-count"]'
		);
		const endRenderElement = document.querySelector<HTMLElement>('[data-testid="render-count"]');
		if (!endSchedulerElement || !endRenderElement) {
			throw new Error('Missing scheduler/render counters');
		}

		const endScheduler = Number(endSchedulerElement.textContent ?? '');
		const endRender = Number(endRenderElement.textContent ?? '');
		if (!Number.isFinite(endScheduler) || !Number.isFinite(endRender)) {
			throw new Error('Expected numeric scheduler/render counters');
		}
		const elapsedSec = Math.max(0.001, (endedAt - startedAt) / 1000);
		const schedulerDelta = endScheduler - startScheduler;
		const renderDelta = endRender - startRender;

		return {
			elapsedSec,
			schedulerDelta,
			renderDelta,
			schedulerHz: schedulerDelta / elapsedSec,
			renderHz: renderDelta / elapsedSec
		};
	}, durationMs);
}

async function sampleManualAdvance(page: Page): Promise<ModeSample & { pulses: number }> {
	return page.evaluate(
		async ({ durationMs, intervalMs }) => {
			const perfWindow = window as PerfWindow;
			const api = perfWindow.__SPEKTRAL_PERF__;
			if (!api) {
				throw new Error('window.__SPEKTRAL_PERF__ is not available');
			}

			const startSchedulerElement = document.querySelector<HTMLElement>(
				'[data-testid="scheduler-count"]'
			);
			const startRenderElement = document.querySelector<HTMLElement>(
				'[data-testid="render-count"]'
			);
			if (!startSchedulerElement || !startRenderElement) {
				throw new Error('Missing scheduler/render counters');
			}

			const startScheduler = Number(startSchedulerElement.textContent ?? '');
			const startRender = Number(startRenderElement.textContent ?? '');
			if (!Number.isFinite(startScheduler) || !Number.isFinite(startRender)) {
				throw new Error('Expected numeric scheduler/render counters');
			}
			const startedAt = performance.now();
			let pulses = 0;

			while (performance.now() - startedAt < durationMs) {
				api.advance();
				pulses += 1;
				await new Promise<void>((resolvePulse) => {
					setTimeout(resolvePulse, intervalMs);
				});
			}

			const endedAt = performance.now();
			const endSchedulerElement = document.querySelector<HTMLElement>(
				'[data-testid="scheduler-count"]'
			);
			const endRenderElement = document.querySelector<HTMLElement>('[data-testid="render-count"]');
			if (!endSchedulerElement || !endRenderElement) {
				throw new Error('Missing scheduler/render counters');
			}

			const endScheduler = Number(endSchedulerElement.textContent ?? '');
			const endRender = Number(endRenderElement.textContent ?? '');
			if (!Number.isFinite(endScheduler) || !Number.isFinite(endRender)) {
				throw new Error('Expected numeric scheduler/render counters');
			}
			const elapsedSec = Math.max(0.001, (endedAt - startedAt) / 1000);
			const schedulerDelta = endScheduler - startScheduler;
			const renderDelta = endRender - startRender;

			return {
				elapsedSec,
				schedulerDelta,
				renderDelta,
				schedulerHz: schedulerDelta / elapsedSec,
				renderHz: renderDelta / elapsedSec,
				pulses
			};
		},
		{
			durationMs: MANUAL_ADVANCE_DURATION_MS,
			intervalMs: MANUAL_ADVANCE_INTERVAL_MS
		}
	);
}

async function sampleManualAdvanceLatency(page: Page, sampleCount: number): Promise<LatencySample> {
	return page.evaluate(async (count) => {
		const perfWindow = window as PerfWindow;
		const api = perfWindow.__SPEKTRAL_PERF__;
		const renderElement = document.querySelector<HTMLElement>('[data-testid="render-count"]');
		if (!api || !renderElement) {
			throw new Error('Missing perf controls or render counter');
		}

		const samplesMs: number[] = [];
		for (let index = 0; index < count; index += 1) {
			const renderCountBefore = Number(renderElement.textContent ?? '');
			if (!Number.isFinite(renderCountBefore)) {
				throw new Error('Expected numeric render counter');
			}

			const startedAt = performance.now();
			await new Promise<void>((resolveRender, rejectRender) => {
				const observer = new MutationObserver(() => {
					const current = Number(renderElement.textContent ?? '');
					if (current > renderCountBefore) {
						observer.disconnect();
						window.clearTimeout(timeoutId);
						resolveRender();
					}
				});
				const timeoutId = window.setTimeout(() => {
					observer.disconnect();
					rejectRender(new Error('Timed out waiting for a manual frame'));
				}, 1_000);
				observer.observe(renderElement, { childList: true, characterData: true, subtree: true });
				api.advance();
			});
			samplesMs.push(performance.now() - startedAt);
		}

		const sorted = [...samplesMs].sort((a, b) => a - b);
		const p50Index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.5));
		const p95Index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95));
		return {
			samplesMs,
			meanMs: samplesMs.reduce((sum, value) => sum + value, 0) / Math.max(1, samplesMs.length),
			p50Ms: sorted[p50Index] ?? 0,
			p95Ms: sorted[p95Index] ?? 0,
			maxMs: sorted[sorted.length - 1] ?? 0
		};
	}, sampleCount);
}

function formatNumber(value: number): string {
	return value.toFixed(2);
}

function sampleComputeStorageBindGroupCreations(frames: number): {
	frames: number;
	bindGroupLayoutCreations: number;
	bindGroupCreations: number;
	creationsPer1000Frames: number;
} {
	let bindGroupLayoutCreations = 0;
	let bindGroupCreations = 0;

	const device = {
		createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
			void descriptor;
			bindGroupLayoutCreations += 1;
			return {} as GPUBindGroupLayout;
		},
		createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
			void descriptor;
			bindGroupCreations += 1;
			return {} as GPUBindGroup;
		}
	} as GPUDevice;

	const storageBufferCache = createComputeBindGroupCache(device);
	const storageTextureCache = createComputeBindGroupCache(device);

	const storageBuffer = {} as GPUBuffer;
	const storageTextureView = {} as GPUTextureView;
	const bufferLayoutEntries: GPUBindGroupLayoutEntry[] = [
		{
			binding: 0,
			visibility: 0x20,
			buffer: { type: 'storage' }
		}
	];
	const textureLayoutEntries: GPUBindGroupLayoutEntry[] = [
		{
			binding: 0,
			visibility: 0x20,
			storageTexture: {
				access: 'write-only',
				format: 'rgba8unorm',
				viewDimension: '2d'
			}
		}
	];
	const bufferLayout = device.createBindGroupLayout({ entries: bufferLayoutEntries });
	const textureLayout = device.createBindGroupLayout({ entries: textureLayoutEntries });

	for (let frame = 0; frame < frames; frame += 1) {
		storageBufferCache.getOrCreate({
			topologyKey: 'data:read-write',
			layout: bufferLayout,
			entries: [{ binding: 0, resource: { buffer: storageBuffer } }],
			resourceRefs: [storageBuffer]
		});
		storageTextureCache.getOrCreate({
			topologyKey: 'computeOutput:rgba8unorm',
			layout: textureLayout,
			entries: [{ binding: 0, resource: storageTextureView }],
			resourceRefs: [storageTextureView]
		});
	}

	const creationsPer1000Frames =
		((bindGroupLayoutCreations + bindGroupCreations) / Math.max(1, frames)) * 1_000;

	return {
		frames,
		bindGroupLayoutCreations,
		bindGroupCreations,
		creationsPer1000Frames
	};
}

async function maybeReadBaseline(): Promise<RuntimeBaselineDocument | null> {
	try {
		const raw = await readFile(BASELINE_PATH, 'utf8');
		return JSON.parse(raw) as RuntimeBaselineDocument;
	} catch (error) {
		const candidate = error as NodeJS.ErrnoException;
		if (candidate.code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function waitForRuntimeReady(page: Page): Promise<void> {
	await waitForTestIdText(page, 'scenario', 'perf');
	await waitForTestIdText(page, 'controls-ready', 'yes');
	await waitForTestIdText(page, 'gpu-status', 'ready');
	await waitForTestIdText(page, 'last-error', 'none');
	await page.waitForFunction(
		() => {
			const perfWindow = window as PerfWindow;
			return Boolean(perfWindow.__SPEKTRAL_PERF__);
		},
		null,
		{ timeout: 10_000 }
	);
	await page.waitForFunction(() => {
		const element = document.querySelector<HTMLElement>('[data-testid="render-count"]');
		return Number(element?.textContent ?? '0') > 0;
	});
}

async function measureStartup(page: Page, harnessUrl: string): Promise<number> {
	const startedAt = performance.now();
	await page.goto(`${harnessUrl}/?scenario=perf`);
	await waitForRuntimeReady(page);
	return performance.now() - startedAt;
}

async function readAdapterIdentity(page: Page): Promise<AdapterIdentity> {
	return page.evaluate(async () => {
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			throw new Error('Unable to acquire WebGPU adapter for runtime fingerprint');
		}
		const info = adapter.info as GPUAdapterInfo & {
			backend?: string;
			type?: string;
			driver?: string;
		};
		const isFallbackAdapter = info.isFallbackAdapter ?? false;
		return {
			vendor: info.vendor ?? '',
			architecture: info.architecture ?? '',
			device: info.device ?? '',
			description: info.description ?? '',
			backend: info.backend ?? '',
			type: info.type ?? '',
			driver: info.driver ?? '',
			isFallbackAdapter
		};
	});
}

async function runRuntimeBenchmark(harnessUrl: string): Promise<RuntimeBenchmarkDocument> {
	const browser = await chromium.launch({
		headless: true,
		args: [...BROWSER_LAUNCH_ARGS]
	});

	try {
		const viewport = { width: 1280, height: 720 };
		const coldStartupSamples: number[] = [];
		for (let index = 0; index < STARTUP_CONTEXT_SAMPLES; index += 1) {
			const coldContext = await browser.newContext({ viewport });
			try {
				coldStartupSamples.push(await measureStartup(await coldContext.newPage(), harnessUrl));
			} finally {
				await coldContext.close();
			}
		}

		const context = await browser.newContext({ viewport });
		const page = await context.newPage();
		const warmStartupSamples: number[] = [];
		for (let index = 0; index < STARTUP_CONTEXT_SAMPLES; index += 1) {
			warmStartupSamples.push(await measureStartup(page, harnessUrl));
		}
		const coldStartupStats = computeRobustStats(coldStartupSamples);
		const warmStartupStats = computeRobustStats(warmStartupSamples);

		await setMode(page, 'always');
		await page.waitForTimeout(IDLE_SETTLE_MS);
		const alwaysSample = await sampleMode(page, MODE_SAMPLE_MS);

		await setMode(page, 'on-demand');
		await page.waitForTimeout(IDLE_SETTLE_MS);
		const onDemandIdleSample = await sampleMode(page, MODE_SAMPLE_MS);

		await setMode(page, 'manual');
		await page.waitForTimeout(IDLE_SETTLE_MS);
		const manualIdleSample = await sampleMode(page, MODE_SAMPLE_MS);
		const manualAdvanceSample = await sampleManualAdvance(page);
		const manualAdvanceLatencySample = await sampleManualAdvanceLatency(
			page,
			MANUAL_ADVANCE_LATENCY_SAMPLES
		);
		const computeStorageSample = sampleComputeStorageBindGroupCreations(
			COMPUTE_STORAGE_SAMPLE_FRAMES
		);
		const adapter = await readAdapterIdentity(page);
		const environment = await collectBenchmarkEnvironment({
			repositoryRoot: REPOSITORY_ROOT,
			suiteFiles: [
				import.meta.filename,
				resolve(SCRIPT_DIR, 'benchmark-schema.ts'),
				resolve(SCRIPT_DIR, 'statistics.ts'),
				E2E_CONFIG_PATH,
				PERF_SCENARIO_PATH,
				resolve(PACKAGE_ROOT, 'e2e/harness/RuntimeProbe.svelte'),
				resolve(PACKAGE_ROOT, 'e2e/observe-animation-frames.ts')
			],
			overrides: {
				browser: {
					channel: 'playwright-chromium',
					version: browser.version(),
					engine: 'Chromium'
				},
				adapter
			}
		});

		const metrics: MetricMap = {
			startup_cold_first_frame_median_ms: coldStartupStats.median,
			startup_warm_first_frame_median_ms: warmStartupStats.median,
			manual_advance_latency_p95_ms: manualAdvanceLatencySample.p95Ms,
			compute_storage_bindgroup_creations_per_1000_frames:
				computeStorageSample.creationsPer1000Frames
		};

		return {
			schemaVersion: BENCHMARK_SCHEMA_VERSION,
			generatedAt: new Date().toISOString(),
			environment,
			config: {
				serverMode: 'production-build-preview',
				startupContextSamples: STARTUP_CONTEXT_SAMPLES,
				modeSampleMs: MODE_SAMPLE_MS,
				idleSettleMs: IDLE_SETTLE_MS,
				manualAdvanceDurationMs: MANUAL_ADVANCE_DURATION_MS,
				manualAdvanceIntervalMs: MANUAL_ADVANCE_INTERVAL_MS,
				manualAdvanceLatencySamples: MANUAL_ADVANCE_LATENCY_SAMPLES,
				computeStorageSampleFrames: COMPUTE_STORAGE_SAMPLE_FRAMES,
				computeStorageMeasurement: 'synthetic-cache-helper',
				schedulerMeasurement: 'delivered-page-raf-callbacks'
			},
			metrics,
			invariants: {
				onDemandIdleExactZero:
					onDemandIdleSample.schedulerDelta === 0 && onDemandIdleSample.renderDelta === 0,
				manualIdleExactZero:
					manualIdleSample.schedulerDelta === 0 && manualIdleSample.renderDelta === 0,
				manualAdvanceOneSchedulerPerPulse:
					manualAdvanceSample.schedulerDelta === manualAdvanceSample.pulses,
				manualAdvanceOneRenderPerPulse:
					manualAdvanceSample.renderDelta === manualAdvanceSample.pulses
			},
			samples: {
				startup: {
					cold: coldStartupStats,
					warm: warmStartupStats
				},
				always: alwaysSample,
				onDemandIdle: onDemandIdleSample,
				manualIdle: manualIdleSample,
				manualAdvance: manualAdvanceSample,
				manualAdvanceLatency: manualAdvanceLatencySample,
				computeStorage: computeStorageSample
			}
		};
	} finally {
		await browser.close();
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const server = await startHarnessServer();

	try {
		const result = await runRuntimeBenchmark(server.url);
		await writeJsonFile(LATEST_PATH, result);

		console.log(`Runtime benchmark saved: ${LATEST_PATH}`);
		for (const metricName of Object.keys(METRIC_RULES) as MetricKey[]) {
			console.log(`${metricName}: ${formatNumber(result.metrics[metricName])}`);
		}
		const failedInvariants = Object.entries(result.invariants).filter(([, passed]) => !passed);
		for (const [name, passed] of Object.entries(result.invariants)) {
			console.log(`invariant.${name}: ${passed ? 'ok' : 'FAILED'}`);
		}

		if (args.updateBaseline) {
			if (failedInvariants.length > 0) {
				throw new Error(
					`Refusing to update a performance baseline with failing invariants: ${failedInvariants
						.map(([name]) => name)
						.join(', ')}`
				);
			}
			if (result.environment.dirty) {
				throw new Error('Refusing to update a performance baseline from a dirty worktree');
			}
			if (result.environment.powerMode !== 'ac-high-power') {
				throw new Error(
					`Refusing to update a performance baseline with powerMode=${result.environment.powerMode}; set SPEKTRAL_PERF_POWER_MODE=ac-high-power after controlling the host`
				);
			}
			const baselinePayload: RuntimeBaselineDocument = {
				schemaVersion: BENCHMARK_SCHEMA_VERSION,
				updatedAt: new Date().toISOString(),
				environment: result.environment,
				config: result.config,
				metrics: result.metrics
			};
			await writeJsonFile(BASELINE_PATH, baselinePayload);
			console.log(`Baseline updated: ${BASELINE_PATH}`);
			return;
		}
		if (failedInvariants.length > 0) {
			console.error(`Detected ${failedInvariants.length} runtime semantic invariant failure(s).`);
			if (args.strict) {
				process.exitCode = 1;
			}
		}

		const baseline = await maybeReadBaseline();
		if (!baseline) {
			console.log(`Baseline not found: ${BASELINE_PATH}`);
			console.log('Run with --update-baseline to capture the first reference.');
			return;
		}
		if (baseline.schemaVersion !== BENCHMARK_SCHEMA_VERSION) {
			console.error(
				`Incompatible baseline schema: current=${BENCHMARK_SCHEMA_VERSION} baseline=${String(baseline.schemaVersion)}. Preserve the old baseline before capturing schema v3.`
			);
			if (args.strict) {
				process.exitCode = 1;
			}
			return;
		}
		const compatibility = compareBenchmarkEnvironments(result.environment, baseline.environment);
		const configDifferences = Object.keys(result.config)
			.filter(
				(key) =>
					JSON.stringify(result.config[key as keyof typeof result.config]) !==
					JSON.stringify(baseline.config[key as keyof typeof baseline.config])
			)
			.map(
				(key) =>
					`config.${key}: current=${JSON.stringify(result.config[key as keyof typeof result.config])} baseline=${JSON.stringify(baseline.config[key as keyof typeof baseline.config])}`
			);
		const incompatibilities = [...compatibility.differences, ...configDifferences];
		if (incompatibilities.length > 0) {
			console.error('Incompatible baseline environment/configuration:');
			for (const difference of incompatibilities) {
				console.error(`- ${difference}`);
			}
			if (args.strict) {
				process.exitCode = 1;
			}
			return;
		}

		const { rows, regressions } = compareBenchmarkMetrics(
			result.metrics,
			baseline.metrics,
			METRIC_RULES
		);
		console.log('Comparison to baseline:');
		for (const row of rows) {
			if (row.baseline === null || row.deltaPct === null) {
				console.log(
					`${row.metric}: current=${formatNumber(row.current)} baseline=missing delta=n/a NEW_METRIC`
				);
				continue;
			}
			const sign = row.deltaPct >= 0 ? '+' : '';
			const state = row.regression ? 'REGRESSION' : 'ok';
			console.log(
				`${row.metric}: current=${formatNumber(row.current)} baseline=${formatNumber(row.baseline)} delta=${sign}${row.deltaPct.toFixed(2)}% threshold=${row.rule.maxRegressionPct}% (${row.rule.direction}) ${state}`
			);
		}

		if (regressions.length > 0) {
			console.error(`Detected ${regressions.length} regression(s).`);
			if (args.strict) {
				process.exitCode = 1;
			}
		}
	} finally {
		await stopHarnessServer(server);
	}
}

void main();
