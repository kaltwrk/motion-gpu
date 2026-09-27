import { expect, test } from '@playwright/test';

test('isolates the preview process while the editor scrolls and edits a long shader', async ({
	page,
	browserName
}) => {
	test.skip(browserName !== 'chromium', 'Process inspection uses the Chromium DevTools protocol.');
	await page.goto('/playground?demo=blood-moon&framework=react');
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();
	const iframe = page.locator('iframe[title="Playground preview"]');
	const previewUrl = await iframe.getAttribute('src');
	expect(previewUrl).not.toBeNull();
	if (!previewUrl) throw new Error('The preview URL is missing.');
	expect(new URL(previewUrl).origin).not.toBe(new URL(page.url()).origin);

	const session = await page.context().newCDPSession(page);
	try {
		await expect
			.poll(async () => {
				const { targetInfos } = await session.send('Target.getTargets');
				return targetInfos.some((target) => target.type === 'iframe' && target.url === previewUrl);
			})
			.toBe(true);
	} finally {
		await session.detach();
	}

	await page.getByText('fragment.wgsl', { exact: true }).click();
	const content = page.locator('.cm-content[contenteditable="true"]');
	const viewport = page.locator('.cm-scroller');
	const preview = page.frames().find((frame) => frame.url() === previewUrl);
	if (!preview) throw new Error('The preview frame is missing.');
	await viewport.hover();

	// A bounded long task in the preview must leave the editor's animation frames available.
	const frameTimes = page.evaluate(
		() =>
			new Promise<number[]>((resolve) => {
				const times: number[] = [];
				const end = performance.now() + 1200;
				const sample = () => {
					times.push(performance.timeOrigin + performance.now());
					if (performance.now() < end) requestAnimationFrame(sample);
					else resolve(times);
				};
				requestAnimationFrame(sample);
			})
	);
	const busyInterval = preview.evaluate(() => {
		const start = performance.timeOrigin + performance.now();
		const stop = performance.now() + 600;
		while (performance.now() < stop) {
			// Deliberately block only the isolated preview to exercise the regression.
		}
		return { start, end: performance.timeOrigin + performance.now() };
	});
	await page.mouse.wheel(0, 1200);
	const [times, interval] = await Promise.all([frameTimes, busyInterval]);
	// Any frame inside this interval proves the editor was not blocked by the preview task.
	// Software WebGPU in CI does not provide a stable frame-rate baseline.
	expect(times.some((time) => time > interval.start && time < interval.end)).toBe(true);
	await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	const forwardPosition = await viewport.evaluate((element) => element.scrollTop);
	for (let index = 0; index < 6; index += 1) {
		await page.mouse.wheel(0, 100);
	}
	await expect
		.poll(() => viewport.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(forwardPosition);
	const reversePosition = await viewport.evaluate((element) => element.scrollTop);
	await page.mouse.wheel(0, -400);
	await expect
		.poll(() => viewport.evaluate((element) => element.scrollTop))
		.toBeLessThan(reversePosition);
	await page.mouse.wheel(400, 0);
	await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

	await content.click();
	await page.keyboard.press('ControlOrMeta+End');
	await expect(content).toContainText('return vec4f(color, 1.0);');
	await page.keyboard.insertText('\n// Editor scroll regression check.');
	await expect(content).toContainText('// Editor scroll regression check.');
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();
	await expect(
		page.frameLocator('iframe[title="Playground preview"]').locator('canvas')
	).toBeVisible();
});
