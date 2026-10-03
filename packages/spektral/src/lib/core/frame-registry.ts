import { createCurrentWritable, type CurrentWritable, type Subscribable } from './current-value.js';
import type { FrameInvalidationToken, FrameState, RenderMode } from './types.js';

/**
 * Per-frame callback executed by the frame scheduler.
 */
export type FrameCallback = (state: FrameState) => void;

/**
 * Stable key type used to identify frame tasks and stages.
 */
export type FrameKey = string | symbol;

/**
 * Public metadata describing a registered frame task.
 */
export interface FrameTask {
	key: FrameKey;
	stage: FrameKey;
}

/**
 * Public metadata describing a frame stage.
 */
export interface FrameStage {
	key: FrameKey;
}

/**
 * Stage callback allowing custom orchestration around task execution.
 */
export type FrameStageCallback = (state: FrameState, runTasks: () => void) => void;

/**
 * Options controlling task registration and scheduling behavior.
 */
export interface UseFrameOptions {
	/**
	 * Whether task starts in active state.
	 *
	 * @default true
	 */
	autoStart?: boolean;
	/**
	 * Whether task execution invalidates frame automatically.
	 *
	 * @default true
	 */
	autoInvalidate?: boolean;
	/**
	 * Explicit task invalidation policy.
	 */
	invalidation?: FrameTaskInvalidation;
	/**
	 * Stage to register task in.
	 *
	 * If omitted, main stage is used unless inferred from task dependencies.
	 */
	stage?: FrameKey | FrameStage;
	/**
	 * Task dependencies that should run after this task.
	 */
	before?: (FrameKey | FrameTask) | (FrameKey | FrameTask)[];
	/**
	 * Task dependencies that should run before this task.
	 */
	after?: (FrameKey | FrameTask) | (FrameKey | FrameTask)[];
	/**
	 * Dynamic predicate controlling whether the task is currently active.
	 */
	running?: () => boolean;
}

/**
 * Invalidation token value or resolver.
 */
export type FrameTaskInvalidationToken =
	| FrameInvalidationToken
	| (() => FrameInvalidationToken | null | undefined);

/**
 * Explicit task invalidation policy.
 */
export type FrameTaskInvalidation =
	| 'never'
	| 'always'
	| {
			mode?: 'never' | 'always';
			token?: FrameTaskInvalidationToken;
	  }
	| {
			mode: 'on-change';
			token: FrameTaskInvalidationToken;
	  };

/**
 * Handle returned by `useFrame` registration.
 */
export interface UseFrameResult {
	/**
	 * Registered task metadata.
	 */
	task: FrameTask;
	/**
	 * Starts task execution.
	 */
	start: () => void;
	/**
	 * Stops task execution.
	 */
	stop: () => void;
	/**
	 * Readable flag representing effective running state.
	 */
	started: Subscribable<boolean>;
}

/**
 * Snapshot of the resolved stage/task execution order.
 */
export interface FrameScheduleSnapshot {
	readonly stages: ReadonlyArray<{
		readonly key: string;
		readonly tasks: readonly string[];
	}>;
}

/**
 * Optional scheduler diagnostics payload captured for the last run.
 */
export interface FrameRunTimings {
	readonly total: number;
	readonly stages: Readonly<
		Record<
			string,
			{
				readonly duration: number;
				readonly tasks: Readonly<Record<string, number>>;
			}
		>
	>;
}

/**
 * Aggregated timing statistics for stage/task profiling.
 */
export interface FrameTimingStats {
	readonly last: number;
	readonly avg: number;
	readonly min: number;
	readonly max: number;
	readonly count: number;
}

/**
 * Profiling snapshot aggregated from the configured history window.
 */
export interface FrameProfilingSnapshot {
	readonly window: number;
	readonly frameCount: number;
	readonly lastFrame: FrameRunTimings | null;
	readonly total: FrameTimingStats;
	readonly stages: Readonly<
		Record<
			string,
			{
				readonly timings: FrameTimingStats;
				readonly tasks: Readonly<Record<string, FrameTimingStats>>;
			}
		>
	>;
}

/**
 * Internal registration payload including unsubscribe callback.
 */
interface RegisteredFrameTask extends UseFrameResult {
	unsubscribe: () => void;
}

interface DiagnosticEntry {
	diagnosticId: number;
	diagnosticKey: string;
}

/**
 * Internal mutable task descriptor used by scheduler runtime.
 */
interface InternalTask {
	task: FrameTask;
	/** Stable identity used independently from the human-readable key label. */
	diagnosticId: number;
	/** Human-readable key label used by schedule snapshots and diagnostics. */
	keyLabel: string;
	/** Collision-safe timing key. Plain string task keys remain backwards compatible. */
	diagnosticKey: string;
	callback: FrameCallback;
	order: number;
	started: boolean;
	lastRunning: boolean;
	startedStoreSet: (value: boolean) => void;
	startedStore: Subscribable<boolean>;
	before: Set<FrameKey>;
	after: Set<FrameKey>;
	invalidation: {
		mode: 'never' | 'always' | 'on-change';
		token?: FrameTaskInvalidationToken;
		lastToken: FrameInvalidationToken | null;
		hasToken: boolean;
	};
	running?: () => boolean;
}

/**
 * Internal mutable stage descriptor used by scheduler runtime.
 */
interface InternalStage {
	key: FrameKey;
	/** Stable identity used independently from the human-readable key label. */
	diagnosticId: number;
	/** Human-readable key label used by schedule snapshots and diagnostics. */
	keyLabel: string;
	/** Collision-safe timing key. Plain string stage keys remain backwards compatible. */
	diagnosticKey: string;
	order: number;
	started: boolean;
	before: Set<FrameKey>;
	after: Set<FrameKey>;
	callback: FrameStageCallback;
	tasks: Map<FrameKey, InternalTask>;
}

/**
 * Default stage key used when task stage is not explicitly specified.
 */
export const DEFAULT_FRAME_STAGE_KEY = Symbol('spektral-main-stage');
const RENDER_MODE_INVALIDATION_TOKEN = Symbol('spektral-render-mode-change');
const MAX_PROFILING_WINDOW = 10_000;

/**
 * Default stage callback that runs tasks immediately.
 */
const DEFAULT_STAGE_CALLBACK: FrameStageCallback = (_state, runTasks) => runTasks();

/**
 * Normalizes scalar-or-array options to array form.
 */
function asArray<T>(value: T | T[] | undefined): T[] {
	if (!value) {
		return [];
	}

	return Array.isArray(value) ? value : [value];
}

/**
 * Normalizes frame keys to readable string labels.
 */
function frameKeyToString(key: FrameKey): string {
	return typeof key === 'symbol' ? key.toString() : key;
}

/**
 * Creates the preferred serializable diagnostics key for a frame key.
 */
function createDiagnosticKey(key: FrameKey, kind: 'stage' | 'task', id: number): string {
	if (typeof key === 'string') {
		return key;
	}

	return `${frameKeyToString(key)} [${kind}:${id}]`;
}

/**
 * Assigns a unique diagnostics key while keeping plain string keys unchanged.
 * Returns whether an existing entry had to be reassigned.
 */
function assignDiagnosticKey<T extends DiagnosticEntry>(
	entry: T,
	entries: Iterable<T>,
	kind: 'stage' | 'task',
	getKey: (entry: T) => FrameKey
): boolean {
	const key = getKey(entry);
	if (typeof key === 'string') {
		entry.diagnosticKey = key;
		let reassignedExistingEntry = false;
		for (const other of entries) {
			if (typeof getKey(other) === 'symbol' && other.diagnosticKey === key) {
				assignDiagnosticKey(other, entries, kind, getKey);
				reassignedExistingEntry = true;
			}
		}
		return reassignedExistingEntry;
	}

	const usedKeys = new Set<string>();
	for (const other of entries) {
		if (other !== entry) {
			usedKeys.add(other.diagnosticKey);
		}
	}

	const preferredKey = createDiagnosticKey(key, kind, entry.diagnosticId);
	let diagnosticKey = preferredKey;
	let collisionIndex = 0;
	while (usedKeys.has(diagnosticKey)) {
		collisionIndex += 1;
		diagnosticKey = `${preferredKey} [collision:${collisionIndex}]`;
	}
	entry.diagnosticKey = diagnosticKey;
	return false;
}

/**
 * Validates profiling history capacity before allocating its ring buffer.
 */
function assertProfilingWindow(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PROFILING_WINDOW) {
		throw new Error(`profilingWindow must be a safe integer between 1 and ${MAX_PROFILING_WINDOW}`);
	}

	return value;
}

/**
 * Extracts task key from either direct key or task reference.
 */
function toTaskKey(reference: FrameKey | FrameTask): FrameKey {
	if (typeof reference === 'string' || typeof reference === 'symbol') {
		return reference;
	}

	return reference.key;
}

/**
 * Extracts stage key from either direct key or stage reference.
 */
function toStageKey(reference: FrameKey | FrameStage): FrameKey {
	if (typeof reference === 'string' || typeof reference === 'symbol') {
		return reference;
	}

	return reference.key;
}

/**
 * Resolves the stage metadata a task will receive during registration.
 * Adapter hooks use this before lifecycle effects run so task references are stable.
 */
export function resolveFrameTaskStage(options?: UseFrameOptions): FrameKey {
	const before = asArray(options?.before);
	const after = asArray(options?.after);
	const inferredStage = [...before, ...after].find(
		(entry) => typeof entry === 'object' && entry !== null && 'stage' in entry
	) as FrameTask | undefined;

	return options?.stage !== undefined
		? toStageKey(options.stage)
		: (inferredStage?.stage ?? DEFAULT_FRAME_STAGE_KEY);
}

/**
 * Resolves invalidation token from static value or resolver callback.
 */
function resolveInvalidationToken(
	token: FrameTaskInvalidationToken | undefined
): FrameInvalidationToken | null {
	if (token === undefined) {
		return null;
	}

	// Fast path: most tokens are static (string | symbol) — skip the typeof
	// check and return directly. Function tokens are rare (dynamic token resolvers).
	if (typeof token !== 'function') {
		return token;
	}

	const resolved = token();
	if (resolved === null || resolved === undefined) {
		return null;
	}

	return resolved;
}

/**
 * Normalizes task invalidation options to runtime representation.
 */
function normalizeTaskInvalidation(
	key: FrameKey,
	options: UseFrameOptions
): InternalTask['invalidation'] {
	const explicit = options.invalidation;
	if (explicit === undefined) {
		if (options.autoInvalidate === false) {
			return {
				mode: 'never',
				lastToken: null,
				hasToken: false
			};
		}

		return {
			mode: 'always',
			token: key,
			lastToken: null,
			hasToken: false
		};
	}

	if (explicit === 'never' || explicit === 'always') {
		if (explicit === 'never') {
			return {
				mode: explicit,
				lastToken: null,
				hasToken: false
			};
		}

		return {
			mode: explicit,
			token: key,
			lastToken: null,
			hasToken: false
		};
	}

	const mode = explicit.mode ?? 'always';
	const token = explicit.token;
	if (mode === 'on-change' && token === undefined) {
		throw new Error('Task invalidation mode "on-change" requires a token');
	}

	if (mode === 'never') {
		return {
			mode,
			lastToken: null,
			hasToken: false
		};
	}

	if (mode === 'on-change') {
		return {
			mode,
			token: token as FrameTaskInvalidationToken,
			lastToken: null,
			hasToken: false
		};
	}

	return {
		mode,
		token: token ?? key,
		lastToken: null,
		hasToken: false
	};
}

/**
 * Computes aggregate timing stats from sampled durations.
 */
function buildTimingStats(samples: number[], last: number): FrameTimingStats {
	if (samples.length === 0) {
		return Object.freeze({
			last,
			avg: 0,
			min: 0,
			max: 0,
			count: 0
		});
	}

	let sum = 0;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;

	for (const value of samples) {
		sum += value;
		if (value < min) {
			min = value;
		}
		if (value > max) {
			max = value;
		}
	}

	return Object.freeze({
		last,
		avg: sum / samples.length,
		min,
		max,
		count: samples.length
	});
}

/**
 * Dependency graph sorting options used for diagnostics labels.
 */
interface SortDependenciesOptions<T extends { key: FrameKey; order: number }> {
	graphName: string;
	getItemLabel: (item: T) => string;
	isKnownExternalDependency?: (key: FrameKey) => boolean;
}

/**
 * Deterministically sorts dependency keys for stable traversal and diagnostics.
 */
function sortDependencyKeys(keys: Iterable<FrameKey>): FrameKey[] {
	return Array.from(keys).sort((a, b) => frameKeyToString(a).localeCompare(frameKeyToString(b)));
}

/**
 * Finds one deterministic cycle path in the directed dependency graph.
 */
function findDependencyCycle<T extends { key: FrameKey; order: number }>(
	items: T[],
	edges: ReadonlyMap<FrameKey, ReadonlySet<FrameKey>>
): FrameKey[] | null {
	const visitState = new Map<FrameKey, 0 | 1 | 2>();
	const stack: FrameKey[] = [];
	let cycle: FrameKey[] | null = null;
	const sortedItems = [...items].sort((a, b) => a.order - b.order);

	const visit = (key: FrameKey): boolean => {
		visitState.set(key, 1);
		stack.push(key);

		for (const childKey of sortDependencyKeys(edges.get(key) ?? [])) {
			const state = visitState.get(childKey) ?? 0;
			if (state === 0) {
				if (visit(childKey)) {
					return true;
				}
				continue;
			}

			if (state === 1) {
				const cycleStartIndex = stack.findIndex((entry) => entry === childKey);
				const cyclePath = cycleStartIndex === -1 ? [childKey] : stack.slice(cycleStartIndex);
				cycle = [...cyclePath, childKey];
				return true;
			}
		}

		stack.pop();
		visitState.set(key, 2);
		return false;
	};

	for (const item of sortedItems) {
		if ((visitState.get(item.key) ?? 0) !== 0) {
			continue;
		}

		if (visit(item.key)) {
			return cycle;
		}
	}

	return null;
}

/**
 * Topologically sorts items by `before`/`after` dependencies.
 *
 * Throws deterministic errors when dependencies are missing or cyclic.
 */
function sortByDependencies<T extends { key: FrameKey; order: number }>(
	items: T[],
	getBefore: (item: T) => Iterable<FrameKey>,
	getAfter: (item: T) => Iterable<FrameKey>,
	options: SortDependenciesOptions<T>
): T[] {
	const itemsByKey = new Map<FrameKey, T>();
	for (const item of items) {
		itemsByKey.set(item.key, item);
	}

	const indegree = new Map<FrameKey, number>();
	const edges = new Map<FrameKey, Set<FrameKey>>();

	for (const item of items) {
		indegree.set(item.key, 0);
		edges.set(item.key, new Set());
	}

	const addEdge = (from: FrameKey, to: FrameKey): void => {
		const children = edges.get(from);
		if (!children || children.has(to)) {
			return;
		}

		children.add(to);
		indegree.set(to, (indegree.get(to) ?? 0) + 1);
	};

	for (const item of items) {
		for (const dependencyKey of getAfter(item)) {
			if (!itemsByKey.has(dependencyKey)) {
				if (options.isKnownExternalDependency?.(dependencyKey)) {
					continue;
				}
				throw new Error(
					`${options.graphName} dependency error: ${options.getItemLabel(item)} references missing dependency "${frameKeyToString(dependencyKey)}" in "after".`
				);
			}

			addEdge(dependencyKey, item.key);
		}

		for (const dependencyKey of getBefore(item)) {
			if (!itemsByKey.has(dependencyKey)) {
				if (options.isKnownExternalDependency?.(dependencyKey)) {
					continue;
				}
				throw new Error(
					`${options.graphName} dependency error: ${options.getItemLabel(item)} references missing dependency "${frameKeyToString(dependencyKey)}" in "before".`
				);
			}

			addEdge(item.key, dependencyKey);
		}
	}

	const queue = items.filter((item) => (indegree.get(item.key) ?? 0) === 0);
	queue.sort((a, b) => a.order - b.order);

	const ordered: T[] = [];
	let head = 0;
	while (head < queue.length) {
		const current = queue[head];
		head += 1;
		if (!current) {
			break;
		}

		ordered.push(current);

		for (const childKey of edges.get(current.key) ?? []) {
			const nextDegree = (indegree.get(childKey) ?? 0) - 1;
			indegree.set(childKey, nextDegree);
			if (nextDegree === 0) {
				const child = itemsByKey.get(childKey);
				if (child) {
					let insertIndex = queue.length;
					while (insertIndex > head && (queue[insertIndex - 1]?.order ?? 0) > child.order) {
						insertIndex -= 1;
					}
					queue.splice(insertIndex, 0, child);
				}
			}
		}
	}

	if (ordered.length !== items.length) {
		const cycle = findDependencyCycle(items, edges);
		if (cycle) {
			throw new Error(
				`${options.graphName} dependency cycle detected: ${cycle.map((key) => frameKeyToString(key)).join(' -> ')}`
			);
		}

		throw new Error(`${options.graphName} dependency resolution failed.`);
	}

	return ordered;
}

/**
 * Runtime registry that stores frame tasks/stages and drives render scheduling.
 */
export interface FrameRegistry {
	/**
	 * Registers a frame callback in the scheduler.
	 */
	register: (
		keyOrCallback: FrameKey | FrameCallback,
		callbackOrOptions?: FrameCallback | UseFrameOptions,
		maybeOptions?: UseFrameOptions
	) => RegisteredFrameTask;
	/**
	 * Executes one scheduler run.
	 */
	run: (state: FrameState) => void;
	/**
	 * Marks frame as invalidated for `on-demand` mode.
	 */
	invalidate: (token?: FrameInvalidationToken) => void;
	/**
	 * Requests a single render in `manual` mode.
	 */
	advance: () => void;
	/**
	 * Returns whether renderer should submit a frame now.
	 */
	shouldRender: () => boolean;
	/**
	 * Resets one-frame invalidation/advance flags.
	 */
	endFrame: () => void;
	/**
	 * Sets render scheduling mode.
	 */
	setRenderMode: (mode: RenderMode) => void;
	/**
	 * Enables or disables automatic rendering entirely.
	 */
	setAutoRender: (enabled: boolean) => void;
	/**
	 * Sets maximum allowed delta passed to frame tasks.
	 */
	setMaxDelta: (value: number) => void;
	/**
	 * Enables/disables frame profiling.
	 */
	setProfilingEnabled: (enabled: boolean) => void;
	/**
	 * Sets profiling history window between 1 and 10,000 frames.
	 */
	setProfilingWindow: (window: number) => void;
	/**
	 * Clears collected profiling samples.
	 */
	resetProfiling: () => void;
	/**
	 * Enables/disables diagnostics capture.
	 */
	setDiagnosticsEnabled: (enabled: boolean) => void;
	/**
	 * Returns current render mode.
	 */
	getRenderMode: () => RenderMode;
	/**
	 * Returns whether automatic rendering is enabled.
	 */
	getAutoRender: () => boolean;
	/**
	 * Returns current max delta clamp.
	 */
	getMaxDelta: () => number;
	/**
	 * Returns profiling toggle state.
	 */
	getProfilingEnabled: () => boolean;
	/**
	 * Returns active profiling history window between 1 and 10,000 frames.
	 */
	getProfilingWindow: () => number;
	/**
	 * Returns aggregated profiling snapshot.
	 */
	getProfilingSnapshot: () => FrameProfilingSnapshot | null;
	/**
	 * Returns diagnostics toggle state.
	 */
	getDiagnosticsEnabled: () => boolean;
	/**
	 * Returns last run timings snapshot when diagnostics are enabled.
	 */
	getLastRunTimings: () => FrameRunTimings | null;
	/**
	 * Returns dependency-sorted schedule snapshot.
	 */
	getSchedule: () => FrameScheduleSnapshot;
	/**
	 * Creates or updates a stage.
	 */
	createStage: (
		key: FrameKey,
		options?: {
			before?: (FrameKey | FrameStage) | (FrameKey | FrameStage)[];
			after?: (FrameKey | FrameStage) | (FrameKey | FrameStage)[];
			callback?: FrameStageCallback | null;
		}
	) => FrameStage;
	/**
	 * Reads stage metadata by key.
	 */
	getStage: (key: FrameKey) => FrameStage | undefined;
	/**
	 * Removes all tasks from all stages.
	 */
	clear: () => void;
}

interface FrameScheduling {
	hasWork: () => boolean;
	subscribe: (wake: () => void) => () => void;
}

// Runtime coordination stays outside the public scheduler API.
const frameScheduling = new WeakMap<FrameRegistry, FrameScheduling>();

/** @internal */
export function getFrameScheduling(registry: FrameRegistry): FrameScheduling | undefined {
	return frameScheduling.get(registry);
}

/**
 * Creates a frame registry used by `FragCanvas` and `useFrame`.
 *
 * @param options - Initial scheduler options.
 * @returns Mutable frame registry instance.
 */
export function createFrameRegistry(options?: {
	renderMode?: RenderMode;
	autoRender?: boolean;
	maxDelta?: number;
	profilingEnabled?: boolean;
	profilingWindow?: number;
	diagnosticsEnabled?: boolean;
}): FrameRegistry {
	let renderMode: RenderMode = options?.renderMode ?? 'always';
	let autoRender = options?.autoRender ?? true;
	let maxDelta = options?.maxDelta ?? 0.1;
	let profilingEnabled = options?.profilingEnabled ?? options?.diagnosticsEnabled ?? false;
	let profilingWindow = assertProfilingWindow(options?.profilingWindow ?? 120);
	let lastRunTimings: FrameRunTimings | null = null;

	// Ring buffer for profiling history. Replaces the Array.shift()-based
	// approach (O(n)) with an O(1) head-advance on every push past capacity.
	let ringBuffer: FrameRunTimings[] = new Array(profilingWindow) as FrameRunTimings[];
	let ringHead = 0; // Index of the oldest valid entry.
	let ringCount = 0; // Number of valid entries (≤ profilingWindow).
	let hasUntokenizedInvalidation = true;
	const invalidationTokens = new Set<FrameInvalidationToken>();
	let shouldAdvance = false;
	let orderCounter = 0;
	let diagnosticIdCounter = 0;

	// Pre-allocated object for the clamped-delta frame state, mutated in-place
	// each frame instead of allocating a new spread object when maxDelta fires.
	// Initialised lazily on the first clamped frame — until then `null` signals
	// that the original state should be passed through unchanged.
	let clampedFrameState: FrameState | null = null;

	const assertMaxDelta = (value: number): number => {
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error('maxDelta must be a finite number greater than 0');
		}
		return value;
	};

	maxDelta = assertMaxDelta(maxDelta);

	const stages = new Map<FrameKey, InternalStage>();
	const wakeListeners = new Set<() => void>();
	const hasScheduledWork = (): boolean => {
		for (const stage of stages.values()) {
			if (!stage.started) continue;
			if (stage.callback !== DEFAULT_STAGE_CALLBACK) return true;
			for (const task of stage.tasks.values()) {
				// Dynamic running predicates must still be checked on later frames.
				if (task.started) return true;
			}
		}
		return false;
	};
	const wakeScheduler = (): void => {
		if (!hasScheduledWork()) return;
		for (const wake of wakeListeners) wake();
	};
	let scheduleDirty = true;
	let sortedStages: InternalStage[] = [];
	const sortedTasksByStage = new Map<FrameKey, InternalTask[]>();
	let scheduleSnapshot: FrameScheduleSnapshot = Object.freeze({ stages: Object.freeze([]) });

	const markScheduleDirty = (): void => {
		scheduleDirty = true;
	};

	const syncSchedule = (): void => {
		if (!scheduleDirty) {
			return;
		}

		const stageList = sortByDependencies(
			Array.from(stages.values()),
			(stage) => stage.before,
			(stage) => stage.after,
			{
				graphName: 'Frame stage graph',
				getItemLabel: (stage) => `stage "${frameKeyToString(stage.key)}"`
			}
		);
		const nextTasksByStage = new Map<FrameKey, InternalTask[]>();
		const globalTaskKeys = new Set<FrameKey>();
		for (const stage of stageList) {
			for (const task of stage.tasks.values()) {
				globalTaskKeys.add(task.task.key);
			}
		}

		for (const stage of stageList) {
			const taskList = sortByDependencies(
				Array.from(stage.tasks.values()).map((task) => ({
					key: task.task.key,
					order: task.order,
					task
				})),
				(task) => task.task.before,
				(task) => task.task.after,
				{
					graphName: `Frame task graph for stage "${frameKeyToString(stage.key)}"`,
					getItemLabel: (task) => `task "${frameKeyToString(task.key)}"`,
					isKnownExternalDependency: (key) => globalTaskKeys.has(key)
				}
			).map((task) => task.task);
			nextTasksByStage.set(stage.key, taskList);
		}

		sortedStages = stageList;
		sortedTasksByStage.clear();
		for (const [stageKey, taskList] of nextTasksByStage) {
			sortedTasksByStage.set(stageKey, taskList);
		}

		scheduleSnapshot = Object.freeze({
			stages: Object.freeze(
				sortedStages.map((stage) =>
					Object.freeze({
						key: stage.keyLabel,
						tasks: Object.freeze(
							(sortedTasksByStage.get(stage.key) ?? []).map((task) => task.keyLabel)
						)
					})
				)
			)
		});

		scheduleDirty = false;
	};

	const pushProfile = (timings: FrameRunTimings): void => {
		if (ringCount < profilingWindow) {
			// Buffer not yet full: write at the next free slot.
			ringBuffer[(ringHead + ringCount) % profilingWindow] = timings;
			ringCount += 1;
		} else {
			// Buffer full: overwrite the oldest slot and advance the head. O(1).
			ringBuffer[ringHead] = timings;
			ringHead = (ringHead + 1) % profilingWindow;
		}
	};

	const clearProfiling = (): void => {
		ringHead = 0;
		ringCount = 0;
		lastRunTimings = null;
	};

	const buildProfilingSnapshot = (): FrameProfilingSnapshot | null => {
		if (!profilingEnabled) {
			return null;
		}

		const stageBuckets = new Map<
			string,
			{
				durations: number[];
				taskDurations: Map<string, number[]>;
			}
		>();
		const totalDurations: number[] = [];

		for (let ri = 0; ri < ringCount; ri++) {
			const frame = ringBuffer[(ringHead + ri) % profilingWindow] as FrameRunTimings;
			totalDurations.push(frame.total);
			for (const [stageKey, stageTiming] of Object.entries(frame.stages)) {
				const stageBucket = stageBuckets.get(stageKey) ?? {
					durations: [],
					taskDurations: new Map<string, number[]>()
				};
				stageBucket.durations.push(stageTiming.duration);

				for (const [taskKey, taskDuration] of Object.entries(stageTiming.tasks)) {
					const bucket = stageBucket.taskDurations.get(taskKey) ?? [];
					bucket.push(taskDuration);
					stageBucket.taskDurations.set(taskKey, bucket);
				}

				stageBuckets.set(stageKey, stageBucket);
			}
		}

		const stagesSnapshot = Object.create(null) as Record<
			string,
			{
				readonly timings: FrameTimingStats;
				readonly tasks: Readonly<Record<string, FrameTimingStats>>;
			}
		>;
		for (const [stageKey, stageBucket] of stageBuckets) {
			const lastStageDuration = lastRunTimings?.stages[stageKey]?.duration ?? 0;
			const taskSnapshot = Object.create(null) as Record<string, FrameTimingStats>;
			for (const [taskKey, taskDurations] of stageBucket.taskDurations) {
				const lastTaskDuration = lastRunTimings?.stages[stageKey]?.tasks[taskKey] ?? 0;
				taskSnapshot[taskKey] = buildTimingStats(taskDurations, lastTaskDuration);
			}

			stagesSnapshot[stageKey] = Object.freeze({
				timings: buildTimingStats(stageBucket.durations, lastStageDuration),
				tasks: Object.freeze(taskSnapshot)
			});
		}

		return Object.freeze({
			window: profilingWindow,
			frameCount: ringCount,
			lastFrame: lastRunTimings,
			total: buildTimingStats(totalDurations, lastRunTimings?.total ?? 0),
			stages: Object.freeze(stagesSnapshot)
		});
	};

	const ensureStage = (
		stageReference: FrameKey | FrameStage,
		stageOptions?: {
			before?: (FrameKey | FrameStage)[];
			after?: (FrameKey | FrameStage)[];
			callback?: FrameStageCallback | null;
		}
	): InternalStage => {
		const stageKey = toStageKey(stageReference);
		const existing = stages.get(stageKey);
		if (existing) {
			if (stageOptions?.before !== undefined) {
				existing.before = new Set(stageOptions.before.map((entry) => toStageKey(entry)));
				markScheduleDirty();
			}
			if (stageOptions?.after !== undefined) {
				existing.after = new Set(stageOptions.after.map((entry) => toStageKey(entry)));
				markScheduleDirty();
			}
			if (stageOptions && Object.prototype.hasOwnProperty.call(stageOptions, 'callback')) {
				existing.callback = stageOptions.callback ?? DEFAULT_STAGE_CALLBACK;
			}
			return existing;
		}

		const diagnosticId = diagnosticIdCounter++;
		const stage: InternalStage = {
			key: stageKey,
			diagnosticId,
			keyLabel: frameKeyToString(stageKey),
			diagnosticKey: createDiagnosticKey(stageKey, 'stage', diagnosticId),
			order: orderCounter++,
			started: true,
			before: new Set((stageOptions?.before ?? []).map((entry) => toStageKey(entry))),
			after: new Set((stageOptions?.after ?? []).map((entry) => toStageKey(entry))),
			callback: stageOptions?.callback ?? DEFAULT_STAGE_CALLBACK,
			tasks: new Map()
		};
		stages.set(stageKey, stage);
		if (assignDiagnosticKey(stage, stages.values(), 'stage', (entry) => entry.key)) {
			clearProfiling();
		}
		markScheduleDirty();
		return stage;
	};

	ensureStage(DEFAULT_FRAME_STAGE_KEY);

	const resolveEffectiveRunning = (task: InternalTask): boolean => {
		const running = task.started && (task.running?.() ?? true);
		if (task.lastRunning !== running) {
			task.lastRunning = running;
			task.startedStoreSet(running);
		}
		return running;
	};

	const hasPendingInvalidation = (): boolean => {
		return hasUntokenizedInvalidation || invalidationTokens.size > 0;
	};

	const invalidateWithToken = (token?: FrameInvalidationToken): void => {
		if (token === undefined) {
			hasUntokenizedInvalidation = true;
			return;
		}

		invalidationTokens.add(token);
	};

	const applyTaskInvalidation = (task: InternalTask): void => {
		const config = task.invalidation;
		if (config.mode === 'never') {
			return;
		}

		if (config.mode === 'always') {
			const token = resolveInvalidationToken(config.token);
			invalidateWithToken(token ?? task.task.key);
			return;
		}

		const token = resolveInvalidationToken(config.token);
		if (token === null) {
			config.hasToken = false;
			config.lastToken = null;
			return;
		}

		const changed = !config.hasToken || config.lastToken !== token;
		config.hasToken = true;
		config.lastToken = token;
		if (changed) {
			invalidateWithToken(token);
		}
	};

	const registry: FrameRegistry = {
		register(keyOrCallback, callbackOrOptions, maybeOptions) {
			const key =
				typeof keyOrCallback === 'function'
					? (Symbol('spektral-task') as FrameKey)
					: (keyOrCallback as FrameKey);
			const callback =
				typeof keyOrCallback === 'function' ? keyOrCallback : (callbackOrOptions as FrameCallback);
			const taskOptions =
				typeof keyOrCallback === 'function'
					? ((callbackOrOptions as UseFrameOptions | undefined) ?? {})
					: (maybeOptions ?? {});

			if (typeof callback !== 'function') {
				throw new Error('useFrame requires a callback');
			}

			const before = asArray(taskOptions.before);
			const after = asArray(taskOptions.after);
			const stageKey = resolveFrameTaskStage(taskOptions);

			const stage = ensureStage(stageKey);
			const startedWritable: CurrentWritable<boolean> = createCurrentWritable(
				taskOptions.autoStart ?? true
			);

			const diagnosticId = diagnosticIdCounter++;
			const internalTask: InternalTask = {
				task: { key, stage: stage.key },
				diagnosticId,
				keyLabel: frameKeyToString(key),
				diagnosticKey: createDiagnosticKey(key, 'task', diagnosticId),
				callback,
				order: orderCounter++,
				started: taskOptions.autoStart ?? true,
				lastRunning: taskOptions.autoStart ?? true,
				startedStoreSet: startedWritable.set,
				startedStore: { subscribe: startedWritable.subscribe },
				before: new Set(before.map((entry) => toTaskKey(entry))),
				after: new Set(after.map((entry) => toTaskKey(entry))),
				invalidation: normalizeTaskInvalidation(key, taskOptions)
			};

			if (taskOptions.running) {
				internalTask.running = taskOptions.running;
			}

			stage.tasks.set(key, internalTask);
			if (
				assignDiagnosticKey(internalTask, stage.tasks.values(), 'task', (entry) => entry.task.key)
			) {
				clearProfiling();
			}
			markScheduleDirty();
			internalTask.startedStoreSet(resolveEffectiveRunning(internalTask));
			wakeScheduler();

			const start = () => {
				internalTask.started = true;
				resolveEffectiveRunning(internalTask);
				if (stage.tasks.get(key) === internalTask) wakeScheduler();
			};

			const stop = () => {
				internalTask.started = false;
				resolveEffectiveRunning(internalTask);
			};

			return {
				task: internalTask.task,
				start,
				stop,
				started: internalTask.startedStore,
				unsubscribe: () => {
					const current = stage.tasks.get(key);
					if (current === internalTask && stage.tasks.delete(key)) {
						markScheduleDirty();
					}
				}
			};
		},
		run(state) {
			const clampedDelta = Math.min(state.delta, maxDelta);
			let frameState: FrameState;
			if (clampedDelta === state.delta) {
				frameState = state;
			} else {
				// Reuse the pre-allocated object — update only the fields that can
				// change between frames (delta and fields derived from `state`).
				if (clampedFrameState === null) {
					clampedFrameState = { ...state, delta: clampedDelta };
				} else {
					clampedFrameState.time = state.time;
					clampedFrameState.delta = clampedDelta;
					clampedFrameState.setUniform = state.setUniform;
					clampedFrameState.setTexture = state.setTexture;
					clampedFrameState.writeStorageBuffer = state.writeStorageBuffer;
					clampedFrameState.readStorageBuffer = state.readStorageBuffer;
					clampedFrameState.invalidate = state.invalidate;
					clampedFrameState.advance = state.advance;
					clampedFrameState.renderMode = state.renderMode;
					clampedFrameState.autoRender = state.autoRender;
					clampedFrameState.canvas = state.canvas;
				}
				frameState = clampedFrameState;
			}
			syncSchedule();
			const frameStart = profilingEnabled ? performance.now() : 0;
			const stageTimings = Object.create(null) as Record<
				string,
				{
					readonly duration: number;
					readonly tasks: Readonly<Record<string, number>>;
				}
			>;

			for (const stage of sortedStages) {
				if (!stage.started) {
					continue;
				}
				const stageStart = profilingEnabled ? performance.now() : 0;
				const taskTimings = Object.create(null) as Record<string, number>;
				const taskList = sortedTasksByStage.get(stage.key) ?? [];

				stage.callback(frameState, () => {
					for (const task of taskList) {
						if (!resolveEffectiveRunning(task)) {
							continue;
						}
						const taskStart = profilingEnabled ? performance.now() : 0;

						task.callback(frameState);
						if (profilingEnabled) {
							taskTimings[task.diagnosticKey] = performance.now() - taskStart;
						}
						applyTaskInvalidation(task);
					}
				});

				if (profilingEnabled) {
					stageTimings[stage.diagnosticKey] = Object.freeze({
						duration: performance.now() - stageStart,
						tasks: Object.freeze(taskTimings)
					});
				}
			}

			if (profilingEnabled) {
				const timings: FrameRunTimings = Object.freeze({
					total: performance.now() - frameStart,
					stages: Object.freeze(stageTimings)
				});
				lastRunTimings = timings;
				pushProfile(timings);
			}
		},
		invalidate(token) {
			invalidateWithToken(token);
		},
		advance() {
			shouldAdvance = true;
			invalidateWithToken();
		},
		shouldRender() {
			if (!autoRender) {
				return false;
			}

			if (renderMode === 'always') {
				return true;
			}

			if (renderMode === 'on-demand') {
				return shouldAdvance || hasPendingInvalidation();
			}

			return shouldAdvance;
		},
		endFrame() {
			hasUntokenizedInvalidation = false;
			invalidationTokens.clear();
			shouldAdvance = false;
		},
		setRenderMode(mode) {
			if (renderMode === mode) {
				return;
			}

			renderMode = mode;
			shouldAdvance = false;
			if (mode === 'on-demand') {
				invalidateWithToken(RENDER_MODE_INVALIDATION_TOKEN);
			}
		},
		setAutoRender(enabled) {
			autoRender = enabled;
		},
		setMaxDelta(value) {
			maxDelta = assertMaxDelta(value);
		},
		setProfilingEnabled(enabled) {
			profilingEnabled = enabled;
			if (!enabled) {
				clearProfiling();
			}
		},
		setProfilingWindow(window) {
			const newWindow = assertProfilingWindow(window);
			if (newWindow === profilingWindow) {
				return;
			}

			// Drain the ring into a flat ordered array (oldest → newest).
			const keep = Math.min(ringCount, newWindow);
			const startOffset = ringCount - keep;
			const newBuffer: FrameRunTimings[] = new Array(newWindow) as FrameRunTimings[];
			for (let i = 0; i < keep; i++) {
				newBuffer[i] = ringBuffer[
					(ringHead + startOffset + i) % profilingWindow
				] as FrameRunTimings;
			}

			profilingWindow = newWindow;
			ringBuffer = newBuffer;
			ringHead = 0;
			ringCount = keep;
		},
		resetProfiling() {
			clearProfiling();
		},
		setDiagnosticsEnabled(enabled) {
			profilingEnabled = enabled;
			if (!enabled) {
				clearProfiling();
			}
		},
		getRenderMode() {
			return renderMode;
		},
		getAutoRender() {
			return autoRender;
		},
		getMaxDelta() {
			return maxDelta;
		},
		getProfilingEnabled() {
			return profilingEnabled;
		},
		getProfilingWindow() {
			return profilingWindow;
		},
		getProfilingSnapshot() {
			return buildProfilingSnapshot();
		},
		getDiagnosticsEnabled() {
			return profilingEnabled;
		},
		getLastRunTimings() {
			return lastRunTimings;
		},
		getSchedule() {
			syncSchedule();
			return scheduleSnapshot;
		},
		createStage(key, options) {
			const stageOptions: Parameters<typeof ensureStage>[1] | undefined = options
				? {
						...(Object.prototype.hasOwnProperty.call(options, 'before')
							? { before: asArray(options.before) }
							: {}),
						...(Object.prototype.hasOwnProperty.call(options, 'after')
							? { after: asArray(options.after) }
							: {}),
						...(Object.prototype.hasOwnProperty.call(options, 'callback')
							? { callback: options.callback ?? null }
							: {})
					}
				: undefined;
			const stage = ensureStage(key, stageOptions);
			wakeScheduler();
			return { key: stage.key };
		},
		getStage(key) {
			const stage = stages.get(key);
			if (!stage) {
				return undefined;
			}
			return { key: stage.key };
		},
		clear() {
			for (const stage of stages.values()) {
				stage.tasks.clear();
			}
			markScheduleDirty();
		}
	};
	frameScheduling.set(registry, {
		hasWork: hasScheduledWork,
		subscribe: (wake) => {
			wakeListeners.add(wake);
			return () => {
				wakeListeners.delete(wake);
			};
		}
	});
	return registry;
}
