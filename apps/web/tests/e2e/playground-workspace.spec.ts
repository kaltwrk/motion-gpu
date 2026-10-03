import { expect, test } from '@playwright/test';

test('keeps files, frameworks and demo navigation available in the compact workspace', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto('/playground?framework=svelte');
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();
	const editor = page.getByRole('textbox', { name: 'Source code', exact: true });
	const files = page.getByRole('toolbar', { name: 'Source files' });
	const preview = page.locator('iframe[title="Playground preview"]');

	// File switching keeps edits and makes an offscreen selection reachable in the strip.
	await files.getByRole('button', { name: 'fragment.wgsl', exact: true }).click();
	await editor.press('ControlOrMeta+End');
	await page.keyboard.insertText('\n// Workspace regression check.');
	await files.getByRole('button', { name: 'App.svelte', exact: true }).click();
	await files.getByRole('button', { name: 'fragment.wgsl', exact: true }).click();
	await expect(editor).toContainText('// Workspace regression check.');
	await files.getByRole('button', { name: 'fragment.wgsl', exact: true }).focus();
	await page.keyboard.press('End');
	await expect(files.getByRole('button').last()).toHaveAttribute('aria-pressed', 'true');
	const selectedFile = files.locator('[aria-pressed="true"]');
	await expect(selectedFile).toBeInViewport();
	await selectedFile.focus();
	await page.keyboard.press('Home');
	await expect(files.getByRole('button', { name: 'App.svelte', exact: true })).toBeFocused();

	// Framework changes keep their keyboard focus and update the shareable route.
	const svelte = page.getByRole('radio', { name: 'Switch framework to Svelte' });
	await svelte.focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('radio', { name: 'Switch framework to React' })).toBeFocused();
	await expect(page).toHaveURL(/framework=react/);
	await expect(files.getByRole('button', { name: 'App.tsx', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.keyboard.press('End');
	await expect(page.getByRole('radio', { name: 'Switch framework to Vue' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(page).toHaveURL(/framework=vue/);

	const navigation = page.locator('[data-docs-navigation]');
	await navigation.getByRole('link', { name: 'Diamond', exact: true }).click();
	await expect(page).toHaveURL('/playground/diamond?framework=vue');
	await expect(navigation.getByRole('link', { name: 'Diamond', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(files.getByRole('button', { name: 'App.vue', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.goBack();
	await expect(page).toHaveURL('/playground?framework=vue');
	await expect(
		navigation.getByRole('link', { name: 'Spektral Logo', exact: true })
	).toHaveAttribute('aria-current', 'page');
	await page.goForward();
	await expect(page).toHaveURL('/playground/diamond?framework=vue');
	await page.reload();
	await expect(files.getByRole('button', { name: 'App.vue', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.locator('[data-playground-shell] > header')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Choose demo' })).toHaveCount(0);

	const resize = page.getByRole('button', { name: 'Resize preview panel' });
	const initialWidth = await preview.evaluate((node) => node.clientWidth);
	await resize.focus();
	await resize.press('ArrowLeft');
	await expect
		.poll(() => preview.evaluate((node) => node.clientWidth))
		.toBeGreaterThan(initialWidth);
	await resize.press('Home');
	await expect.poll(() => preview.evaluate((node) => node.clientWidth)).toBe(initialWidth);

	// Framework and file controls should never spawn tooltip UI.
	for (const trigger of [svelte, files.getByRole('button').first()]) {
		await trigger.hover();
		await expect(trigger).not.toHaveAttribute('data-tooltip-trigger');
	}
});

test('fits narrow screens and only offers runtime errors after receiving one', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 740 });
	await page.goto('/playground/spectral-tension?framework=svelte');
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();
	const runtimeErrors = page.getByRole('button', { name: 'Runtime errors', exact: true });
	await expect(runtimeErrors).toHaveCount(0);

	const preview = page.locator('iframe[title="Playground preview"]');
	const initialHeight = await preview.evaluate((node) => node.clientHeight);
	const resize = page.getByRole('button', { name: 'Resize preview panel' });
	await resize.focus();
	await resize.press('ArrowUp');
	await expect
		.poll(() => preview.evaluate((node) => node.clientHeight))
		.toBeGreaterThan(initialHeight);
	await resize.press('Home');
	await expect.poll(() => preview.evaluate((node) => node.clientHeight)).toBe(initialHeight);

	const frame = await (await preview.elementHandle()).contentFrame();
	if (!frame) throw new Error('The preview frame is missing.');
	await frame.evaluate(() => {
		setTimeout(() => {
			throw new Error('Workspace runtime error check');
		}, 0);
	});
	await expect(runtimeErrors).toBeVisible();
	await runtimeErrors.click();
	await expect(page.getByRole('region', { name: 'Runtime errors', exact: true })).toContainText(
		'Workspace runtime error check'
	);
	await runtimeErrors.click();
	await expect(page.getByRole('region', { name: 'Runtime errors', exact: true })).toHaveCount(0);

	for (const width of [320, 390, 640, 768, 1024]) {
		await page.setViewportSize({ width, height: 740 });
		expect(
			await page.evaluate(() => ({
				width: document.documentElement.scrollWidth <= innerWidth,
				height: document.documentElement.scrollHeight <= innerHeight
			}))
		).toEqual({ width: true, height: true });
		const bounds = await page.locator('[data-app-shell]').boundingBox();
		expect(bounds).toEqual({ x: 4, y: 4, width: width - 8, height: 732 });
		const frameBounds = await preview.boundingBox();
		const switcher = page.getByRole('radiogroup', { name: 'Framework', exact: true });
		const switcherBounds = await switcher.boundingBox();
		if (!frameBounds || !switcherBounds) throw new Error('Preview controls are missing.');
		expect(Math.abs(switcherBounds.y - frameBounds.y - 12)).toBeLessThanOrEqual(1);
		expect(
			Math.abs(frameBounds.x + frameBounds.width - switcherBounds.x - switcherBounds.width - 12)
		).toBeLessThanOrEqual(1);
		await expect(switcher).toBeInViewport();
	}
	await page.screenshot({ path: 'test-results/playground-sidebar-preview-switcher.png' });
});
