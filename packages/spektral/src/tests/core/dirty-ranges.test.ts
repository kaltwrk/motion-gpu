import { describe, expect, it } from 'vitest';
import { findDirtyFloatRanges } from '../../lib/core/renderer';

describe('findDirtyFloatRanges', () => {
	it('returns empty array for identical buffers', () => {
		const a = new Float32Array([1, 2, 3, 4]);
		const b = new Float32Array([1, 2, 3, 4]);
		expect(findDirtyFloatRanges(a, b)).toEqual([]);
	});

	it('returns single range for one changed float', () => {
		const a = new Float32Array([0, 0, 0, 0]);
		const b = new Float32Array([0, 1, 0, 0]);
		expect(findDirtyFloatRanges(a, b)).toEqual([{ start: 1, count: 1 }]);
	});

	it('returns single range for contiguous dirty floats', () => {
		const a = new Float32Array([0, 0, 0, 0, 0, 0]);
		const b = new Float32Array([0, 1, 2, 3, 0, 0]);
		expect(findDirtyFloatRanges(a, b)).toEqual([{ start: 1, count: 3 }]);
	});

	it('returns single range when trailing floats are dirty', () => {
		const a = new Float32Array([0, 0, 0, 0]);
		const b = new Float32Array([0, 0, 1, 2]);
		expect(findDirtyFloatRanges(a, b)).toEqual([{ start: 2, count: 2 }]);
	});

	it('merges two dirty ranges separated by a small gap', () => {
		//                                  0  1  2  3  4  5  6  7
		const a = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]);
		const b = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]);
		// index 0 dirty, index 4 dirty, gap = 3 (<= 4 threshold) → merge
		expect(findDirtyFloatRanges(a, b, 4)).toEqual([{ start: 0, count: 5 }]);
	});

	it('merges two dirty ranges with gap exactly at threshold', () => {
		//                                  0  1  2  3  4  5  6  7  8  9
		const a = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		const b = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
		// index 0 dirty, index 5 dirty, gap = 4 (== threshold) → merge
		expect(findDirtyFloatRanges(a, b)).toEqual([{ start: 0, count: 6 }]);
	});

	it('keeps separate ranges when gap exceeds threshold', () => {
		//                                  0  1  2  3  4  5  6  7  8  9
		const a = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		const b = new Float32Array([1, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
		// index 0 dirty, index 6 dirty, gap = 5 (> 4 threshold) → separate
		expect(findDirtyFloatRanges(a, b, 4)).toEqual([
			{ start: 0, count: 1 },
			{ start: 6, count: 1 }
		]);
	});

	it('merges three close ranges into one', () => {
		const a = new Float32Array(16).fill(0);
		const b = new Float32Array(16).fill(0);
		b[0] = 1;
		b[4] = 1;
		b[8] = 1;
		// gaps of 3 between each → all merge
		expect(findDirtyFloatRanges(a, b)).toEqual([{ start: 0, count: 9 }]);
	});

	it('handles all-dirty buffer as single range', () => {
		const a = new Float32Array([0, 0, 0, 0]);
		const b = new Float32Array([1, 2, 3, 4]);
		expect(findDirtyFloatRanges(a, b)).toEqual([{ start: 0, count: 4 }]);
	});

	it.each([9, 32, 128])('collapses %i fragmented writes into one complete upload', (changes) => {
		const previous = new Float32Array(changes * 8);
		const next = previous.slice();
		for (let i = 0; i < changes; i++) next[i * 8] = i + 1;
		expect(findDirtyFloatRanges(previous, next)).toEqual([{ start: 0, count: next.length }]);
	});

	it('preserves eight sparse ranges and exact values when replaying upload ranges', () => {
		const previous = new Float32Array(64);
		const next = previous.slice();
		for (let i = 0; i < 8; i++) next[i * 8] = i + 1;
		const ranges = findDirtyFloatRanges(previous, next);
		expect(ranges).toHaveLength(8);
		for (const range of ranges)
			previous.set(next.subarray(range.start, range.start + range.count), range.start);
		expect(previous).toEqual(next);
	});

	it('handles empty buffers', () => {
		const a = new Float32Array(0);
		const b = new Float32Array(0);
		expect(findDirtyFloatRanges(a, b)).toEqual([]);
	});
});
