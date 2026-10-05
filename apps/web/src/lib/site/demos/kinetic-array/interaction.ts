import type { FrameState } from 'spektral';
import { projectKineticPointer } from './geometry';

type KineticPointer = { uv: [number, number]; inside: boolean; pressed: boolean };

/** CPU input is one vec4; all pin positions and velocities remain GPU-owned. */
export function createKineticInteraction() {
	let position: [number, number] = [0, 0];
	let force = 0;
	let active = false;
	let pendingTap: [number, number] | null = null;
	let lastWritten = new Float32Array(4);

	return {
		pointerOptions: {
			capturePointer: true,
			trackWhilePressedOutsideCanvas: true,
			requestFrame: 'none' as const,
			clickEnabled: false,
			onDown(pointer: KineticPointer, event: PointerEvent) {
				// Queue the press itself so a quick down/up between two frames is not lost.
				if (event.button === 0) pendingTap = [...pointer.uv];
			},
			onUp(_pointer: KineticPointer, event: PointerEvent) {
				if (event.type === 'pointercancel') pendingTap = null;
			}
		},
		update(frame: FrameState, pointer: KineticPointer) {
			const delta = Number.isFinite(frame.delta) ? Math.max(0, Math.min(frame.delta, 1 / 30)) : 0;
			frame.setUniform('uStep', delta);
			const { width, height } = frame.canvas;
			const target = pointer.inside ? projectKineticPointer(pointer.uv, width, height) : null;
			const tap = pendingTap ? projectKineticPointer(pendingTap, width, height) : null;
			pendingTap = null;
			const follow = 1 - Math.exp(-delta * 18);
			const smooth = (current: number, desired: number) => {
				const next = current + (desired - current) * follow;
				return Math.abs(next - desired) < 0.0002 ? desired : next;
			};
			if (target) {
				position = active
					? [smooth(position[0], target[0]), smooth(position[1], target[1])]
					: target;
				force = smooth(force, pointer.pressed ? 1 : 0.35);
			} else {
				position = [0, 0];
				force = 0;
			}
			active = target !== null;
			// A valid queued tap keeps its original board position even after a quick release.
			const input = new Float32Array([
				tap?.[0] ?? position[0],
				tap?.[1] ?? position[1],
				force,
				tap ? 1 : 0
			]);
			if (input.some((value, index) => value !== lastWritten[index])) {
				frame.writeStorageBuffer('interaction', input);
				lastWritten = input;
			}
		}
	};
}
