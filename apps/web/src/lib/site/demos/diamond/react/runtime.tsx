import { useFrame, usePointer } from 'spektral/react';

export default function Runtime() {
	const MAX_ORBIT_X = 0.8;
	const MAX_ORBIT_Y = 0.8;
	const FOLLOW_STRENGTH = 12.0;
	const RETURN_STRENGTH = 7.0;

	let desiredX = 0;
	let desiredY = 0;
	let orbitX = 0;
	let orbitY = 0;

	const pointer = usePointer({
		onMove: (state) => {
			if (!state.inside) {
				return;
			}
			desiredX = state.ndc[0] * MAX_ORBIT_X;
			desiredY = state.ndc[1] * MAX_ORBIT_Y;
		}
	});

	useFrame((frame) => {
		const pointerState = pointer.state.current;
		const active = pointerState.inside || pointerState.pressed;
		if (!active) {
			desiredX = 0;
			desiredY = 0;
		}

		const stiffness = active ? FOLLOW_STRENGTH : RETURN_STRENGTH;
		const smoothing = 1.0 - Math.exp(-stiffness * frame.delta);

		orbitX += (desiredX - orbitX) * smoothing;
		orbitY += (desiredY - orbitY) * smoothing;

		frame.setUniform('uOrbit', [orbitX, orbitY]);
	});

	return null;
}
