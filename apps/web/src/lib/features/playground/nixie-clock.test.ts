import { describe, expect, it } from 'vitest';
import { createNixieClock, readNixieDigits } from '$lib/site/demos/nixie/clock';

describe('Nixie local clock', () => {
	it('uses local calendar fields and preserves leading zeroes', () => {
		const date = new Date(2026, 0, 9, 7, 4, 2);
		expect(readNixieDigits(date, 'time')).toEqual([0, 7, 0, 4, 0, 2]);
		expect(readNixieDigits(date, 'date')).toEqual([0, 9, 0, 1, 2, 6]);
	});

	it('crossfades only changed cathodes and handles the midnight carry atomically', () => {
		const clock = createNixieClock(new Date(2026, 9, 5, 23, 59, 58));
		expect(clock.sample(new Date(2026, 9, 5, 23, 59, 59))).toBe(true);
		expect(clock.state.mix).toEqual([1, 1, 1, 1, 1, 0]);
		expect(clock.state.previous).toEqual([2, 3, 5, 9, 5, 8]);
		clock.advance(0.06);
		expect(clock.state.mix[5]).toBeCloseTo(0.5);
		clock.advance(0.06);
		expect(clock.animating).toBe(false);
		clock.sample(new Date(2026, 9, 6, 0, 0, 0));
		expect(clock.state.digits).toEqual([0, 0, 0, 0, 0, 0]);
		expect(clock.state.previous).toEqual([2, 3, 5, 9, 5, 9]);
		expect(clock.state.mix).toEqual([0, 0, 0, 0, 0, 0]);
		clock.advance(0.12);
		expect(clock.state.mix).toEqual([1, 1, 1, 1, 1, 1]);
		expect(clock.sample(new Date(2026, 9, 6, 0, 0, 0))).toBe(false);
	});

	it('resynchronizes after suspension and switches to the actual local date', () => {
		const clock = createNixieClock(new Date(2026, 0, 31, 21, 2, 3));
		const resumed = new Date(2026, 1, 1, 8, 40, 20);
		clock.sample(resumed);
		expect(clock.state.digits).toEqual([0, 8, 4, 0, 2, 0]);
		clock.advance(0.12);
		clock.toggleMode(resumed);
		expect(clock.mode).toBe('date');
		expect(clock.state.digits).toEqual([0, 1, 0, 2, 2, 6]);
		clock.advance(0.12);
		expect(clock.sample(new Date(2026, 1, 1, 15, 0, 0))).toBe(false);
		clock.toggleMode(new Date(2026, 1, 1, 15, 0, 0));
		expect(clock.state.digits).toEqual([1, 5, 0, 0, 0, 0]);
	});
});
