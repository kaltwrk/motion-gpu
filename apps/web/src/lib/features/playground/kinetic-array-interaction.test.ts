import { describe, expect, it, vi } from 'vitest';
import type { FrameState } from 'spektral';
import { projectKineticPointer } from '$lib/site/demos/kinetic-array/geometry';
import { createKineticInteraction } from '$lib/site/demos/kinetic-array/interaction';

type Pointer = { uv: [number, number]; inside: boolean; pressed: boolean };
// Projections of known board points after the 0.84 object scale through the shared camera at 800 × 600.
const center: Pointer = { uv: [0.5, 0.5983024633747307], inside: true, pressed: false };
const offset: Pointer = {
	uv: [0.6309171348936182, 0.584846934294463],
	inside: true,
	pressed: false
};
const caseEdge: Pointer = {
	uv: [0.7316391961134943, 0.5071107017266283],
	inside: true,
	pressed: false
};
const outside: Pointer = { uv: [0, 0], inside: false, pressed: false };
const down = { button: 0, type: 'pointerdown' } as PointerEvent;
const up = { button: 0, type: 'pointerup' } as PointerEvent;

function setup() {
	const frame = {
		time: 0,
		delta: 1 / 60,
		canvas: { width: 800, height: 600 } as HTMLCanvasElement,
		renderMode: 'always',
		autoRender: true,
		setUniform: vi.fn(),
		setTexture: vi.fn(),
		writeStorageBuffer: vi.fn(),
		readStorageBuffer: vi.fn(async () => new ArrayBuffer(0)),
		invalidate: vi.fn(),
		advance: vi.fn()
	} satisfies FrameState;
	const interaction = createKineticInteraction();
	const tick = (pointer: Pointer, count = 1) => {
		for (let i = 0; i < count; i++) interaction.update(frame, pointer);
	};
	const writes = () =>
		frame.writeStorageBuffer.mock.calls.map(([name, value]) => ({
			name,
			values: Array.from(value as Float32Array)
		}));
	return { frame, interaction, tick, writes };
}

describe('Kinetic Array pointer projection', () => {
	it('matches the rest plane, scales with aspect ratio and excludes the case outside the pin grid', () => {
		const point = projectKineticPointer(center.uv, 800, 600)!;
		expect(point[0]).toBeCloseTo(0, 6);
		expect(point[1]).toBeCloseTo(0, 6);
		const displaced = projectKineticPointer(offset.uv, 800, 600)!;
		expect(displaced[0]).toBeCloseTo(0.58, 6);
		expect(displaced[1]).toBeCloseTo(-0.29, 6);
		const wideUv: [number, number] = [0.5 + (offset.uv[0] - 0.5) * 0.5, offset.uv[1]];
		expect(projectKineticPointer(wideUv, 1600, 600)).toEqual(displaced);
		expect(projectKineticPointer(caseEdge.uv, 800, 600)).toBeNull();
		expect(projectKineticPointer([0.35878598273644646, 0.5082507323445676], 800, 600)).toBeNull();
		expect(projectKineticPointer(center.uv, 0, 0)).toBeNull();
	});
});

describe('Kinetic Array CPU input', () => {
	it('preserves a tap released between frames and clears its impulse on the following frame', () => {
		const { interaction, frame, tick, writes } = setup();
		interaction.pointerOptions.onDown(offset, down);
		interaction.pointerOptions.onUp(offset, up);
		tick(outside);
		const first = writes()[0]!;
		expect(first.name).toBe('interaction');
		expect(first.values[0]).toBeCloseTo(0.58);
		expect(first.values[1]).toBeCloseTo(-0.29);
		expect(first.values.slice(2)).toEqual([0, 1]);
		tick(outside);
		expect(writes()[1]!.values).toEqual([0, 0, 0, 0]);
		tick(outside, 20);
		expect(writes()).toHaveLength(2);
		expect(frame.readStorageBuffer).not.toHaveBeenCalled();
	});

	it('applies sustained pressure without repeating the impulse, then clears force outside the matrix', () => {
		const { interaction, tick, writes } = setup();
		const held = { ...center, pressed: true };
		interaction.pointerOptions.onDown(held, down);
		tick(held, 60);
		expect(writes().filter((write) => write.values[3] === 1)).toHaveLength(1);
		expect(writes().at(-1)!.values.slice(2)).toEqual([1, 0]);
		interaction.pointerOptions.onUp(center, up);
		tick(center, 60);
		expect(writes().at(-1)!.values[2]).toBeCloseTo(0.35);
		expect(writes().at(-1)!.values[3]).toBe(0);
		tick({ ...caseEdge, pressed: true });
		expect(writes().at(-1)!.values).toEqual([0, 0, 0, 0]);
		const count = writes().length;
		tick({ ...caseEdge, pressed: true }, 20);
		expect(writes()).toHaveLength(count);
	});

	it('ignores presses on the case, cancelled taps and non-primary buttons', () => {
		const { interaction, tick, writes } = setup();
		interaction.pointerOptions.onDown(caseEdge, down);
		tick({ ...caseEdge, pressed: true });
		interaction.pointerOptions.onDown(center, down);
		interaction.pointerOptions.onUp(center, { type: 'pointercancel' } as PointerEvent);
		tick(outside);
		interaction.pointerOptions.onDown(center, { button: 2 } as PointerEvent);
		tick(outside);
		expect(writes()).toHaveLength(0);
	});

	it('stops rewriting settled input and caps simulation time after a delayed frame', () => {
		const { frame, tick, writes } = setup();
		tick(center, 60);
		expect(writes().at(-1)!.values[2]).toBeCloseTo(0.35);
		frame.writeStorageBuffer.mockClear();
		tick(center, 20);
		expect(frame.writeStorageBuffer).not.toHaveBeenCalled();
		frame.delta = 5;
		tick(center);
		expect(frame.setUniform).toHaveBeenLastCalledWith('uStep', 1 / 30);
		frame.delta = -1;
		tick(center);
		expect(frame.setUniform).toHaveBeenLastCalledWith('uStep', 0);
		expect(frame.readStorageBuffer).not.toHaveBeenCalled();
	});
});
