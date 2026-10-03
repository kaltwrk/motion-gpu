import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { createCurrentWritable } from '../core/current-value.js';
import { useSpektral } from './spektral-context.js';
import {
	resolveFrameTaskStage,
	type FrameCallback,
	type FrameKey,
	type FrameProfilingSnapshot,
	type FrameRegistry,
	type FrameRunTimings,
	type FrameScheduleSnapshot,
	type FrameStage,
	type FrameStageCallback,
	type FrameTask,
	type FrameTaskInvalidation,
	type FrameTaskInvalidationToken,
	type UseFrameOptions,
	type UseFrameResult
} from '../core/frame-registry.js';

/**
 * React context container for the active frame registry.
 */
export const FrameRegistryReactContext = createContext<FrameRegistry | null>(null);

export type {
	FrameCallback,
	FrameKey,
	FrameProfilingSnapshot,
	FrameRegistry,
	FrameRunTimings,
	FrameScheduleSnapshot,
	FrameStage,
	FrameStageCallback,
	FrameTask,
	FrameTaskInvalidation,
	FrameTaskInvalidationToken,
	UseFrameOptions,
	UseFrameResult
};

/**
 * Registers a frame callback using an auto-generated task key.
 */
export function useFrame(callback: FrameCallback, options?: UseFrameOptions): UseFrameResult;

/**
 * Registers a frame callback with an explicit task key.
 */
export function useFrame(
	key: FrameKey,
	callback: FrameCallback,
	options?: UseFrameOptions
): UseFrameResult;

/**
 * Registers a callback in the active frame registry and auto-unsubscribes on unmount.
 *
 * @param keyOrCallback - Task key or callback for auto-key registration.
 * @param callbackOrOptions - Callback (keyed overload) or options (auto-key overload).
 * @param maybeOptions - Optional registration options for keyed overload.
 * Registration key/options are frozen on first render; subsequent renders do not re-register.
 * @returns Registration control API with task, start/stop controls and started state.
 * @throws {Error} When called outside `<FragCanvas>`.
 * @throws {Error} When callback is missing in keyed overload.
 */
export function useFrame(
	keyOrCallback: FrameKey | FrameCallback,
	callbackOrOptions?: FrameCallback | UseFrameOptions,
	maybeOptions?: UseFrameOptions
): UseFrameResult {
	const registry = useContext(FrameRegistryReactContext);
	if (!registry) {
		throw new Error('useFrame must be used inside <FragCanvas>');
	}
	const spektral = useSpektral();

	const resolved =
		typeof keyOrCallback === 'function'
			? {
					key: undefined,
					callback: keyOrCallback,
					options: callbackOrOptions as UseFrameOptions | undefined
				}
			: {
					key: keyOrCallback,
					callback: callbackOrOptions as FrameCallback,
					options: maybeOptions
				};
	if (typeof resolved.callback !== 'function') {
		throw new Error('useFrame requires a callback');
	}

	const callbackRef = useRef(resolved.callback);
	useLayoutEffect(() => {
		callbackRef.current = resolved.callback;
	}, [resolved.callback]);
	const registrationConfigRef = useRef<{
		task: FrameTask;
		options: UseFrameOptions | undefined;
	} | null>(null);
	if (!registrationConfigRef.current) {
		const options = resolved.options;
		registrationConfigRef.current = {
			task: {
				key: resolved.key ?? Symbol('spektral-react-task'),
				stage: resolveFrameTaskStage(options)
			},
			options
		};
	}
	const registrationConfig = registrationConfigRef.current;

	const registrationRef = useRef<{
		task: FrameTask;
		start: () => void;
		stop: () => void;
		started: UseFrameResult['started'];
		unsubscribe: () => void;
	} | null>(null);
	const startedStoreRef = useRef(createCurrentWritable(false));
	const startedStore = startedStoreRef.current;

	useEffect(() => {
		const wrappedCallback: FrameCallback = (state) => {
			callbackRef.current(state);
		};
		const registration = registry.register(
			registrationConfig.task.key,
			wrappedCallback,
			registrationConfig.options
		);
		registrationRef.current = registration;
		registrationConfig.task.stage = registration.task.stage;
		const unsubscribeStarted = registration.started.subscribe((value) => {
			startedStore.set(value);
		});

		return () => {
			unsubscribeStarted();
			registration.unsubscribe();
			if (registrationRef.current === registration) {
				registrationRef.current = null;
			}
			startedStore.set(false);
		};
	}, [registrationConfig, registry, startedStore]);

	useEffect(() => {
		spektral.invalidate();
	}, [spektral, resolved.callback]);

	return {
		task: registrationConfig.task,
		start: () => {
			registrationRef.current?.start();
		},
		stop: () => {
			registrationRef.current?.stop();
		},
		started: startedStore
	};
}
