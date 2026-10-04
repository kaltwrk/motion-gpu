import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
	assertEntrypointCssIsolation,
	assertBundleBudgets,
	assertFrameworkIsolation,
	BUNDLE_BUDGET_SCHEMA_VERSION,
	BUDGET_ENTRYPOINTS,
	isBudgetRegression
} from './bundle-budgets.mjs';

function fixture(metric = { minifiedBytes: 10_000, gzipBytes: 5_000 }) {
	return {
		schemaVersion: BUNDLE_BUDGET_SCHEMA_VERSION,
		package: 'spektral',
		entrypoints: Object.fromEntries(
			BUDGET_ENTRYPOINTS.map((entrypoint) => [entrypoint, { ...metric }])
		),
		assets: { css: { ...metric }, playgroundWorker: { ...metric } }
	};
}

test('requires both more than 7.5 percent and more than one KiB growth', () => {
	assert.equal(isBudgetRegression(10_000, 11_024), false);
	assert.equal(isBudgetRegression(10_000, 11_025), true);
	assert.equal(isBudgetRegression(100_000, 102_000), false);
	assert.equal(isBudgetRegression(100_000, 106_000), false);
	assert.equal(isBudgetRegression(100_000, 107_500), false);
	assert.equal(isBudgetRegression(100_000, 107_501), true);
});

test('reports entrypoint and asset budget regressions with exact deltas', () => {
	const baseline = fixture();
	assert.doesNotThrow(() => assertBundleBudgets(baseline, fixture()));
	const current = fixture();
	current.entrypoints['.'].minifiedBytes = 12_000;
	current.assets.playgroundWorker.gzipBytes = 7_000;
	assert.throws(
		() => assertBundleBudgets(baseline, current),
		/entrypoints\.root\.minifiedBytes: 10000 -> 12000[\s\S]*assets\.playgroundWorker\.gzipBytes/
	);
});

test('requires an exact baseline schema and metric key set', () => {
	assert.throws(
		() => assertBundleBudgets({ ...fixture(), schemaVersion: 2 }, fixture()),
		/schema must be 1/
	);
	const current = fixture();
	delete current.entrypoints['./advanced'];
	assert.throws(() => assertBundleBudgets(fixture(), current), /budget keys changed/);
	assert.throws(
		() => assertBundleBudgets({ ...fixture(), package: 'other' }, fixture()),
		/package must be spektral/
	);
});

test('neutral and core entrypoints emit no implicit overlay CSS', () => {
	for (const entrypoint of ['.', './advanced', './core', './core/advanced']) {
		assert.doesNotThrow(() => assertEntrypointCssIsolation(entrypoint, []));
		assert.throws(
			() => assertEntrypointCssIsolation(entrypoint, [{ fileName: 'spektral.css' }]),
			/emitted overlay CSS/
		);
	}
	assert.doesNotThrow(() =>
		assertEntrypointCssIsolation('./react', [{ fileName: 'spektral.css' }])
	);
});

test('keeps neutral and adapter entrypoints isolated by framework', () => {
	assert.doesNotThrow(() =>
		assertFrameworkIsolation('.', [
			'/workspace/packages/spektral/dist/core/material.js',
			'/workspace/packages/spektral/dist/passes/ShaderPass.js'
		])
	);
	assert.doesNotThrow(() =>
		assertFrameworkIsolation('./react', [
			'/workspace/packages/spektral/dist/core/material.js',
			'/workspace/packages/spektral/dist/react/FragCanvas.js'
		])
	);
	assert.throws(
		() =>
			assertFrameworkIsolation('./react', [
				'/workspace/packages/spektral/dist/react/FragCanvas.js',
				'/workspace/packages/spektral/dist/vue/FragCanvas.js'
			]),
		/pulled the vue adapter/
	);
	assert.throws(
		() => assertFrameworkIsolation('./core', ['/workspace/packages/spektral/dist/svelte/index.js']),
		/core bundle pulled an adapter/
	);
	assert.throws(
		() =>
			assertFrameworkIsolation(
				'./vue',
				['/workspace/packages/spektral/dist/vue/FragCanvas.js'],
				'import{createElement}from"react";'
			),
		/imports the react runtime/
	);
});

test('uses the current Rolldown single-chunk option without deprecated warnings', async () => {
	const source = await readFile(new URL('./bundle-budgets.mjs', import.meta.url), 'utf8');
	assert.match(source, /codeSplitting:\s*false/);
	assert.doesNotMatch(source, /inlineDynamicImports/);
});
