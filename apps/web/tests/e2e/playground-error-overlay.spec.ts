import { expect, test } from '@playwright/test';

for (const framework of ['svelte', 'react', 'vue']) {
	test(`keeps typing focused through repeated shader errors (${framework})`, async ({ page }) => {
		await page.goto(`/playground?framework=${framework}`);
		await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'fragment.wgsl', exact: true }).click();

		const editor = page.locator('.cm-content[contenteditable="true"]');
		const preview = page.frameLocator('iframe[title="Playground preview"]');
		const overlay = preview.locator('.spektral-error-overlay');
		const suffix = '(uv);\n}';
		await editor.click();
		await editor.evaluate((element) => {
			element.setAttribute('data-focus-losses', '0');
			element.addEventListener('blur', () => {
				const losses = Number(element.getAttribute('data-focus-losses'));
				element.setAttribute('data-focus-losses', String(losses + 1));
			});
		});
		await page.keyboard.press('ControlOrMeta+A');
		await page.keyboard.insertText(`fn shade(uv: vec2f) -> vec4f {
	return vec4f(uv, 0.0, 1.0);
}
fn frag(uv: vec2f) -> vec4f {
	return s${suffix}`);
		let remainingCharacters = suffix.length;
		while (remainingCharacters > 0) {
			await page.keyboard.press('ArrowLeft');
			remainingCharacters -= 1;
		}

		await expect(overlay).toBeVisible();
		await expect(editor).toBeFocused({ timeout: 5000 });
		await expect(editor).toHaveAttribute('data-focus-losses', '0');

		for (const letter of 'hade') {
			await overlay.evaluate((element) => {
				element.setAttribute('data-before-focus-check', '');
			});
			// Do not refocus the editor between builds: each key must reach the same caret.
			await page.keyboard.type(letter);
			await expect(preview.locator('[data-before-focus-check]')).toHaveCount(0);
			if (letter !== 'e') await expect(overlay).toBeVisible();
			else await expect(overlay).toHaveCount(0);
			await expect(editor).toBeFocused({ timeout: 5000 });
			await expect(editor).toHaveAttribute('data-focus-losses', '0');
		}
		await expect(editor).toContainText('return shade(uv);');
		await expect(preview.locator('canvas')).toBeVisible();

		// Users can still deliberately enter the preview and use the dialog with a keyboard.
		await page.keyboard.press('Backspace');
		await expect(overlay).toBeVisible();
		const summary = overlay.locator('summary').first();
		await summary.click();
		await expect(summary).toBeFocused();
		await page.keyboard.press('Tab');
		await expect
			.poll(() =>
				overlay.evaluate((element) => element.contains(element.ownerDocument.activeElement))
			)
			.toBe(true);
	});
}

test('preserves Spektral overlay styles after an incremental playground build', async ({
	page
}) => {
	await page.goto('/playground?framework=react');
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();

	const iframeHandle = await page.locator('iframe[title="Playground preview"]').elementHandle();
	const previewFrame = await iframeHandle.contentFrame();
	expect(previewFrame).not.toBeNull();
	if (!previewFrame) {
		throw new Error('Playground preview frame was not created.');
	}

	await expect(previewFrame.locator('canvas')).toBeVisible();
	await page.getByRole('button', { name: 'fragment.wgsl', exact: true }).click();

	const editor = page.locator('.cm-content[contenteditable="true"]');
	const replaceShader = async (green: string) => {
		await editor.click();
		await page.keyboard.press('ControlOrMeta+A');
		await page.keyboard.insertText(`fn frag(uv: vec2f) -> vec4f
	return vec4f(uv, ${green}, 1.0);
}`);
	};

	await replaceShader('0.0');
	const overlay = previewFrame.locator('.spektral-error-overlay');
	await expect(overlay).toHaveCount(1);
	await expect(previewFrame.locator('.spektral-error-title')).toHaveText('WGSL compilation failed');
	await overlay.evaluate((element) => {
		element.setAttribute('data-before-incremental-build', '');
	});

	await replaceShader('0.1');
	await previewFrame.locator('[data-before-incremental-build]').waitFor({ state: 'detached' });
	await expect(overlay).toHaveCount(1);

	expect(await overlay.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
	expect(await overlay.evaluate((element) => getComputedStyle(element).zIndex)).toBe('2147483647');
});
