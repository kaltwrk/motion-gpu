import { expect, test } from '@playwright/test';

const desktop = { width: 1440, height: 960 };

test('all documentation routes render with the new shell and preserve raw Markdown', async ({
	page,
	request
}) => {
	await page.setViewportSize(desktop);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/docs');
	await expect(page.locator('#docs-content-container')).toBeVisible();
	const links = await page
		.locator('[data-docs-navigation] a')
		.evaluateAll((elements) => elements.map((element) => element.getAttribute('href') ?? ''));
	expect(links).toHaveLength(27);
	for (const href of links) {
		const response = await page.goto(href);
		await expect(page.locator('#docs-content-container')).toBeVisible();
		expect(response?.status(), href).toBe(200);
		await expect(page.locator('#docs-content h1'), href).toHaveCount(1);
		await expect(page.locator('[data-doc-content]'), href).toBeVisible();
		await expect(page.locator(`[data-docs-navigation] a[href="${href}"]`)).toHaveAttribute(
			'aria-current',
			'page'
		);
		const raw = await request.get(
			href.replace('/docs', '/docs/raw') + (href === '/docs' ? '/index' : '')
		);
		expect(raw.status(), href).toBe(200);
		expect(raw.headers()['content-type']).toContain('text/markdown');
	}
	expect(errors).toEqual([]);
});

test('TOC follows the docs scroll container and document navigation resets scroll', async ({
	page
}) => {
	await page.setViewportSize(desktop);
	await page.goto('/docs');
	await expect(page.locator('#docs-content-container')).toBeVisible();
	await page
		.getByRole('navigation', { name: 'On this page' })
		.getByRole('link', { name: 'Shader contracts', exact: true })
		.click();
	await expect(page).toHaveURL(/#shader-contracts$/);
	await expect
		.poll(() => page.locator('#docs-content-container').evaluate((node) => node.scrollTop))
		.toBeGreaterThan(200);
	await expect
		.poll(() =>
			page.locator('#shader-contracts').evaluate((node) => node.getBoundingClientRect().top)
		)
		.toBeLessThan(250);
	await expect(page.locator('#docs-toc-sidebar')).toBeVisible();
	await page
		.locator('[data-docs-navigation]')
		.getByRole('link', { name: 'Introduction', exact: true })
		.click();
	await expect(page).toHaveURL('/docs/getting-started');
	await expect
		.poll(() => page.locator('#docs-content-container').evaluate((node) => node.scrollTop))
		.toBe(0);
});

test('TOC stays visible and has no hide control or keyboard shortcut', async ({ page }) => {
	await page.setViewportSize(desktop);
	await page.goto('/docs');
	const sidebar = page.locator('[data-sidebar="trigger"]');
	const toc = page.locator('#docs-toc-sidebar');
	await expect(sidebar).toHaveAttribute('aria-expanded', 'true');
	await expect(toc).toBeVisible();
	await expect(page.getByRole('button', { name: /(?:Hide|Show) table of contents/ })).toHaveCount(
		0
	);
	await expect(page.locator('[data-mobile-toc-trigger]')).toHaveCount(0);

	for (const modifier of ['Meta', 'Control']) {
		await page.keyboard.press(`${modifier}+Shift+b`);
		await expect(toc).toBeVisible();
		await expect(sidebar).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.press(`${modifier}+b`);
		await expect(sidebar).toHaveAttribute('aria-expanded', 'false');
		await expect(toc).toBeVisible();
		await page.keyboard.press(`${modifier}+b`);
		await expect(sidebar).toHaveAttribute('aria-expanded', 'true');
	}
	await page.keyboard.press('Escape');
	await expect(toc).toBeVisible();
});

test('article and sticky TOC share a scrollbar at the outer edge', async ({ page }) => {
	await page.setViewportSize(desktop);
	await page.goto('/docs/compute-shaders');
	const viewport = page.locator('#docs-content-container');
	const toc = viewport.locator('#docs-toc-sidebar');
	await expect(toc).toBeVisible();
	const initialTop = await toc.evaluate((node) => node.getBoundingClientRect().top);
	await viewport.evaluate((node) => {
		node.scrollTo({ top: 1200, behavior: 'instant' });
	});
	await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
	await expect
		.poll(() => toc.evaluate((node) => node.getBoundingClientRect().top))
		.toBe(initialTop);
	const scrollbar = page.locator('[data-docs-scroll-area] > [data-slot="scroll-area-scrollbar"]');
	await page.mouse.move(1432, 350);
	await expect(scrollbar).toBeVisible();
	const bounds = await scrollbar.boundingBox();
	const viewportBounds = await viewport.boundingBox();
	const tocBounds = await toc.boundingBox();
	expect(bounds).not.toBeNull();
	expect(viewportBounds).not.toBeNull();
	expect(tocBounds).not.toBeNull();
	if (!bounds || !viewportBounds || !tocBounds)
		throw new Error('Missing documentation layout bounds');
	expect(
		Math.abs(bounds.x + bounds.width - viewportBounds.x - viewportBounds.width)
	).toBeLessThanOrEqual(1);
	expect(bounds.x).toBeGreaterThan(tocBounds.x);
	await page.screenshot({ path: 'test-results/docs-persistent-toc.png' });
});

test('search restores focus and navigates to matching documentation', async ({ page }) => {
	await page.setViewportSize(desktop);
	await page.goto('/docs');
	await expect(page.locator('#docs-content-container')).toBeVisible();
	const trigger = page.getByRole('button', { name: 'Search documentation', exact: true });
	await trigger.click();
	const search = page.getByRole('combobox', { name: 'Search documentation', exact: true });
	await search.fill('compute');
	await expect(page.locator('[data-docs-search-result="page"]').first()).toContainText(
		'Compute shaders'
	);
	await search.press('Escape');
	await expect(trigger).toBeFocused();
	await expect(page.locator('#docs-toc-sidebar')).toBeVisible();
	await page.keyboard.press('Control+k');
	await search.fill('compute');
	await search.press('Enter');
	await expect(page).toHaveURL('/docs/compute-shaders');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compute shaders');
});

test('code, package-manager tabs, framework preference and Markdown copying work', async ({
	page,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.setViewportSize(desktop);
	await page.goto('/docs/getting-started');
	await expect(page.locator('#docs-content-container')).toBeVisible();
	await page.getByRole('tab', { name: 'pnpm', exact: true }).click();
	await expect(
		page.getByRole('region', { name: 'pnpm install command', exact: true })
	).toContainText('pnpm add spektral');
	await page.getByRole('tab', { name: 'React', exact: true }).click();
	await expect(
		page.getByRole('region', { name: 'React usage example', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('region', { name: 'Svelte usage example', exact: true })
	).toBeHidden();
	await page.getByRole('tab', { name: 'React', exact: true }).press('ArrowRight');
	await expect(page.getByRole('tabpanel', { name: 'Vue', exact: true })).toBeVisible();
	await page.getByRole('tab', { name: 'Vue', exact: true }).press('Home');
	await expect(page.getByRole('tabpanel', { name: 'Svelte', exact: true })).toBeVisible();
	await page.getByRole('tab', { name: 'Svelte', exact: true }).press('End');
	await expect(page.getByRole('tabpanel', { name: 'Vue', exact: true })).toBeVisible();
	await page.getByRole('tab', { name: 'Vue', exact: true }).press('ArrowLeft');
	await expect(page.getByRole('tabpanel', { name: 'React', exact: true })).toBeVisible();
	await page.screenshot({ path: 'test-results/docs-framework-tabs.png' });
	await page.getByRole('button', { name: 'Copy usage example to clipboard', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain('spektral/react');
	await page.reload();
	await expect(page.getByRole('tab', { name: 'React', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('tab', { name: 'pnpm', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Markdown copied', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('##');
});

test('mobile sidebar and TOC work without horizontal page overflow', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/docs');
	await expect(page.locator('#docs-content-container')).toBeVisible();
	await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
	const sidebar = page.getByRole('dialog', { name: 'Sidebar', exact: true });
	await expect(sidebar).toBeVisible();
	await sidebar.getByRole('link', { name: 'Introduction', exact: true }).click();
	await expect(page).toHaveURL('/docs/getting-started');
	await expect(sidebar).toBeHidden();
	const trigger = page.locator('[data-mobile-toc-trigger]');
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await trigger.click();
	await expect(trigger).toHaveText('Getting Started');
	const toc = page.getByRole('dialog', { name: 'On this page', exact: true });
	await expect(toc).toBeVisible();
	await toc.getByRole('link', { name: 'Install', exact: true }).click();
	await expect(toc).toBeHidden();
	await expect(page).toHaveURL(/#install$/);
	await expect(trigger).toContainText('Install');
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect
		.poll(() => page.locator('#install').evaluate((node) => node.getBoundingClientRect().top))
		.toBeLessThan(250);
	await trigger.press('Enter');
	await expect(toc).toBeVisible();
	await page.screenshot({ path: 'test-results/docs-mobile-toc-expanded.png' });
	await page.keyboard.press('Escape');
	await expect(toc).toBeHidden();
	await expect(trigger).toBeFocused();
	await page.screenshot({ path: 'test-results/docs-mobile-toc.png' });
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
		.toBe(true);
});

test('home is only an entry point and the Neutral theme persists', async ({ page }) => {
	await page.setViewportSize(desktop);
	await page.goto('/');
	await expect(page.locator('canvas')).toHaveCount(0);
	await page.getByRole('link', { name: 'Open Spektral documentation', exact: true }).click();
	await expect(page).toHaveURL('/docs');
	await expect(page.locator('#docs-content-container')).toBeVisible();
	const wasDark = await page.locator('html').evaluate((node) => node.classList.contains('dark'));
	await page
		.getByRole('button', {
			name: wasDark ? 'Switch to light theme' : 'Switch to dark theme',
			exact: true
		})
		.click();
	// Wait for the view-transition callback before reloading the document.
	await expect
		.poll(() => page.locator('html').evaluate((node) => node.classList.contains('dark')))
		.toBe(!wasDark);
	await page.reload();
	await expect
		.poll(() => page.locator('html').evaluate((node) => node.classList.contains('dark')))
		.toBe(!wasDark);
	await page.screenshot({ path: 'test-results/docs-desktop.png' });
});

test('mobile TOC scrolls long outlines and survives switching to desktop', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 568 });
	await page.goto('/docs/changelog');
	await expect(page.locator('#docs-content-container')).toBeVisible();
	const trigger = page.locator('[data-mobile-toc-trigger]');
	await expect(trigger).toBeVisible();
	const initialTop = await trigger.evaluate((node) => node.getBoundingClientRect().top);
	await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await expect(trigger).toHaveText('Advanced');
	const popover = page.getByRole('dialog', { name: 'On this page', exact: true });
	const list = popover.locator('[data-slot="scroll-area-viewport"]');
	await expect(list).toBeVisible();
	expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
	const lastLink = popover.getByRole('link').last();
	const href = await lastLink.getAttribute('href');
	if (!href) throw new Error('Missing heading anchor');
	await lastLink.click();
	await expect(popover).toBeHidden();
	await expect(page).toHaveURL(new RegExp(`${href}$`));
	await expect(trigger.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
	await expect
		.poll(() => trigger.evaluate((node) => node.getBoundingClientRect().top))
		.toBe(initialTop);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

	await trigger.click();
	await expect(popover).toBeVisible();
	await page.setViewportSize(desktop);
	await expect(page.locator('[data-mobile-toc-trigger]')).toHaveCount(0);
	await expect(popover).toHaveCount(0);
	await expect(page.locator('#docs-toc-sidebar nav')).toBeVisible();
	await expect(page.locator('#toc-links-wrapper')).toHaveCount(1);
});
