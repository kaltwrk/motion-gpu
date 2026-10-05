import { expect, test } from '@playwright/test';

test('serves texture assets to opaque previews without opening application routes to CORS', async ({
	request
}) => {
	for (const filename of ['albedo.jpg', 'normal.jpg', 'roughness.jpg', 'height.png', 'ao.jpg']) {
		const response = await request.get(`/playground-media/obsidian/${filename}`, {
			headers: { Origin: 'null' }
		});
		expect(response.ok()).toBe(true);
		expect(response.headers()['access-control-allow-origin']).toBe('*');
		expect(response.headers()['cross-origin-resource-policy']).toBe('cross-origin');
		expect(response.headers()['content-type']).toMatch(/^image\/(jpeg|png)/);
	}

	const applicationPage = await request.get('/', { headers: { Origin: 'null' } });
	expect(applicationPage.ok()).toBe(true);
	expect(applicationPage.headers()['access-control-allow-origin']).toBeUndefined();
});
