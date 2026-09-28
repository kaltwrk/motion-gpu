import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const proofUrl = `/@fs${fileURLToPath(new URL('../renderer-proof.ts', import.meta.url))}`;

test.beforeEach(async ({ page }) => {
	await page.route('**/renderer-proof', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
	);
	await page.goto('/renderer-proof');
});

test('feedback passes and the scene read their own resolution after submission', async ({
	page
}) => {
	const pixel = await page.evaluate(async (url) => {
		const proof: typeof import('../renderer-proof') = await import(/* @vite-ignore */ url);
		return proof.readFeedbackResolution();
	}, proofUrl);
	expect(pixel).toEqual([64, 128, 255, 255]);
});
