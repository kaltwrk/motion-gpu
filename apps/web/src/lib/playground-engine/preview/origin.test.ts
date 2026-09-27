import { describe, expect, it } from 'vitest';
import { isLocalPreviewParent, resolvePreviewOrigin } from './origin';

describe('playground preview origin', () => {
	it('uses a different loopback site on the same development port', () => {
		expect(resolvePreviewOrigin('http://localhost:5173', undefined, true)).toBe(
			'http://127.0.0.1:5173'
		);
		expect(resolvePreviewOrigin('http://127.0.0.1:4178', undefined, true)).toBe(
			'http://localhost:4178'
		);
	});

	it('preserves a configured preview origin', () => {
		expect(
			resolvePreviewOrigin(
				'http://localhost:5173',
				' https://preview.spektral.madebyhex.com/playground/embed ',
				true
			)
		).toBe('https://preview.spektral.madebyhex.com');
	});

	it.each(['invalid', 'javascript:alert(1)', 'data:text/html,hello'])(
		'falls back to the local preview for an invalid configured origin: %s',
		(configured) => {
			expect(resolvePreviewOrigin('http://localhost:5173', configured, true)).toBe(
				'http://127.0.0.1:5173'
			);
		}
	);

	it.each([
		['https://spektral.madebyhex.com', false],
		['http://localhost:5173', false],
		['http://192.168.1.2:5173', true],
		['https://localhost:5173', true]
	] as const)('keeps %s unchanged outside HTTP loopback development', (origin, development) => {
		expect(resolvePreviewOrigin(origin, undefined, development)).toBe(origin);
	});

	it('recognizes only loopback parents on the same HTTP port', () => {
		expect(isLocalPreviewParent('http://localhost:5173', 'http://127.0.0.1:5173')).toBe(true);
		expect(isLocalPreviewParent('http://127.0.0.1:4178', 'http://localhost:4178')).toBe(true);
		for (const parent of [
			'http://localhost:9999',
			'https://localhost:5173',
			'http://localhost.example:5173',
			'http://192.168.1.2:5173'
		]) {
			expect(isLocalPreviewParent(parent, 'http://127.0.0.1:5173')).toBe(false);
		}
	});
});
