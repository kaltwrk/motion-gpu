import { cleanup, render } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineMaterial } from '../lib/core/material.js';
import { FragCanvas } from '../lib/react/FragCanvas.js';
import { usePointer, type UsePointerResult } from '../lib/react/use-pointer.js';

vi.mock('../lib/core/runtime-loop.js', () => ({
	createSpektralRuntimeLoop: () => ({ requestFrame: vi.fn(), destroy: vi.fn() })
}));

const material = defineMaterial({
	fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
});

afterEach(cleanup);

describe('React usePointer canvas lifecycle', () => {
	it.each([false, true])('tracks input on first mount and cleans up (StrictMode: %s)', (strict) => {
		const onProbe = vi.fn<(pointer: UsePointerResult) => void>();
		const onMove = vi.fn();
		function Probe() {
			const pointer = usePointer({ onMove });
			useEffect(() => {
				onProbe(pointer);
			}, [pointer]);
			return null;
		}

		const content = (
			<FragCanvas material={material}>
				<Probe />
			</FragCanvas>
		);
		const view = render(strict ? <StrictMode>{content}</StrictMode> : content);
		const canvas = view.container.querySelector('canvas');
		const pointer = onProbe.mock.calls.at(-1)?.[0];
		if (!canvas || !pointer) throw new Error('Missing canvas or pointer');

		canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
		const move = () =>
			canvas.dispatchEvent(
				new PointerEvent('pointermove', {
					bubbles: true,
					pointerId: 1,
					pointerType: 'mouse',
					clientX: 25,
					clientY: 75
				})
			);

		move();
		expect(pointer.state.current.inside).toBe(true);
		expect(pointer.state.current.uv).toEqual([0.25, 0.25]);
		expect(onMove).toHaveBeenCalledTimes(1);

		view.unmount();
		move();
		expect(onMove).toHaveBeenCalledTimes(1);
	});
});
