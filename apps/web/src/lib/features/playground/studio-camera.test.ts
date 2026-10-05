import { describe, expect, it } from 'vitest';
import { projectToStudioPlane, studioCamera } from '$lib/site/demo-shared/camera';

describe('shared studio pointer projection', () => {
	it('the optical axis intersects the target at every aspect ratio', () => {
		for (const [width, height] of [
			[800, 600],
			[390, 844],
			[1920, 1080]
		]) {
			const projected = projectToStudioPlane([0.5, 0.5], width!, height!, studioCamera.target[1]);
			expect(projected[0]).toBeCloseTo(studioCamera.target[0], 10);
			expect(projected[1]).toBeCloseTo(studioCamera.target[2], 10);
		}
	});

	it('backing-store density does not change the point beneath the pointer', () => {
		const low = projectToStudioPlane([0.67, 0.38], 800, 600, 0.135);
		const high = projectToStudioPlane([0.67, 0.38], 1600, 1200, 0.135);
		expect(high[0]).toBeCloseTo(low[0], 10);
		expect(high[1]).toBeCloseTo(low[1], 10);
	});

	it('handles near-horizontal rays and zero-sized initialization without NaN', () => {
		for (const [width, height] of [
			[0, 0],
			[100, 2000]
		]) {
			const point = projectToStudioPlane([1, 1], width!, height!, 0.135);
			expect(point.every(Number.isFinite)).toBe(true);
		}
	});
});
