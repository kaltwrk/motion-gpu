import { expect, test } from '@playwright/test';

test('recovers from a failed controller import without leaving a blank page', async ({ page }) => {
	const unhandledErrors: string[] = [];
	page.on('pageerror', (error) => unhandledErrors.push(error.message));
	const controllerUrl = '**/src/lib/features/playground/playground-controller.svelte.ts*';
	await page.route(controllerUrl, (route) => route.abort('failed'));

	await page.goto('/playground?framework=svelte');
	await expect(page.getByRole('alert')).toContainText('The playground could not load');
	expect(unhandledErrors).toEqual([]);

	await page.unroute(controllerUrl);
	await page.getByRole('button', { name: 'Reload playground', exact: true }).click();
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();
	await expect(page.locator('iframe[title="Playground preview"]')).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(unhandledErrors).toEqual([]);
});
