import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useSpektral } from '../../src/lib/react';
import { observeAnimationFrames } from '../observe-animation-frames';
import type { RenderMode } from '../../src/lib/core/types';

export interface RuntimeControls {
	setRenderMode: (mode: RenderMode) => void;
	invalidate: () => void;
	advance: () => void;
	setTaskActive: (active: boolean) => void;
}

interface RuntimeProbeProps {
	passive?: boolean;
	onFrame: (count: number) => void;
	onReady: (controls: RuntimeControls) => void;
}

export function RuntimeProbe({ onFrame, onReady, passive = false }: RuntimeProbeProps) {
	const context = useSpektral();
	const frameCountRef = useRef(0);
	const onFrameRef = useRef(onFrame);

	useEffect(() => {
		onFrameRef.current = onFrame;
	}, [onFrame]);

	const handleFrame = useCallback(() => {
		frameCountRef.current += 1;
		onFrameRef.current(frameCountRef.current);
	}, []);

	const taskCallback = useCallback(() => {
		if (!passive) handleFrame();
	}, [passive, handleFrame]);
	const task = useFrame(taskCallback, { autoInvalidate: false, autoStart: !passive });
	const taskRef = useRef(task);
	useEffect(() => {
		taskRef.current = task;
	}, [task]);
	const setTaskActive = useCallback((active: boolean) => {
		if (active) taskRef.current.start();
		else taskRef.current.stop();
	}, []);
	useEffect(() => {
		return passive ? observeAnimationFrames(handleFrame) : undefined;
	}, [passive, handleFrame]);

	useEffect(() => {
		onReady({
			setRenderMode: (mode) => context.renderMode.set(mode),
			invalidate: context.invalidate,
			advance: context.advance,
			setTaskActive
		});
	}, [context, onReady, setTaskActive]);

	return null;
}
