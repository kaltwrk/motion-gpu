import { useEffect, useRef } from 'react';
import {
	createPointerController,
	type PointerController,
	type PointerControllerOptions,
	type PointerControllerResult
} from '../core/pointer.js';
import { useSpektral } from './spektral-context.js';

export type {
	PointerClick,
	PointerFrameRequestMode,
	PointerKind,
	PointerPoint,
	PointerState
} from '../core/pointer.js';

/**
 * Configuration for pointer input handling in `usePointer`.
 */
export type UsePointerOptions = PointerControllerOptions;

/**
 * Reactive state returned by `usePointer`.
 */
export type UsePointerResult = PointerControllerResult;

/**
 * Tracks normalized pointer coordinates and click/tap snapshots for the active `FragCanvas`.
 */
export function usePointer(options: UsePointerOptions = {}): UsePointerResult {
	const spektral = useSpektral();
	const spektralRef = useRef(spektral);
	const controllerRef = useRef<PointerController | null>(null);
	spektralRef.current = spektral;

	if (!controllerRef.current) {
		controllerRef.current = createPointerController(
			{
				getRenderMode: () => spektralRef.current.renderMode.current,
				invalidate: () => spektralRef.current.invalidate(),
				advance: () => spektralRef.current.advance()
			},
			options
		);
	}

	const controller = controllerRef.current;

	useEffect(() => {
		controller.updateOptions(options);
	});

	useEffect(() => {
		// The canvas ref is attached during commit, after the initial render.
		const canvas = spektral.canvas;
		if (!canvas) {
			return;
		}

		controller.mount(canvas);
		return controller.destroy;
	}, [spektral, controller]);

	return controller;
}
