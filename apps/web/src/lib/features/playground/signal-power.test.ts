import { describe, expect, it } from 'vitest';
import { createSignalPower } from '$lib/site/demos/signal/power';

describe('Signal CRT power envelope', () => {
	it('waits for decoded content before the heater, seed, raster expansion and settling', () => {
		const power = createSignalPower();
		power.advance(10);
		expect(power.state).toEqual({ raster: [1, 1, 0, 0], boot: 0, power: 0, phase: 'waiting' });
		expect(power.animating).toBe(false);
		power.setReady(true);
		expect(power.state.raster).toEqual([1, 1, 0, 0]);
		power.advance(0.1);
		expect(power.state.raster.slice(2)).toEqual([0, 0]);
		power.advance(0.24);
		expect(power.state.raster[0]).toBeCloseTo(1);
		expect(power.state.raster[1]).toBeCloseTo(0.01);
		expect(power.state.raster[2]).toBeCloseTo(0);
		expect(power.state.raster[3]).toBeGreaterThan(0.8);
		power.advance(0.33);
		expect(power.state.raster[1]).toBeCloseTo(1);
		expect(power.state.raster[2]).toBeGreaterThan(0.7);
		power.advance(0.58);
		expect(power.state).toEqual({ raster: [1, 1, 1, 0], boot: 0, power: 1, phase: 'on' });
		expect(power.fullyOn).toBe(true);
		expect(power.animating).toBe(false);
	});

	it('collapses to a horizontal line, then a dot and stops advancing after afterglow', () => {
		const power = createSignalPower();
		power.setReady(true);
		power.advance(2);
		power.setPowered(false);
		expect(power.state.raster).toEqual([1, 1, 1, 0]);
		expect(power.state.power).toBe(0);
		power.advance(0.19);
		expect(power.state.raster[0]).toBe(1);
		expect(power.state.raster[1]).toBeLessThan(0.01);
		expect(power.state.raster[2]).toBe(0);
		expect(power.state.raster[3]).toBeGreaterThan(1);
		power.advance(0.17);
		expect(power.state.raster[0]).toBeCloseTo(0.014);
		power.advance(0.16);
		expect(power.state.raster[3]).toBeCloseTo(0.32);
		power.advance(0.31);
		expect(power.state).toEqual({ raster: [0, 0, 0, 0], boot: 0, power: 0, phase: 'off' });
		expect(power.animating).toBe(false);
		const settled = power.state;
		power.advance(60);
		expect(power.state).toEqual(settled);
	});

	it('retargets rapid reversals from the visible state and finishes the most recent request', () => {
		const power = createSignalPower();
		power.setReady(true);
		for (const step of [0.31, 0.07, 0.42, 0.05, 0.18, 0.08]) {
			power.advance(step);
			const before = power.state;
			power.setPowered(!power.requested);
			expect(power.state.raster).toEqual(before.raster);
			expect(power.state.boot).toBe(before.boot);
		}
		power.setPowered(true);
		power.advance(2);
		expect(power.state).toEqual({ raster: [1, 1, 1, 0], boot: 0, power: 1, phase: 'on' });
	});

	it('does not flash when switched off during the dark heater delay', () => {
		const power = createSignalPower();
		power.setReady(true);
		power.advance(0.05);
		power.setPowered(false);
		for (let i = 0; i < 60; i++) {
			power.advance(1 / 60);
			expect(power.state.raster[2]).toBe(0);
			expect(power.state.raster[3]).toBe(0);
		}
		expect(power.state.phase).toBe('off');
	});

	it('honors a user shutdown before the first frame and can start on a later click', () => {
		const power = createSignalPower();
		power.setPowered(false);
		power.setReady(true);
		power.advance(2);
		expect(power.state.phase).toBe('off');
		expect(power.state.raster[2]).toBe(0);
		power.setPowered(true);
		power.advance(2);
		expect(power.fullyOn).toBe(true);
	});
});
