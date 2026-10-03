import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const environment = vi.hoisted(() => ({ dev: false }));
vi.mock('$app/environment', () => environment);
afterEach(() => {
	environment.dev = false;
});

vi.mock('$env/dynamic/private', () => ({
	env: {
		PLAYGROUND_PREVIEW_PARENT_ORIGINS: 'https://spektral.madebyhex.com'
	}
}));

/**
 * Invokes the preview endpoint with a complete URL for focused handler tests.
 */
const request = (query: string) =>
	GET({
		url: new URL(`https://preview.spektral.madebyhex.com/playground/embed?${query}`)
	} as Parameters<typeof GET>[0]);

describe('playground preview endpoint', () => {
	it('returns an isolated preview document with nonce-bound security headers', async () => {
		const response = await request(
			'session=9ecf96ad-81fb-4507-8f69-79bc28ca731d&parent_origin=https%3A%2F%2Fspektral.madebyhex.com'
		);
		const html = await response.text();
		const nonce = html.match(/<script nonce="([a-f0-9]+)">/)?.[1];

		expect(response.status).toBe(200);
		expect(nonce).toBeTruthy();
		expect(response.headers.get('content-security-policy')).toContain(
			`script-src 'nonce-${nonce}' 'unsafe-eval'`
		);
		expect(response.headers.get('content-security-policy')).toContain(
			'frame-ancestors https://spektral.madebyhex.com'
		);
		expect(response.headers.get('content-security-policy')).toContain(
			'sandbox allow-scripts allow-popups'
		);
		expect(response.headers.get('permissions-policy')).toContain('camera=()');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
		expect(response.headers.get('origin-agent-cluster')).toBe('?1');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(html).toContain("if (self.origin !== 'null')");
	});

	it('keeps same-origin preview available without an allowlist entry', async () => {
		const response = await request(
			'session=same-origin-preview&parent_origin=https%3A%2F%2Fpreview.spektral.madebyhex.com'
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-security-policy')).toContain(
			'frame-ancestors https://preview.spektral.madebyhex.com'
		);
	});

	it('allows the paired loopback origin only in development', async () => {
		const url = new URL(
			'http://127.0.0.1:5173/playground/embed?session=local-preview&parent_origin=http%3A%2F%2Flocalhost%3A5173'
		);
		const event = { url } as Parameters<typeof GET>[0];
		expect((await GET(event)).status).toBe(400);
		environment.dev = true;
		const response = await GET(event);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-security-policy')).toContain(
			'frame-ancestors http://localhost:5173'
		);
	});

	it.each([
		['missing session', 'parent_origin=https%3A%2F%2Fspektral.madebyhex.com'],
		[
			'injectable session',
			'session=%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E&parent_origin=https%3A%2F%2Fspektral.madebyhex.com'
		],
		['missing parent', 'session=valid-session'],
		['non-HTTP parent', 'session=valid-session&parent_origin=javascript%3Aalert(1)'],
		['unlisted parent', 'session=valid-session&parent_origin=https%3A%2F%2Fexternal.example']
	])('rejects %s', async (_label, query) => {
		const response = await request(query);

		expect(response.status).toBe(400);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});
