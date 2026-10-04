import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export const BUNDLE_BUDGET_SCHEMA_VERSION = 1;
export const MAX_RELATIVE_GROWTH = 0.075;
export const MAX_ABSOLUTE_GROWTH_BYTES = 1024;

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const repositoryRoot = path.resolve(packageRoot, '../..');
const baselinePath = path.join(packageRoot, 'benchmarks/baselines/bundle-budgets.json');
const packageManifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const workerEntry = path.join(
	repositoryRoot,
	'apps/web/src/lib/playground-engine/workers/bundler/index.ts'
);
const entrypointProbes = Object.freeze({
	'.': 'createFrameRegistry',
	'./advanced': 'captureSchedulerDebugSnapshot',
	'./core': 'defineMaterial',
	'./core/advanced': 'applySchedulerPreset',
	'./react': 'FragCanvas',
	'./react/advanced': 'useSpektralUserContext',
	'./svelte': 'FragCanvas',
	'./svelte/advanced': 'useSpektralUserContext',
	'./vue': 'FragCanvas',
	'./vue/advanced': 'useSpektralUserContext'
});
export const BUDGET_ENTRYPOINTS = Object.freeze(Object.keys(entrypointProbes));
const neutralEntrypoints = new Set(['.', './advanced', './core', './core/advanced']);

function packageSpecifier(entrypoint) {
	return entrypoint === '.' ? 'spektral' : `spektral/${entrypoint.slice(2)}`;
}

function normalizePath(file) {
	return file.split(path.sep).join('/');
}

function metricFromBuffers(buffers) {
	const combined = Buffer.concat(buffers);
	return Object.freeze({
		minifiedBytes: combined.byteLength,
		gzipBytes: gzipSync(combined, { level: 9 }).byteLength
	});
}

function collectOutput(result) {
	const outputs = Array.isArray(result) ? result : [result];
	return outputs.flatMap(({ output }) => output);
}

function packageResolverPlugin(specifier, target) {
	const virtualEntry = `virtual:spektral-budget:${specifier}`;
	const resolvedVirtualEntry = `\0${virtualEntry}`;
	return {
		name: 'spektral-budget-resolver',
		resolveId(id) {
			if (id === virtualEntry) return resolvedVirtualEntry;
			if (id === specifier) return target;
			return null;
		},
		load(id) {
			if (id !== resolvedVirtualEntry) return null;
			const probe =
				entrypointProbes[
					Object.keys(entrypointProbes).find(
						(entrypoint) => packageSpecifier(entrypoint) === specifier
					)
				];
			return `import { ${probe} as measured } from ${JSON.stringify(specifier)}; globalThis.__spektralBundleBudget = measured;`;
		}
	};
}

function externalFramework(id) {
	return (
		id === 'react' ||
		id.startsWith('react/') ||
		id === 'react-dom' ||
		id.startsWith('react-dom/') ||
		id === 'svelte' ||
		id.startsWith('svelte/') ||
		id === 'vue' ||
		id.startsWith('vue/')
	);
}

export function assertFrameworkIsolation(entrypoint, moduleIds, bundleCode = '') {
	const normalizedIds = moduleIds.map(normalizePath);
	const adapter = entrypoint.match(/^\.\/(react|svelte|vue)(?:\/|$)/)?.[1];
	if (!adapter) {
		const leakedAdapter = normalizedIds.find((id) => /\/dist\/(?:react|svelte|vue)\//.test(id));
		assert.equal(
			leakedAdapter,
			undefined,
			`${entrypoint} core bundle pulled an adapter through ${leakedAdapter}.`
		);
		for (const framework of ['react', 'react-dom', 'svelte', 'vue']) {
			assert.doesNotMatch(
				bundleCode,
				new RegExp(`(?:from\\s*|import\\s*(?:\\(|))['"]${framework}(?:/[^'"]*)?['"]`),
				`${entrypoint} core bundle imports the ${framework} runtime.`
			);
		}
		return;
	}
	const forbiddenAdapters = ['react', 'svelte', 'vue'].filter((candidate) => candidate !== adapter);
	for (const forbiddenAdapter of forbiddenAdapters) {
		const leakedModule = normalizedIds.find((id) => id.includes(`/dist/${forbiddenAdapter}/`));
		assert.equal(
			leakedModule,
			undefined,
			`${entrypoint} pulled the ${forbiddenAdapter} adapter through ${leakedModule}.`
		);
		const forbiddenRuntimes =
			forbiddenAdapter === 'react' ? ['react', 'react-dom'] : [forbiddenAdapter];
		for (const forbiddenRuntime of forbiddenRuntimes) {
			assert.doesNotMatch(
				bundleCode,
				new RegExp(`(?:from\\s*|import\\s*(?:\\(|))['"]${forbiddenRuntime}(?:/[^'"]*)?['"]`),
				`${entrypoint} imports the ${forbiddenRuntime} runtime.`
			);
		}
	}
}

export function assertEntrypointCssIsolation(entrypoint, cssAssets) {
	if (neutralEntrypoints.has(entrypoint)) {
		assert.equal(
			cssAssets.length,
			0,
			`${entrypoint} neutral/core bundle emitted overlay CSS without an explicit adapter import.`
		);
	}
}

async function measureEntrypoint(entrypoint) {
	const specifier = packageSpecifier(entrypoint);
	const exportTarget = packageManifest.exports?.[entrypoint]?.default;
	assert.equal(typeof exportTarget, 'string', `${entrypoint} has no default JavaScript export.`);
	const target = path.resolve(packageRoot, exportTarget);
	await access(target);
	const virtualEntry = `virtual:spektral-budget:${specifier}`;
	const result = await build({
		configFile: false,
		logLevel: 'silent',
		plugins: [packageResolverPlugin(specifier, target), svelte()],
		build: {
			write: false,
			target: 'es2022',
			minify: 'esbuild',
			cssMinify: true,
			rollupOptions: {
				input: virtualEntry,
				external: externalFramework,
				output: {
					format: 'es',
					codeSplitting: false,
					entryFileNames: 'bundle.js',
					assetFileNames: '[name][extname]'
				}
			}
		}
	});
	const output = collectOutput(result);
	const chunks = output.filter((item) => item.type === 'chunk');
	assert.ok(chunks.length > 0, `${entrypoint} produced no JavaScript chunk.`);
	const moduleIds = [...new Set(chunks.flatMap((chunk) => Object.keys(chunk.modules)))];
	assertFrameworkIsolation(entrypoint, moduleIds, chunks.map((chunk) => chunk.code).join('\n'));
	const cssAssets = output.filter(
		(item) => item.type === 'asset' && item.fileName.endsWith('.css')
	);
	assertEntrypointCssIsolation(entrypoint, cssAssets);
	return {
		css: cssAssets.map((asset) =>
			Buffer.isBuffer(asset.source) || asset.source instanceof Uint8Array
				? Buffer.from(asset.source)
				: Buffer.from(asset.source)
		),
		metric: metricFromBuffers(
			chunks
				.sort((left, right) => left.fileName.localeCompare(right.fileName))
				.map((chunk) => Buffer.from(chunk.code))
		)
	};
}

async function measurePlaygroundWorker() {
	await access(workerEntry);
	const result = await build({
		configFile: false,
		root: repositoryRoot,
		logLevel: 'silent',
		resolve: { conditions: ['browser', 'worker', 'production'] },
		build: {
			write: false,
			target: 'es2022',
			minify: 'esbuild',
			rollupOptions: {
				input: workerEntry,
				output: {
					format: 'es',
					codeSplitting: false,
					entryFileNames: 'playground-worker.js'
				}
			}
		}
	});
	const chunks = collectOutput(result).filter((item) => item.type === 'chunk');
	assert.ok(chunks.length > 0, 'Playground worker produced no JavaScript chunk.');
	return metricFromBuffers(
		chunks
			.sort((left, right) => left.fileName.localeCompare(right.fileName))
			.map((chunk) => Buffer.from(chunk.code))
	);
}

export function isBudgetRegression(baselineBytes, currentBytes) {
	if (!Number.isSafeInteger(baselineBytes) || baselineBytes <= 0) {
		throw new Error(`Baseline bytes must be a positive safe integer; received ${baselineBytes}.`);
	}
	if (!Number.isSafeInteger(currentBytes) || currentBytes <= 0) {
		throw new Error(`Current bytes must be a positive safe integer; received ${currentBytes}.`);
	}
	return (
		currentBytes - baselineBytes > MAX_ABSOLUTE_GROWTH_BYTES &&
		(currentBytes - baselineBytes) / baselineBytes > MAX_RELATIVE_GROWTH
	);
}

export function assertBundleBudgets(baseline, current) {
	if (baseline?.schemaVersion !== BUNDLE_BUDGET_SCHEMA_VERSION) {
		throw new Error(`Bundle baseline schema must be ${BUNDLE_BUDGET_SCHEMA_VERSION}.`);
	}
	if (baseline.package !== 'spektral') {
		throw new Error('Bundle baseline package must be spektral.');
	}
	assert.deepEqual(
		Object.keys(baseline.entrypoints ?? {}).sort(),
		[...BUDGET_ENTRYPOINTS].sort(),
		'Bundle baseline must cover exactly the ten public entrypoints.'
	);
	assert.deepEqual(
		Object.keys(baseline.assets ?? {}).sort(),
		['css', 'playgroundWorker'],
		'Bundle baseline assets must contain exactly CSS and playgroundWorker.'
	);
	const regressions = [];
	for (const group of ['entrypoints', 'assets']) {
		const baselineGroup = baseline[group];
		const currentGroup = current[group];
		assert.deepEqual(
			Object.keys(currentGroup ?? {}).sort(),
			Object.keys(baselineGroup ?? {}).sort(),
			`${group} budget keys changed.`
		);
		for (const [name, baselineMetric] of Object.entries(baselineGroup)) {
			const currentMetric = currentGroup[name];
			const metricName = name === '.' ? 'root' : name.replace(/^\.\//, '');
			for (const field of ['minifiedBytes', 'gzipBytes']) {
				if (isBudgetRegression(baselineMetric[field], currentMetric[field])) {
					const delta = currentMetric[field] - baselineMetric[field];
					const percentage = (delta / baselineMetric[field]) * 100;
					regressions.push(
						`${group}.${metricName}.${field}: ${baselineMetric[field]} -> ${currentMetric[field]} (+${delta} B, +${percentage.toFixed(2)}%)`
					);
				}
			}
		}
	}
	if (regressions.length > 0) {
		throw new Error(`Bundle budgets regressed:\n${regressions.join('\n')}`);
	}
}

export async function measureBundleBudgets() {
	assert.deepEqual(
		Object.keys(packageManifest.exports).sort(),
		[...BUDGET_ENTRYPOINTS].sort(),
		'Bundle probes must cover exactly the ten public entrypoints.'
	);
	const entrypoints = {};
	let cssBuffers;
	for (const entrypoint of Object.keys(entrypointProbes)) {
		const result = await measureEntrypoint(entrypoint);
		entrypoints[entrypoint] = result.metric;
		if (entrypoint === './react') cssBuffers = result.css;
	}
	assert.ok(cssBuffers?.length > 0, 'React adapter budget probe emitted no Spektral CSS.');
	return {
		schemaVersion: BUNDLE_BUDGET_SCHEMA_VERSION,
		package: 'spektral',
		version: packageManifest.version,
		entrypoints,
		assets: {
			css: metricFromBuffers(cssBuffers),
			playgroundWorker: await measurePlaygroundWorker()
		}
	};
}

async function main() {
	const updateBaseline = process.argv.slice(2).includes('--update-baseline');
	const unexpectedArguments = process.argv
		.slice(2)
		.filter((argument) => argument !== '--update-baseline');
	if (unexpectedArguments.length > 0) {
		throw new Error(`Unknown bundle budget arguments: ${unexpectedArguments.join(', ')}.`);
	}
	const current = await measureBundleBudgets();
	if (updateBaseline) {
		await writeFile(baselinePath, `${JSON.stringify(current, null, '\t')}\n`);
		console.log(`Updated bundle baseline at ${baselinePath}.`);
		return;
	}
	let baseline;
	try {
		baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
	} catch (error) {
		if (error?.code === 'ENOENT') {
			throw new Error(
				`Bundle baseline is missing at ${baselinePath}; create it with --update-baseline after an approved build.`,
				{ cause: error }
			);
		}
		throw error;
	}
	assertBundleBudgets(baseline, current);
	console.log(JSON.stringify(current, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
