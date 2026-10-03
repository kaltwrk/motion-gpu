import { expect, test } from '@playwright/test';

test.setTimeout(30_000);

for (const theme of ['light', 'dark'] as const) {
	test(`horizontal docs scrolling keeps masks and keyboard focus on the rounded card (${theme})`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 1120, height: 960 });
		await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
		await page.goto('/docs/compute-shaders');
		await expect(page.locator('#docs-content-container')).toBeVisible();

		const code = page.getByRole('region', { name: 'ts code example', exact: true }).nth(1);
		const table = page.getByRole('region', { name: 'Scrollable table', exact: true }).first();
		const codeCard = code.locator('xpath=ancestor::*[@data-slot="card"][last()]');
		const tableCard = table.locator('xpath=ancestor::*[@data-slot="card"][last()]');

		// The inner, unframed CodeBlock must not add Nova's default square ring.
		const innerCodeCard = code.locator('xpath=ancestor::*[@data-slot="card"][1]');
		await expect(innerCodeCard).toHaveCSS('border-top-left-radius', '10px');
		await expect(innerCodeCard).toHaveCSS('box-shadow', /0px 0px 0px 0px/);

		await page.getByRole('button', { name: 'Copy code to clipboard', exact: true }).nth(1).focus();
		await page.keyboard.press('Tab');
		await expect(code).toBeFocused();
		await expect(code).toHaveCSS('outline-style', 'none');
		await expect(codeCard).toHaveCSS('box-shadow', /0px 0px 0px 3px/);
		await expect(codeCard).toHaveCSS('outline-style', 'solid');
		await expect(codeCard).toHaveCSS('mask-image', 'none');
		await code.press('ArrowRight');
		await expect.poll(() => code.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
		await page.screenshot({ path: `test-results/code-focus-${theme}.png` });

		// The table is the next scroll stop, with no nested native scroller or ring.
		await page.keyboard.press('Tab');
		await expect(table).toBeFocused();
		await expect(table).toHaveCSS('outline-style', 'none');
		await expect(tableCard).toHaveCSS('box-shadow', /0px 0px 0px 3px/);
		await expect(tableCard.locator('[data-slot="table-container"]')).toHaveCSS(
			'overflow-x',
			'visible'
		);
		await table.press('ArrowRight');
		await expect.poll(() => table.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
		await page.screenshot({ path: `test-results/table-focus-${theme}.png` });

		for (const viewport of [code, table]) {
			await expect(viewport).toHaveAttribute('data-scrollable', '');
			await expect(viewport).toHaveAttribute('tabindex', '0');
			for (const offset of [0, 8, 32, -8, -1, 0]) {
				await viewport.evaluate((node, offset) => {
					const maxScroll = node.scrollWidth - node.clientWidth;
					node.scrollLeft = offset < 0 ? maxScroll + offset + 1 : offset;
				}, offset);
				const [left, right] =
					offset >= 0 ? [Math.min(offset, 24), 24] : [24, offset === -1 ? 0 : 7];
				await expect
					.poll(() => viewport.evaluate((node) => node.style.maskImage.replace(' + 0px', ' - 0px')))
					.toBe(
						`linear-gradient(to right, transparent, black ${left.toString()}px, black calc(100% - ${right.toString()}px), transparent)`
					);
			}
		}

		// ResizeObserver must remove both the fade and tab stop when the code fits.
		await page.setViewportSize({ width: 1440, height: 960 });
		await expect(code).not.toHaveAttribute('data-scrollable');
		await expect(code).toHaveAttribute('tabindex', '-1');
		await expect(code).toHaveCSS('mask-image', 'none');
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
			.toBe(true);
	});
}
