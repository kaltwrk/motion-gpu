import { expect, test } from '@playwright/test';

test('streams origin-clean video into an opaque playground preview', async ({ page }) => {
	const mediaResponsePromise = page.waitForResponse((response) =>
		response.url().endsWith('/playground-media/data-mosh-neon-dancer.webm')
	);

	await page.goto('/playground/data-mosh?framework=svelte');
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();

	const mediaResponse = await mediaResponsePromise;
	expect(mediaResponse.status()).toBeLessThan(400);
	expect(await mediaResponse.headerValue('content-type')).toContain('video/webm');
	expect(await mediaResponse.request().headerValue('origin')).toBe('null');
	expect(await mediaResponse.headerValue('access-control-allow-origin')).toBe('*');
	await expect(mediaResponse.finished()).resolves.toBeNull();

	const iframeHandle = await page.locator('iframe[title="Playground preview"]').elementHandle();
	const previewFrame = await iframeHandle.contentFrame();
	expect(previewFrame).not.toBeNull();
	if (!previewFrame) {
		throw new Error('Playground preview frame was not created.');
	}

	const canvas = previewFrame.locator('canvas');
	await expect(canvas).toBeVisible();
	const initialFrame = await canvas.screenshot();
	await expect
		.poll(async () => !(await canvas.screenshot()).equals(initialFrame), { timeout: 30_000 })
		.toBe(true);
	await expect(
		previewFrame.getByText(
			/Video element is tainted by cross-origin data|Cross origin external images are not allowed/i
		)
	).toHaveCount(0);
});
