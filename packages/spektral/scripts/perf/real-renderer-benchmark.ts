import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build, preview, type PreviewServer } from 'vite';
import {
	BENCHMARK_SCHEMA_VERSION,
	collectBenchmarkEnvironment,
	compareHardwareBenchmarkEnvironments,
	hardwareBenchmarkIdentity,
	type AdapterIdentity,
	type BenchmarkEnvironment
} from './benchmark-schema';
import { compareBenchmarkMetrics } from './benchmark-regression';
import type { RealRendererBrowserResult, ScenarioResult } from './browser/real-renderer-benchmark';
import {
	aggregateScenarios,
	compareScenarioContracts,
	extractRealRendererMetrics,
	realRendererMetricRules,
	type AggregatedScenario
} from './real-renderer-results';

const SCRIPT_DIR = import.meta.dirname;
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '../..');
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, '../..');
const BROWSER_ROOT = resolve(SCRIPT_DIR, 'browser');
const ENTRY_PATH = resolve(BROWSER_ROOT, 'real-renderer-benchmark.ts');
const HTML_PATH = resolve(BROWSER_ROOT, 'real-renderer.html');
const LATEST_PATH = resolve(PACKAGE_ROOT, 'benchmarks/results/real-renderer-latest.json');
const BASELINE_DIRECTORY = resolve(PACKAGE_ROOT, 'benchmarks/baselines');
const SUITE_VERSION = 2;
const MINIMUM_GATE_RUNS = 5;

const HARDWARE_LAUNCH_ARGS = [
	'--enable-unsafe-webgpu',
	'--enable-webgpu-developer-features',
	'--enable-dawn-features=allow_unsafe_apis',
	'--disable-dawn-features=timestamp_quantization',
	'--use-gpu-in-tests',
	'--use-webgpu-power-preference=default-high-performance',
	'--disable-background-timer-throttling',
	'--disable-renderer-backgrounding'
];

interface Args {
	channel: string;
	headed: boolean;
	runs: number;
	updateBaseline: boolean;
	strict: boolean;
}

interface RealRendererDocument {
	schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
	generatedAt: string;
	fingerprint: string;
	environment: BenchmarkEnvironment;
	config: RealRendererBrowserResult['config'] & {
		suiteVersion: number;
		browserRuns: number;
		hardwareOnly: true;
		timestampQueries: true;
		correctnessSink: 'canvas-checksum-rgb-range-and-compute-sentinel';
	};
	features: string[];
	scenarios: AggregatedScenario[];
	runs: Array<{
		index: number;
		config: RealRendererBrowserResult['config'];
		features: string[];
		scenarios: ScenarioResult[];
	}>;
}

function parseArgs(argv: string[]): Args {
	const flags = new Set(argv);
	const channelFlag = argv.find((value) => value.startsWith('--channel='));
	const runsFlag = argv.find((value) => value.startsWith('--runs='));
	const runs = Number(runsFlag?.slice('--runs='.length) ?? 5);
	if (!Number.isInteger(runs) || runs < 1) {
		throw new Error(`--runs must be a positive integer, received ${String(runs)}`);
	}
	return {
		channel:
			channelFlag?.slice('--channel='.length) ||
			process.env['SPEKTRAL_PERF_BROWSER_CHANNEL'] ||
			'chromium',
		headed: flags.has('--headed'),
		runs,
		updateBaseline: flags.has('--update-baseline'),
		strict: flags.has('--strict')
	};
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-|-$/gu, '')
		.slice(0, 48);
}

function fingerprint(environment: BenchmarkEnvironment): string {
	const identity = {
		suiteVersion: SUITE_VERSION,
		...hardwareBenchmarkIdentity(environment)
	};
	return createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16);
}

async function startServer(): Promise<{ server: PreviewServer; url: string; outDir: string }> {
	const outDir = await mkdtemp(resolve(tmpdir(), 'spektral-real-renderer-'));
	let server: PreviewServer | null = null;
	try {
		await build({
			configFile: false,
			root: BROWSER_ROOT,
			logLevel: process.env['SPEKTRAL_PERF_VERBOSE'] === '1' ? 'info' : 'warn',
			build: {
				outDir,
				emptyOutDir: true,
				modulePreload: false,
				rollupOptions: { input: HTML_PATH }
			}
		});
		server = await preview({
			configFile: false,
			root: BROWSER_ROOT,
			build: { outDir },
			preview: {
				host: '127.0.0.1',
				port: 0,
				strictPort: false,
				headers: {
					'Cross-Origin-Embedder-Policy': 'require-corp',
					'Cross-Origin-Opener-Policy': 'same-origin'
				}
			},
			logLevel: process.env['SPEKTRAL_PERF_VERBOSE'] === '1' ? 'info' : 'warn'
		});
		const address = server.httpServer.address();
		if (!address || typeof address === 'string') {
			throw new Error('Unable to resolve real-renderer preview address');
		}
		return { server, url: `http://127.0.0.1:${address.port}/real-renderer.html`, outDir };
	} catch (error) {
		await server?.close();
		await rm(outDir, { recursive: true, force: true });
		throw error;
	}
}

async function runBrowser(page: Page): Promise<RealRendererBrowserResult> {
	return page.evaluate(async () => {
		const runner = window.__SPEKTRAL_REAL_RENDERER_BENCHMARK__;
		if (!runner) {
			throw new Error('Real-renderer benchmark runner was not installed');
		}
		return runner();
	});
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return false;
		}
		throw error;
	}
}

async function readBaseline(path: string): Promise<RealRendererDocument | null> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as RealRendererDocument;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

function baselinePath(result: RealRendererDocument): string {
	const adapterSlug = slugify(result.environment.adapter?.description ?? '') || 'gpu';
	return resolve(BASELINE_DIRECTORY, `${adapterSlug}-real-renderer-${result.fingerprint}.json`);
}

function formatMetric(metric: string, value: number): string {
	return metric.endsWith('_ns') ? `${(value / 1_000_000).toFixed(4)} ms` : `${value.toFixed(3)} ms`;
}

async function run(args: Args): Promise<RealRendererDocument> {
	const { server, url, outDir } = await startServer();
	try {
		const browserResults: RealRendererBrowserResult[] = [];
		let browserVersion = '';
		for (let index = 0; index < args.runs; index += 1) {
			let browser: Browser | null = null;
			try {
				browser = await chromium.launch({
					channel: args.channel,
					headless: !args.headed,
					args: HARDWARE_LAUNCH_ARGS
				});
				browserVersion ||= browser.version();
				if (browser.version() !== browserVersion) {
					throw new Error(
						`Browser version changed within benchmark: ${browserVersion} -> ${browser.version()}`
					);
				}
				const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
				await page.goto(url);
				browserResults.push(await runBrowser(page));
			} finally {
				await browser?.close();
			}
		}
		const browserResult = browserResults[0];
		if (!browserResult) {
			throw new Error('Real-renderer benchmark completed no browser runs');
		}
		for (const result of browserResults.slice(1)) {
			if (
				JSON.stringify(result.adapter) !== JSON.stringify(browserResult.adapter) ||
				JSON.stringify(result.features) !== JSON.stringify(browserResult.features)
			) {
				throw new Error('GPU adapter identity or features changed between browser runs');
			}
		}
		const environment = await collectBenchmarkEnvironment({
			repositoryRoot: REPOSITORY_ROOT,
			suiteFiles: [
				import.meta.filename,
				ENTRY_PATH,
				HTML_PATH,
				resolve(SCRIPT_DIR, 'benchmark-schema.ts'),
				resolve(SCRIPT_DIR, 'benchmark-regression.ts'),
				resolve(SCRIPT_DIR, 'real-renderer-results.ts'),
				resolve(SCRIPT_DIR, 'statistics.ts')
			],
			overrides: {
				browser: { channel: args.channel, version: browserVersion, engine: 'Chromium' },
				adapter: browserResult.adapter satisfies AdapterIdentity
			}
		});
		return {
			schemaVersion: BENCHMARK_SCHEMA_VERSION,
			generatedAt: new Date().toISOString(),
			fingerprint: fingerprint(environment),
			environment,
			config: {
				suiteVersion: SUITE_VERSION,
				browserRuns: args.runs,
				hardwareOnly: true,
				timestampQueries: true,
				correctnessSink: 'canvas-checksum-rgb-range-and-compute-sentinel',
				...browserResult.config
			},
			features: browserResult.features,
			scenarios: aggregateScenarios(browserResults),
			runs: browserResults.map((result, index) => ({
				index,
				config: result.config,
				features: result.features,
				scenarios: result.scenarios
			}))
		};
	} finally {
		await server.close();
		await rm(outDir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const result = await run(args);
	await writeJson(LATEST_PATH, result);
	console.log(`Real-renderer benchmark saved: ${LATEST_PATH}`);
	console.log(
		`Adapter: ${result.environment.adapter?.description ?? 'unknown'}; fingerprint=${result.fingerprint}`
	);
	for (const scenario of result.scenarios) {
		console.log(
			`${scenario.name}: CPU submit run-p50=${scenario.cpuSubmitMs.runMedians.median.toFixed(3)}ms pooled-p95=${scenario.cpuSubmitMs.p95.toFixed(3)}ms; GPU completion span run-p50=${(scenario.gpuFrameNs.runMedians.median / 1_000_000).toFixed(3)}ms pooled-p95=${(scenario.gpuFrameNs.p95 / 1_000_000).toFixed(3)}ms pooled-p99=${(scenario.gpuFrameNs.p99 / 1_000_000).toFixed(3)}ms; queue completion run-p50=${scenario.queueCompletionMs.runMedians.median.toFixed(3)}ms; checksum=${scenario.correctness.after}; compute=${String(scenario.correctness.computeSentinelAfter)}`
		);
	}
	if (args.updateBaseline) {
		if (args.strict) {
			throw new Error('--strict and --update-baseline cannot be used together');
		}
		if (result.config.browserRuns < MINIMUM_GATE_RUNS) {
			throw new Error(
				`Refusing baseline creation with browserRuns=${result.config.browserRuns}; use at least ${MINIMUM_GATE_RUNS} independent browser sessions`
			);
		}
		if (result.environment.dirty) {
			throw new Error('Refusing to update a real-renderer baseline from a dirty worktree');
		}
		if (result.environment.powerMode !== 'ac-high-power') {
			throw new Error(
				`Refusing baseline update with powerMode=${result.environment.powerMode}; control the host and set SPEKTRAL_PERF_POWER_MODE=ac-high-power`
			);
		}
		const path = baselinePath(result);
		if (await pathExists(path)) {
			throw new Error(`Refusing to overwrite existing real-renderer baseline: ${path}`);
		}
		await writeJson(path, result);
		console.log(`Real-renderer baseline created: ${path}`);
		return;
	}

	if (args.strict && result.config.browserRuns < MINIMUM_GATE_RUNS) {
		throw new Error(
			`Strict real-renderer comparison requires at least ${MINIMUM_GATE_RUNS} fresh browser processes; received ${result.config.browserRuns}`
		);
	}
	const path = baselinePath(result);
	const baseline = await readBaseline(path);
	if (!baseline) {
		console.error(
			`No compatible real-renderer baseline for the current hardware environment: ${path}`
		);
		console.error(
			`Current hardware identity: ${JSON.stringify(hardwareBenchmarkIdentity(result.environment))}`
		);
		if (args.strict) process.exitCode = 1;
		return;
	}
	if (baseline.schemaVersion !== BENCHMARK_SCHEMA_VERSION) {
		console.error(
			`Real-renderer baseline schema mismatch: current=${BENCHMARK_SCHEMA_VERSION}, baseline=${String(baseline.schemaVersion)}`
		);
		if (args.strict) process.exitCode = 1;
		return;
	}
	if (baseline.config.browserRuns < MINIMUM_GATE_RUNS) {
		console.error(
			`Real-renderer baseline is not gate-compatible: browserRuns=${baseline.config.browserRuns}, required>=${MINIMUM_GATE_RUNS}`
		);
		if (args.strict) process.exitCode = 1;
		return;
	}
	const environmentComparison = compareHardwareBenchmarkEnvironments(
		result.environment,
		baseline.environment
	);
	if (!environmentComparison.compatible) {
		console.error('Real-renderer baseline environment mismatch:');
		for (const difference of environmentComparison.differences) {
			console.error(`- ${difference}`);
		}
		if (args.strict) process.exitCode = 1;
		return;
	}
	if (baseline.fingerprint !== result.fingerprint) {
		console.error(
			`Real-renderer baseline fingerprint mismatch: current=${result.fingerprint}, baseline=${baseline.fingerprint}`
		);
		if (args.strict) process.exitCode = 1;
		return;
	}
	const contractDifferences = compareScenarioContracts(result.scenarios, baseline.scenarios);
	if (contractDifferences.length > 0) {
		console.error('Real-renderer scenario contract mismatch:');
		for (const difference of contractDifferences) console.error(`- ${difference}`);
		if (args.strict) process.exitCode = 1;
		return;
	}
	const currentMetrics = extractRealRendererMetrics(result.scenarios);
	const baselineMetrics = extractRealRendererMetrics(baseline.scenarios);
	const rules = realRendererMetricRules(result.scenarios);
	const comparison = compareBenchmarkMetrics(currentMetrics, baselineMetrics, rules);
	const missingMetrics = comparison.rows.filter((row) => row.baseline === null);
	console.log('Comparison to real-renderer baseline:');
	for (const row of comparison.rows) {
		if (row.baseline === null || row.deltaPct === null) {
			console.log(
				`${row.metric}: current=${formatMetric(row.metric, row.current)} baseline=missing`
			);
			continue;
		}
		const sign = row.deltaPct >= 0 ? '+' : '';
		console.log(
			`${row.metric}: current=${formatMetric(row.metric, row.current)} baseline=${formatMetric(row.metric, row.baseline)} delta=${sign}${row.deltaPct.toFixed(2)}% thresholds=${row.rule.maxRegressionPct}%+${formatMetric(row.metric, row.rule.maxRegressionAbsolute ?? 0)} ${row.regression ? 'REGRESSION' : 'ok'}`
		);
	}
	if (comparison.regressions.length > 0) {
		console.error(`Detected ${comparison.regressions.length} real-renderer regression(s).`);
		if (args.strict) process.exitCode = 1;
	}
	if (missingMetrics.length > 0 && args.strict) {
		console.error(`Baseline is missing ${missingMetrics.length} required real-renderer metric(s).`);
		process.exitCode = 1;
	}
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
