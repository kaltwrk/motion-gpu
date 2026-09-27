import { describe, expect, it } from 'vitest';
import { resolveLegacyRedirect } from './hooks.server';

describe('legacy Spektral redirects', () => {
	it.each(['motion-gpu.dev', 'www.motion-gpu.dev', 'www.spektral.madebyhex.com'])(
		'redirects %s to the canonical site and preserves the request path',
		(host) => {
			const target = resolveLegacyRedirect(
				new URL(`http://${host}/docs/render-passes?framework=react`)
			);

			expect(target?.toString()).toBe(
				'https://spektral.madebyhex.com/docs/render-passes?framework=react'
			);
		}
	);

	it('redirects the legacy preview host to the isolated Spektral preview host', () => {
		const target = resolveLegacyRedirect(
			new URL('https://preview.motion-gpu.dev/playground/embed?session=test')
		);

		expect(target?.toString()).toBe(
			'https://preview.spektral.madebyhex.com/playground/embed?session=test'
		);
	});

	it('does not redirect the canonical Spektral host', () => {
		expect(resolveLegacyRedirect(new URL('https://spektral.madebyhex.com/docs'))).toBeNull();
	});
});
