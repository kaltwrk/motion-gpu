import { expect, test } from '@playwright/test';

test('landing actions enter the existing docs and playground shell', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/');
	await page.locator('#home').getByRole('link', { name: 'Documentation', exact: true }).click();
	await expect(page).toHaveURL(/\/docs$/);
	await expect(page.locator('[data-app-shell]')).toHaveCount(1);
	await page.goBack();
	await expect(page.locator('#home')).toBeVisible();
	await page.locator('#home').getByRole('link', { name: 'Playground', exact: true }).click();
	await expect(page).toHaveURL(/\/playground$/);
	await expect(page.locator('[data-app-shell]')).toHaveCount(1);
	await expect(page.getByRole('radiogroup', { name: 'Framework', exact: true })).toBeVisible();
	expect(errors).toEqual([]);
});

test('FAQ supports keyboard interaction and independent expanded answers', async ({ page }) => {
	await page.goto('/#faq');
	const first = page.getByRole('button', { name: 'What is Spektral?', exact: true });
	const second = page.getByRole('button', { name: 'Who is it for?', exact: true });
	await expect(first).toBeEnabled();
	await first.press('Enter');
	await expect(first).toHaveAttribute('aria-expanded', 'true');
	await first.press('ArrowDown');
	await expect(second).toBeFocused();
	await second.press('Space');
	await expect(second).toHaveAttribute('aria-expanded', 'true');
	await expect(first).toHaveAttribute('aria-expanded', 'true');
	await expect(
		page.getByText(
			'It is built for developers who want modern, high-performance visual effects without building a rendering stack from scratch.'
		)
	).toBeVisible();
});

test('FAQ keyboard focus covers the question row without shifting its chevron', async ({
	page
}) => {
	await page.goto('/#faq');
	const first = page.getByRole('button', { name: 'What is Spektral?', exact: true });
	const second = page.getByRole('button', { name: 'Who is it for?', exact: true });
	await expect(first).toBeEnabled();

	for (const width of [390, 1280]) {
		await page.setViewportSize({ width, height: 900 });
		const icon = second.locator('[data-slot="accordion-trigger-icon"]');
		const iconBeforeFocus = await icon.boundingBox();
		expect(iconBeforeFocus).not.toBeNull();
		await first.press('Tab');
		await expect(second).toBeFocused();
		expect(await second.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
		const rowBounds = await second.evaluate((node) => {
			const trigger = node.getBoundingClientRect();
			const itemElement = node.closest('[data-slot="accordion-item"]');
			if (!itemElement) throw new Error('The question must belong to an accordion item.');
			const item = itemElement.getBoundingClientRect();
			return { start: trigger.left - item.left, end: item.right - trigger.right };
		});
		expect(Math.abs(rowBounds.start)).toBeLessThan(1);
		expect(Math.abs(rowBounds.end)).toBeLessThan(1);
		const focusedIcon = await icon.boundingBox();
		expect(focusedIcon).not.toBeNull();
		await second.press('Tab');
		const blurredIcon = await icon.boundingBox();
		expect(blurredIcon).not.toBeNull();
		if (!iconBeforeFocus || !focusedIcon || !blurredIcon) {
			throw new Error('The FAQ chevron must stay visible before, during, and after focus.');
		}
		expect(focusedIcon.x).toBeCloseTo(iconBeforeFocus.x, 1);
		expect(blurredIcon.x).toBeCloseTo(iconBeforeFocus.x, 1);
	}
});

test('mobile navigation expands below the header, closes on Escape, and reaches section anchors', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	const trigger = page.getByRole('button', { name: /^(Open|Close) navigation menu$/ });
	await trigger.click();
	const navigation = page.getByRole('navigation', { name: 'Mobile navigation', exact: true });
	await expect(navigation).toBeVisible();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await page.keyboard.press('Tab');
	await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(navigation).toBeHidden();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect(trigger).toBeFocused();
	await trigger.click();
	await navigation.getByRole('link', { name: 'Features', exact: true }).click();
	await expect(navigation).toBeHidden();
	await expect(page).toHaveURL(/#features$/);
	await expect
		.poll(() =>
			page.locator('#features-title').evaluate((node) => {
				const { top, bottom } = node.getBoundingClientRect();
				return top >= 64 && bottom < innerHeight;
			})
		)
		.toBe(true);
});

test('section gutters collapse without horizontal overflow on small screens', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	for (const width of [320, 390, 768, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
			.toBe(true);
		if (width === 1440) {
			const gutter = page.locator('#features .bg-dashed').first();
			await expect(gutter).toBeVisible();
			expect(await gutter.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(
				50
			);
		} else if (width === 320) {
			await expect(page.locator('#features .bg-dashed').first()).toBeHidden();
		}
	}
});
