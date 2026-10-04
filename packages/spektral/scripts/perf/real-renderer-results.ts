import type {
	RealRendererBrowserResult,
	ScenarioResult,
	Stats
} from './browser/real-renderer-benchmark';
import type { BenchmarkMetricRule } from './benchmark-regression';
import { computeRobustStats, quantile, type RobustStats } from './statistics';

export interface SteadyStateAllocations {
	frames: number;
	bindGroups: number;
	textureViews: number;
	pipelines: number;
}

export function assertSteadyStateAllocations(allocations: SteadyStateAllocations): void {
	if (!Number.isInteger(allocations.frames) || allocations.frames < 1)
		throw new Error('Missing allocation samples');
	if (
		allocations.bindGroups !== 0 ||
		allocations.textureViews !== 0 ||
		allocations.pipelines !== 0
	) {
		throw new Error(`Unexpected steady-state GPU allocations: ${JSON.stringify(allocations)}`);
	}
}

export interface AggregatedStats extends Stats {
	runMedians: RobustStats;
}

export interface AggregatedScenario extends Omit<
	ScenarioResult,
	'cpuSubmitMs' | 'queueCompletionMs' | 'gpuFrameNs'
> {
	cpuSubmitMs: AggregatedStats;
	queueCompletionMs: AggregatedStats;
	gpuFrameNs: AggregatedStats;
}

export interface RealRendererMetricRule extends BenchmarkMetricRule {
	maxRegressionAbsolute: number;
}

const CPU_SUBMIT_RULE: RealRendererMetricRule = {
	direction: 'lower',
	maxRegressionPct: 15,
	maxRegressionAbsolute: 0.05
};
const QUEUE_COMPLETION_RULE: RealRendererMetricRule = {
	direction: 'lower',
	maxRegressionPct: 20,
	maxRegressionAbsolute: 0.5
};
const GPU_FRAME_RULE: RealRendererMetricRule = {
	direction: 'lower',
	maxRegressionPct: 15,
	maxRegressionAbsolute: 100_000
};

export function summarizeSamples(samples: number[]): Stats {
	const sorted = [...samples].sort((a, b) => a - b);
	const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
	const variance = samples.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / samples.length;
	return {
		samples,
		median: quantile(sorted, 0.5),
		p95: quantile(sorted, 0.95),
		p99: quantile(sorted, 0.99),
		min: sorted[0] ?? 0,
		max: sorted.at(-1) ?? 0,
		coefficientOfVariationPct: mean === 0 ? 0 : (Math.sqrt(variance) / Math.abs(mean)) * 100
	};
}

export function aggregateStats(runs: Stats[]): AggregatedStats {
	return {
		...summarizeSamples(runs.flatMap((run) => run.samples)),
		runMedians: computeRobustStats(runs.map((run) => run.median))
	};
}

export function aggregateScenarios(results: RealRendererBrowserResult[]): AggregatedScenario[] {
	const first = results[0];
	if (!first) {
		throw new Error('At least one browser result is required');
	}
	return first.scenarios.map((scenario, scenarioIndex) => {
		const matches = results.map((result) => result.scenarios[scenarioIndex]);
		if (
			matches.some(
				(match) =>
					!match ||
					match.name !== scenario.name ||
					match.passCount !== scenario.passCount ||
					JSON.stringify(match.allocations) !== JSON.stringify(scenario.allocations) ||
					match.correctness.after !== scenario.correctness.after ||
					match.correctness.pixelCount !== scenario.correctness.pixelCount ||
					match.correctness.computeSentinelAfter !== scenario.correctness.computeSentinelAfter
			)
		) {
			throw new Error(
				`Browser runs disagreed on scenario contract or correctness: ${scenario.name}`
			);
		}
		const completeMatches = matches as ScenarioResult[];
		return {
			name: scenario.name,
			passCount: scenario.passCount,
			allocations: scenario.allocations,
			cpuSubmitMs: aggregateStats(completeMatches.map((match) => match.cpuSubmitMs)),
			queueCompletionMs: aggregateStats(completeMatches.map((match) => match.queueCompletionMs)),
			gpuFrameNs: aggregateStats(completeMatches.map((match) => match.gpuFrameNs)),
			correctness: scenario.correctness
		};
	});
}

export function extractRealRendererMetrics(
	scenarios: readonly AggregatedScenario[]
): Record<string, number> {
	const metrics: Record<string, number> = {};
	for (const scenario of scenarios) {
		metrics[`${scenario.name}_cpu_submit_ms`] = scenario.cpuSubmitMs.runMedians.median;
		metrics[`${scenario.name}_queue_completion_ms`] = scenario.queueCompletionMs.runMedians.median;
		metrics[`${scenario.name}_gpu_frame_ns`] = scenario.gpuFrameNs.runMedians.median;
	}
	return metrics;
}

export function realRendererMetricRules(
	scenarios: readonly AggregatedScenario[]
): Record<string, RealRendererMetricRule> {
	const rules: Record<string, RealRendererMetricRule> = {};
	for (const scenario of scenarios) {
		rules[`${scenario.name}_cpu_submit_ms`] = CPU_SUBMIT_RULE;
		rules[`${scenario.name}_queue_completion_ms`] = QUEUE_COMPLETION_RULE;
		rules[`${scenario.name}_gpu_frame_ns`] = GPU_FRAME_RULE;
	}
	return rules;
}

export function compareScenarioContracts(
	current: readonly AggregatedScenario[],
	baseline: readonly AggregatedScenario[]
): string[] {
	const differences: string[] = [];
	const baselineByName = new Map(baseline.map((scenario) => [scenario.name, scenario]));
	for (const scenario of current) {
		const reference = baselineByName.get(scenario.name);
		if (!reference) {
			differences.push(`${scenario.name}: missing from baseline`);
			continue;
		}
		if (scenario.passCount !== reference.passCount) {
			differences.push(
				`${scenario.name}: passCount current=${scenario.passCount} baseline=${reference.passCount}`
			);
		}
		if (
			scenario.correctness.after !== reference.correctness.after ||
			scenario.correctness.pixelCount !== reference.correctness.pixelCount ||
			scenario.correctness.computeSentinelAfter !== reference.correctness.computeSentinelAfter
		) {
			differences.push(`${scenario.name}: correctness contract differs from baseline`);
		}
		baselineByName.delete(scenario.name);
	}
	for (const name of baselineByName.keys()) {
		differences.push(`${name}: missing from current result`);
	}
	return differences;
}
