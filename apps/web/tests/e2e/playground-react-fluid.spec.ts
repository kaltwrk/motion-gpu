import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('React fluid demo tracks pointer input with the supported React runtime', async ({ page }) => {
	const diagnostics: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error' || message.type() === 'warning') {
			diagnostics.push(message.text());
		}
	});
	page.on('pageerror', (error) => diagnostics.push(error.message));

	await page.goto('/playground?demo=ping-pong-fluid&framework=react');
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();

	// Observe the state consumed by the real demo, rather than accepting a static canvas as success.
	const runtimeSource = readFileSync(
		new URL('../../src/routes/playground/demos/ping-pong-fluid/react/runtime.tsx', import.meta.url),
		'utf8'
	)
		.replace(
			"import { useEffect } from 'react';",
			"import { useEffect, version as reactVersion } from 'react';"
		)
		.replace(
			"frame.setUniform('uPointerActive', active ? 1 : 0);",
			"frame.setUniform('uPointerActive', active ? 1 : 0);\n\t\tframe.canvas.dataset.pointerActive = active ? '1' : '0';\n\t\tframe.canvas.dataset.reactVersion = reactVersion;\n\t\tframe.canvas.dataset.imageReady = String(Boolean(texture));"
		);
	await page.getByText('runtime.tsx', { exact: true }).click();
	await page.locator('.cm-content[contenteditable="true"]').click();
	await page.keyboard.press('ControlOrMeta+A');
	await page.keyboard.insertText(runtimeSource);

	const preview = page.frameLocator('iframe[title="Playground preview"]');
	const canvas = preview.locator('canvas');
	await expect(canvas).toHaveAttribute('data-react-version', /^19\./);
	await expect(canvas).toHaveAttribute('data-pointer-active', '0');
	await expect(canvas).toHaveAttribute('data-image-ready', 'true');
	let initialFrame = await canvas.screenshot();
	await expect
		.poll(async () => {
			const nextFrame = await canvas.screenshot();
			const stable = nextFrame.equals(initialFrame);
			initialFrame = nextFrame;
			return stable;
		})
		.toBe(true);
	const bounds = await canvas.boundingBox();
	expect(bounds).not.toBeNull();
	if (!bounds) throw new Error('The fluid preview canvas is missing.');

	await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
	await page.mouse.down();
	try {
		await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.4, {
			steps: 12
		});
		await expect(canvas).toHaveAttribute('data-pointer-active', '1', { timeout: 5000 });
		expect((await canvas.screenshot()).equals(initialFrame)).toBe(false);
	} finally {
		await page.mouse.up();
	}
	await page.mouse.move(0, 0);
	await expect(canvas).toHaveAttribute('data-pointer-active', '0');
	await expect(preview.locator('.spektral-error-overlay')).toHaveCount(0);
	expect(
		diagnostics.filter((message) => /callback ref|history\.(pushState|replaceState)/.test(message))
	).toEqual([]);
});
