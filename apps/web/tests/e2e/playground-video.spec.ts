import { expect, test } from '@playwright/test';

test('serves video with CORS headers for the opaque playground origin', async ({ page }) => {
	const mediaResponsePromise = page.waitForResponse((response) =>
		response.url().endsWith('/playground-media/data-mosh-neon-dancer.webm')
	);

	await page.goto('/playground/data-mosh?framework=svelte');

	const mediaResponse = await mediaResponsePromise;
	expect(mediaResponse.status()).toBeLessThan(400);
	expect(await mediaResponse.headerValue('content-type')).toContain('video/webm');
	expect(await mediaResponse.request().headerValue('origin')).toBe('null');
	expect(await mediaResponse.headerValue('access-control-allow-origin')).toBe('*');
	await expect(mediaResponse.finished()).resolves.toBeNull();
});
