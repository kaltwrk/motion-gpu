import { useEffect, useRef } from 'react';
import { useFrame, useSpektral, usePointer, type ComputePass } from 'spektral/react';

const FRAME_ID_LIMIT = 16_000_000;

interface RuntimeProps {
	clearDensity: ComputePass;
	simulate: ComputePass;
}

export default function Runtime({ clearDensity, simulate }: RuntimeProps) {
	const context = useSpektral();
	const animationRef = useRef({
		targetRotateY: 0,
		targetRotateX: 0,
		smoothRotateY: 0,
		smoothRotateX: 0,
		autoRotateY: 0,
		frameId: 0
	});

	const pointer = usePointer({
		onDown: () => {
			const canvas = context.canvas;
			if (canvas) {
				canvas.style.cursor = 'grabbing';
			}
		},
		onUp: () => {
			const canvas = context.canvas;
			if (canvas) {
				canvas.style.cursor = 'grab';
			}
		}
	});

	useEffect(() => {
		const canvas = context.canvas;
		if (!canvas) return;

		canvas.style.cursor = 'grab';

		return () => {
			canvas.style.cursor = '';
		};
	}, []);

	useFrame((state) => {
		const animation = animationRef.current;
		animation.frameId += 1;
		const resetDensity = animation.frameId >= FRAME_ID_LIMIT;
		clearDensity.enabled = resetDensity;
		simulate.enabled = !resetDensity;
		if (resetDensity) animation.frameId = 0;

		const pointerState = pointer.state.current;
		if (pointerState.pressed && pointerState.dragging) {
			animation.targetRotateY += pointerState.deltaPx[0] * -0.005;
			animation.targetRotateX += pointerState.deltaPx[1] * -0.005;
			animation.targetRotateX = Math.max(-1.1, Math.min(1.1, animation.targetRotateX));
		}

		animation.autoRotateY += state.delta * 0.24;

		animation.smoothRotateY += (animation.targetRotateY - animation.smoothRotateY) * 0.14;
		animation.smoothRotateX += (animation.targetRotateX - animation.smoothRotateX) * 0.14;

		state.setUniform('uRotateY', animation.autoRotateY + animation.smoothRotateY);
		state.setUniform('uRotateX', animation.smoothRotateX);
		state.setUniform('uFrameId', animation.frameId);
	});

	return null;
}
