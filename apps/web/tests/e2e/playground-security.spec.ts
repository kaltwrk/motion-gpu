import { expect, test } from '@playwright/test';

type AccessResult =
	| { ok: true; value: unknown }
	| { ok: false; errorName: string; message: string };

test('enforces an opaque origin from response CSP without an iframe sandbox attribute', async ({
	page
}) => {
	await page.goto('/');
	const previewUrl = new URL('/playground/embed', page.url());
	previewUrl.searchParams.set('session', 'response-sandbox-probe');
	previewUrl.searchParams.set('parent_origin', new URL(page.url()).origin);

	const result = await page.evaluate(
		(src) =>
			new Promise<{
				sandboxAttribute: string | null;
				messageOrigin: string;
				parentDocument: AccessResult;
			}>((resolve, reject) => {
				const probe = document.createElement('iframe');
				probe.src = src;
				let timeoutId = 0;

				function cleanup() {
					window.clearTimeout(timeoutId);
					window.removeEventListener('message', onMessage);
					probe.remove();
				}

				function onMessage(event: MessageEvent) {
					const data: unknown = event.data;
					if (
						event.source !== probe.contentWindow ||
						typeof data !== 'object' ||
						data === null ||
						!('action' in data) ||
						data.action !== 'ready'
					) {
						return;
					}

					let parentDocument: AccessResult;
					try {
						parentDocument = {
							ok: true,
							value: Boolean(probe.contentWindow?.document.body)
						};
					} catch (error) {
						parentDocument = {
							ok: false,
							errorName: error instanceof Error ? error.name : 'UnknownError',
							message: error instanceof Error ? error.message : String(error)
						};
					}

					const sandboxAttribute = probe.getAttribute('sandbox');
					cleanup();
					resolve({ sandboxAttribute, messageOrigin: event.origin, parentDocument });
				}

				window.addEventListener('message', onMessage);
				timeoutId = window.setTimeout(() => {
					cleanup();
					reject(new Error('Response-sandboxed preview did not become ready.'));
				}, 10_000);
				document.body.append(probe);
			}),
		previewUrl.toString()
	);

	expect(result.sandboxAttribute).toBeNull();
	expect(result.messageOrigin).toBe('null');
	expect(result.parentDocument.ok).toBe(false);
	if (!result.parentDocument.ok) {
		expect(result.parentDocument.errorName).toBe('SecurityError');
	}
});

test('isolates preview storage and DOM while keeping the message protocol operational', async ({
	page
}) => {
	await page.goto('/');
	await page.evaluate(() => {
		document.cookie = 'spektral_parent_secret=cookie-value; path=/; Secure; SameSite=Strict';
		localStorage.setItem('spektral-parent-secret', 'storage-value');
	});

	await page.goto('/playground');
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();

	const iframe = page.locator('iframe[title="Playground preview"]');
	await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-popups');
	const iframeHandle = await iframe.elementHandle();
	const previewFrame = await iframeHandle.contentFrame();
	expect(previewFrame).not.toBeNull();
	if (!previewFrame) {
		throw new Error('Playground preview frame was not created.');
	}

	const access = await previewFrame.evaluate(() => {
		const attempt = (read: () => unknown): AccessResult => {
			try {
				return { ok: true, value: read() };
			} catch (error) {
				return {
					ok: false,
					errorName: error instanceof Error ? error.name : 'UnknownError',
					message: error instanceof Error ? error.message : String(error)
				};
			}
		};

		return {
			origin: self.origin,
			parentDocument: attempt(() => Boolean(parent.document.body)),
			parentCookie: attempt(() => parent.document.cookie),
			parentStorage: attempt(() => parent.localStorage.getItem('spektral-parent-secret')),
			previewCookie: attempt(() => document.cookie),
			previewStorage: attempt(() => localStorage.getItem('spektral-parent-secret')),
			canvasCount: document.querySelectorAll('canvas').length
		};
	});

	expect(access.origin).toBe('null');
	for (const result of [
		access.parentDocument,
		access.parentCookie,
		access.parentStorage,
		access.previewCookie,
		access.previewStorage
	]) {
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errorName).toBe('SecurityError');
		}
	}
	expect(access.canvasCount).toBeGreaterThan(0);

	const previewSrc = await iframe.getAttribute('src');
	expect(previewSrc).not.toBeNull();
	if (!previewSrc) {
		throw new Error('Playground preview URL is missing.');
	}
	const previewUrl = new URL(previewSrc, page.url()).toString();
	const embedResponse = await page.request.get(previewUrl);
	expect(embedResponse.status()).toBe(200);
	expect(embedResponse.headers()['content-security-policy']).toContain("script-src 'nonce-");
	expect(embedResponse.headers()['content-security-policy']).toContain(
		'sandbox allow-scripts allow-popups'
	);
	expect(embedResponse.headers()['content-security-policy']).toContain(
		`frame-ancestors ${new URL(page.url()).origin}`
	);
	expect(embedResponse.headers()['permissions-policy']).toContain('camera=()');
});
