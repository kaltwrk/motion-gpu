import { expect, test, type Page } from '@playwright/test';

test.setTimeout(30_000);

async function expectAnchorInViewport(page: Page, id: string) {
	const viewport = page.locator('#docs-content-container');
	let previousScrollTop = -1;
	await expect
		.poll(
			async () => {
				const state = await viewport.evaluate((node, headingId) => {
					const heading = document.getElementById(headingId);
					const headingBounds = heading?.getBoundingClientRect();
					const viewportBounds = node.getBoundingClientRect();
					return {
						scrollTop: node.scrollTop,
						visible: Boolean(
							headingBounds &&
							headingBounds.top >= viewportBounds.top &&
							headingBounds.bottom <= viewportBounds.bottom
						)
					};
				}, id);
				const settled = state.scrollTop === previousScrollTop;
				previousScrollTop = state.scrollTop;
				return state.visible && settled;
			},
			{ timeout: 10_000 }
		)
		.toBe(true);

	// Only the article viewport may scroll; a displaced ancestor clips the article
	// and leaves a blank area below it, even when the destination heading is visible.
	expect(
		await viewport.evaluate((node) => {
			const offsets: number[] = [];
			for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
				offsets.push(ancestor.scrollTop);
			}
			return offsets.filter((offset) => offset !== 0);
		})
	).toEqual([]);

	expect(
		await viewport.evaluate((node) => {
			const inset = node.closest('[data-slot="sidebar-inset"]');
			if (!inset) return Infinity;
			return Math.abs(node.getBoundingClientRect().bottom - inset.getBoundingClientRect().bottom);
		})
	).toBeLessThanOrEqual(1);
}

for (const viewport of [
	{ width: 1440, height: 960 },
	{ width: 390, height: 844 }
]) {
	test(`opening a deep docs anchor keeps the article viewport in place (${viewport.width.toString()})`, async ({
		page
	}) => {
		await page.setViewportSize(viewport);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.goto('/docs/compute-shaders#frame-integration-and-caching');
		await expect(page.locator('#docs-content-container')).toBeVisible();
		await expectAnchorInViewport(page, 'frame-integration-and-caching');
	});
}

test('changing TOC targets during smooth scrolling keeps the article viewport in place', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/docs/getting-started');
	await expect(page.locator('#docs-content-container')).toBeVisible();
	await page
		.locator('[data-docs-navigation]')
		.getByRole('link', { name: 'Compute Shaders', exact: true })
		.click();
	await expect(page).toHaveURL('/docs/compute-shaders');
	const toc = page.getByRole('navigation', { name: 'On this page' });
	await toc.getByRole('link', { name: 'Frame integration and caching', exact: true }).click();
	await expect
		.poll(() => page.locator('#docs-content-container').evaluate((node) => node.scrollTop))
		.toBeGreaterThan(0);
	await toc.getByRole('link', { name: 'Shader contract', exact: true }).click();
	await toc.getByRole('link', { name: 'Resource descriptors', exact: true }).click();
	await expect(page).toHaveURL(/#resource-descriptors$/);
	await expectAnchorInViewport(page, 'resource-descriptors');
	await toc.getByRole('link', { name: 'Frame integration and caching', exact: true }).click();
	await expectAnchorInViewport(page, 'frame-integration-and-caching');
});
