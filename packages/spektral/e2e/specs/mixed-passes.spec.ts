import { expect, test } from '@playwright/test';
import {
	expectCanvasHashStable,
	getCanvasHash,
	getCanvasPixel,
	toNumber,
	waitForCanvasHashChange
} from './helpers';

test.describe('spektral mixed passes e2e', () => {
	async function advanceAndWait(
		page: Parameters<typeof getCanvasHash>[0],
		controlledClock = false
	): Promise<void> {
		const previousFrameCount = toNumber(await page.getByTestId('frame-count').textContent());
		await page.getByTestId('advance-once').click();
		await expect
			.poll(
				async () => {
					if (controlledClock) await page.clock.runFor(16);
					return toNumber(await page.getByTestId('frame-count').textContent());
				},
				{ timeout: 5_000 }
			)
			.toBeGreaterThan(previousFrameCount);
	}

	/* ────────────────────────────────────────────────────────
	 * 1. Three chained shader passes produce cumulative effect
	 *
	 * Catches: wrong source/target swap in multi-pass chains,
	 * missing intermediate texture allocation, pass ordering
	 * bugs in the render graph.
	 * ──────────────────────────────────────────────────────── */

	test('three chained shader passes produce different output than single pass', async ({
		page
	}) => {
		await page.goto('/?scenario=mixed-passes');
		await expect(page.getByTestId('scenario')).toHaveText('mixed-passes');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		// Render base (no passes)
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);
		const hashBase = await getCanvasHash(page);

		// Apply single shader pass
		await page.getByTestId('set-config-single-shader').click();
		await expect(page.getByTestId('pass-config')).toHaveText('single-shader');
		await page.getByTestId('advance-once').click();
		const hashSingle = await waitForCanvasHashChange(page, hashBase);
		expect(hashSingle).not.toBe(hashBase);

		// Apply 3 chained passes — should differ from both base and single
		await page.getByTestId('set-config-chain-3').click();
		await expect(page.getByTestId('pass-config')).toHaveText('chain-3');
		await expect(page.getByTestId('pass-count')).toHaveText('3');
		await page.getByTestId('advance-once').click();
		const hashChain = await waitForCanvasHashChange(page, hashSingle);
		expect(hashChain).not.toBe(hashSingle);
		expect(hashChain).not.toBe(hashBase);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 2. Compute + shader pass combined pipeline
	 *
	 * Catches: bind group conflicts between compute and
	 * render passes, wrong execution order, resource state
	 * transitions between compute and render.
	 * ──────────────────────────────────────────────────────── */

	test('compute pass and shader pass work together in the same pipeline', async ({ page }) => {
		await page.goto('/?scenario=mixed-passes');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		// Render base
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);
		const hashBase = await getCanvasHash(page);

		// Compute only
		await page.getByTestId('set-config-compute-only').click();
		await expect(page.getByTestId('pass-config')).toHaveText('compute-only');
		await page.getByTestId('advance-once').click();

		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(1);
		await expect(page.getByTestId('last-error')).toHaveText('none');

		const hashCompute = await getCanvasHash(page);

		// Compute + shader together
		await page.getByTestId('set-config-compute-plus-shader').click();
		await expect(page.getByTestId('pass-config')).toHaveText('compute-plus-shader');
		await expect(page.getByTestId('pass-count')).toHaveText('2');
		await page.getByTestId('advance-once').click();

		const hashMixed = await waitForCanvasHashChange(page, hashCompute);
		expect(hashMixed).not.toBe(hashCompute);
		expect(hashMixed).not.toBe(hashBase);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 3. ShaderPass enable/disable at runtime
	 *
	 * Catches: stale render graph when shader pass toggled,
	 * different code path than ComputePass enable/disable,
	 * source/target chain breaks when middle pass disabled.
	 * ──────────────────────────────────────────────────────── */

	test('toggling shader pass enabled flag changes visual output', async ({ page }) => {
		await page.goto('/?scenario=mixed-passes');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		// Wait for submitted pixels, not task counts: pass compilation is asynchronous.
		const waitForBlue = async (expected: number): Promise<void> => {
			await expect
				.poll(async () => {
					await advanceAndWait(page);
					const pixel = await getCanvasPixel(page, 0.5, 0.5);
					return Math.abs(pixel[2] - expected);
				})
				.toBeLessThanOrEqual(2);
		};
		// Start with 3 chained passes (red=on, green=off initially for toggle-middle, blue=on)
		await page.getByTestId('set-config-toggle-middle').click();
		await expect(page.getByTestId('pass-config')).toHaveText('toggle-middle');
		// Blue is 0.5 * 0.7 + 0.3 = 0.65 linear, about 211 in sRGB.
		await waitForBlue(211);

		// Hash with green disabled
		const hashGreenOff = await getCanvasHash(page);
		await expectCanvasHashStable(page, hashGreenOff, 200);

		// Enable green pass
		await page.getByTestId('toggle-middle-pass').click();
		// The middle pass multiplies blue by another 0.7: 0.545 linear.
		await waitForBlue(195);
		const hashGreenOn = await waitForCanvasHashChange(page, hashGreenOff);
		expect(hashGreenOn).not.toBe(hashGreenOff);

		// Disable green pass again — should return to previous visual
		await page.getByTestId('toggle-middle-pass').click();
		await waitForBlue(211);
		const hashGreenOff2 = await waitForCanvasHashChange(page, hashGreenOn);
		expect(hashGreenOff2).toBe(hashGreenOff);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 4. Bad shader pass reports error and recovers
	 *
	 * Catches: ShaderPass compilation error handling (existing
	 * tests only cover fragment material and compute errors),
	 * error propagation from pass pipeline.
	 * ──────────────────────────────────────────────────────── */

	test('bad shader pass reports error and recovers when replaced', async ({ page }) => {
		await page.goto('/?scenario=mixed-passes');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');
		await expect(page.getByTestId('error-count')).toHaveText('0');

		// Establish the renderer before introducing the invalid dynamic pass.
		// Initial pass failures intentionally reject renderer initialization;
		// this scenario exercises recoverable errors on an active renderer.
		await advanceAndWait(page);

		// Apply bad shader pass
		await page.getByTestId('set-config-bad-shader-pass').click();
		await advanceAndWait(page);

		// Should surface an error
		await expect
			.poll(
				async () => {
					await advanceAndWait(page);
					return toNumber(await page.getByTestId('error-count').textContent());
				},
				{
					timeout: 5_000
				}
			)
			.toBeGreaterThan(0);
		await expect(page.getByTestId('last-error')).not.toHaveText('none');

		const errorCountAfterBad = toNumber(await page.getByTestId('error-count').textContent());
		const hashAfterBad = await getCanvasHash(page);

		// Switch to a valid single shader pass
		await page.getByTestId('set-config-single-shader').click();
		await advanceAndWait(page);

		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()), {
				timeout: 5_000
			})
			.toBeGreaterThan(1);

		let hashAfterRecovery = hashAfterBad;
		await expect
			.poll(
				async () => {
					await advanceAndWait(page);
					hashAfterRecovery = await getCanvasHash(page);
					return hashAfterRecovery === hashAfterBad;
				},
				{ timeout: 5_000 }
			)
			.toBe(false);
		expect(hashAfterRecovery).not.toBe(hashAfterBad);

		const errorCountAfterRecovery = toNumber(await page.getByTestId('error-count').textContent());
		expect(errorCountAfterRecovery).toBeGreaterThanOrEqual(errorCountAfterBad);
	});

	/* ────────────────────────────────────────────────────────
	 * 5. Repeated identical errors are deduplicated
	 *
	 * Catches: regressions in error deduplication and grace
	 * window handling after a quick recovery cycle.
	 * ──────────────────────────────────────────────────────── */

	test('repeated identical errors are deduplicated across quick recovery cycles', async ({
		page
	}) => {
		await page.clock.install({ time: '2026-01-01T00:00:00Z' });
		await page.goto('/?scenario=mixed-passes');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');
		await expect(page.getByTestId('error-count')).toHaveText('0');
		// Keep recovery inside the 750 ms grace window regardless of host load.
		await page.clock.pauseAt('2026-01-01T00:01:00Z');

		// Keep this on the dynamic-pass path. An invalid pass present during
		// renderer creation is a non-recoverable initialization failure.
		await advanceAndWait(page, true);

		// First active error should be reported once, even if the failing
		// pass remains active across multiple manual frames.
		await page.getByTestId('set-config-bad-shader-pass').click();
		await advanceAndWait(page, true);
		await expect
			.poll(
				async () => {
					await advanceAndWait(page, true);
					return toNumber(await page.getByTestId('error-count').textContent());
				},
				{
					timeout: 5_000
				}
			)
			.toBe(1);

		await advanceAndWait(page, true);
		await advanceAndWait(page, true);
		await expect(page.getByTestId('error-count')).toHaveText('1');

		const firstErrorCount = toNumber(await page.getByTestId('error-count').textContent());

		// Recover and immediately re-trigger the same failing pass.
		await page.getByTestId('set-config-single-shader').click();
		await advanceAndWait(page, true);
		await page.getByTestId('set-config-multi-error').click();
		await advanceAndWait(page, true);

		// With intentional deduplication + grace window, the same error key
		// should not increment count on an immediate repeat.
		await page.clock.runFor(200);
		await expect(page.getByTestId('error-count')).toHaveText(String(firstErrorCount));
	});

	/* ────────────────────────────────────────────────────────
	 * 6. Remove all passes and continue rendering
	 *
	 * Catches: pass cleanup not releasing GPU resources,
	 * render graph stuck in stale state after all passes
	 * removed.
	 * ──────────────────────────────────────────────────────── */

	test('removing all passes after mixed pipeline continues rendering', async ({ page }) => {
		await page.goto('/?scenario=mixed-passes');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		// Start with compute + shader pipeline
		await page.getByTestId('set-config-compute-plus-shader').click();
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		const hashMixed = await getCanvasHash(page);

		// Remove all passes
		await page.getByTestId('set-config-none').click();
		await expect(page.getByTestId('pass-config')).toHaveText('none');
		await expect(page.getByTestId('pass-count')).toHaveText('0');
		await page.getByTestId('advance-once').click();

		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(1);

		// Canvas should differ (no post-processing)
		const hashNone = await getCanvasHash(page);
		expect(hashNone).not.toBe(hashMixed);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});
});
