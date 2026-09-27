import { expect, test } from '@playwright/test';

test('keeps the rendered shader aligned with wheel scrolling', async ({ page }) => {
	await page.goto('/playground?demo=blood-moon&framework=react');
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();
	await page.getByText('fragment.wgsl', { exact: true }).click();
	await page.evaluate(() => document.fonts.ready);
	const viewport = page.locator('.cm-scroller');
	await viewport.hover();

	const samples: { kind: string; top: number; missingPixels: number }[] = [];
	await page.exposeFunction('recordEditorWheel', (sample: (typeof samples)[number]) => {
		samples.push(sample);
	});
	await viewport.evaluate((scroller) => {
		// Check both the end of wheel handling and browser-delivered scroll positions before
		// CodeMirror's scroll listener can repair a viewport the compositor already moved.
		// Waiting for the eventual scrollTop or an animation frame misses this regression.
		const sample = (event: Event) => {
			if (!event.isTrusted) return;
			const rect = scroller.getBoundingClientRect();
			const content = scroller.querySelector<HTMLElement>('.cm-content');
			if (!content) throw new Error('The editor content is missing.');
			const contentRect = content.getBoundingClientRect();
			const style = getComputedStyle(content);
			const top = Math.max(rect.top, contentRect.top + parseFloat(style.paddingTop));
			const bottom = Math.min(
				rect.top + scroller.clientHeight,
				contentRect.bottom - parseFloat(style.paddingBottom)
			);
			const coverage = Array.from(content.querySelectorAll('.cm-line')).reduce((sum, line) => {
				const lineRect = line.getBoundingClientRect();
				return sum + Math.max(0, Math.min(bottom, lineRect.bottom) - Math.max(top, lineRect.top));
			}, 0);
			void (
				window as unknown as {
					recordEditorWheel: (sample: {
						kind: string;
						top: number;
						missingPixels: number;
					}) => Promise<void>;
				}
			).recordEditorWheel({
				kind: event.type,
				top: scroller.scrollTop,
				missingPixels: bottom - top - coverage
			});
		};
		scroller.addEventListener('wheel', sample);
		scroller.addEventListener('scroll', sample, { capture: true });
	});

	for (let index = 0; index < 24; index += 1) {
		await page.mouse.wheel(0, index < 12 ? 400 : -400);
	}
	await expect.poll(() => samples.filter((sample) => sample.kind === 'wheel').length).toBe(24);
	expect(Math.max(...samples.map((sample) => sample.top))).toBeGreaterThan(2000);
	expect(Math.max(...samples.map((sample) => sample.missingPixels))).toBeLessThanOrEqual(2);
	await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0);

	// Wheel input over the gutter must follow the same path as input over code.
	await page.locator('.cm-gutters').hover();
	await page.mouse.wheel(0, 500);
	await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await expect.poll(() => samples.filter((sample) => sample.kind === 'wheel').length).toBe(25);
	expect(samples.at(-1)?.missingPixels).toBeLessThanOrEqual(2);
});

test('preserves wheel units, horizontal scrolling, zoom gestures and scroll boundaries', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto('/playground?demo=blood-moon&framework=react');
	await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();
	await page.getByText('fragment.wgsl', { exact: true }).click();
	await page.evaluate(() => document.fonts.ready);
	const viewport = page.locator('.cm-scroller');
	const results = await viewport.evaluate((scroller) => {
		const renderedLine = scroller.querySelector('.cm-line');
		if (!renderedLine) throw new Error('The editor has no rendered lines.');
		const lineHeight = parseFloat(getComputedStyle(renderedLine).lineHeight);
		const wheel = (init: WheelEventInit) => {
			const before = { left: scroller.scrollLeft, top: scroller.scrollTop };
			const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
			scroller.dispatchEvent(event);
			return {
				x: scroller.scrollLeft - before.left,
				y: scroller.scrollTop - before.top,
				prevented: event.defaultPrevented
			};
		};
		const boundary = wheel({ deltaY: -100 });
		const pixel = wheel({ deltaY: 120 });
		const line = wheel({ deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
		const page = wheel({ deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
		const horizontal = wheel({ deltaX: 50 });
		const shift = wheel({ deltaY: -50, shiftKey: true });
		const pinch = wheel({ deltaY: 100, ctrlKey: true });
		const meta = wheel({ deltaY: 100, metaKey: true });
		const noncancelable = wheel({ deltaY: 100, cancelable: false });
		let fractionalDistance = 0;
		for (let index = 0; index < 20; index += 1) fractionalDistance += wheel({ deltaY: 0.25 }).y;
		return {
			boundary,
			pixel,
			line,
			page,
			horizontal,
			shift,
			pinch,
			meta,
			noncancelable,
			fractionalDistance,
			lineHeight,
			pageHeight: scroller.clientHeight
		};
	});
	expect(results.boundary).toEqual({ x: 0, y: 0, prevented: true });
	expect(results.pixel).toEqual({ x: 0, y: 120, prevented: true });
	expect(results.line.y).toBeCloseTo(results.lineHeight * 3, 0);
	expect(results.page.y).toBeCloseTo(results.pageHeight, 0);
	expect(results.horizontal).toEqual({ x: 50, y: 0, prevented: true });
	expect(results.shift).toEqual({ x: -50, y: 0, prevented: true });
	for (const gesture of [results.pinch, results.meta, results.noncancelable]) {
		expect(gesture).toEqual({ x: 0, y: 0, prevented: false });
	}
	expect(results.fractionalDistance).toBeCloseTo(5, 0);
});
