import { describe, expect, it } from 'vitest';
import worker from './legacy-redirect-worker';

describe('legacy redirect worker', () => {
	it.each([
		[
			'https://motion-gpu.dev/docs/getting-started?from=legacy',
			'https://spektral.madebyhex.com/docs/getting-started?from=legacy'
		],
		['https://www.motion-gpu.dev/playground', 'https://spektral.madebyhex.com/playground'],
		[
			'https://www.spektral.madebyhex.com/docs/render-passes?framework=react',
			'https://spektral.madebyhex.com/docs/render-passes?framework=react'
		],
		[
			'https://preview.motion-gpu.dev/playground/embed?session=test',
			'https://preview.spektral.madebyhex.com/playground/embed?session=test'
		]
	])('redirects %s', (source, target) => {
		const response = worker.fetch(new Request(source));

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe(target);
	});

	it('rejects hosts outside the legacy routes', () => {
		const response = worker.fetch(new Request('https://spektral.madebyhex.com/docs'));

		expect(response.status).toBe(404);
	});
});
