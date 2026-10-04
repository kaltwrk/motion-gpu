import { expect, test } from '@playwright/test';
import {
	expectCanvasHashStable,
	getCanvasHash,
	getCanvasPixel,
	toNumber,
	waitForCanvasHashChange
} from './helpers';

test.describe('spektral compute pass e2e', () => {
	/* ────────────────────────────────────────────────────────
	 * 1. Basic compute pass with static dispatch
	 * ──────────────────────────────────────────────────────── */

	test('executes basic compute pass with static dispatch and renders without errors', async ({
		page
	}) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('scenario')).toHaveText('compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');
		await expect(page.getByTestId('last-error')).toHaveText('none');
		await expect(page.getByTestId('compute-mode')).toHaveText('none');

		// Activate basic compute pass
		await page.getByTestId('set-compute-basic').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('basic');
		await expect(page.getByTestId('pass-count')).toHaveText('1');

		// Advance a frame and verify rendering proceeds
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 2. Auto dispatch mode
	 * ──────────────────────────────────────────────────────── */

	test('executes compute pass with auto dispatch derived from canvas size', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-auto-dispatch').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('auto-dispatch');

		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 3. Dynamic dispatch via callback
	 * ──────────────────────────────────────────────────────── */

	test('executes compute pass with dynamic dispatch callback', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-dynamic-dispatch').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('dynamic-dispatch');

		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 4. Disabled compute pass is skipped
	 * ──────────────────────────────────────────────────────── */

	test('skips disabled compute pass without errors', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-disabled').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('disabled');
		await expect(page.getByTestId('pass-count')).toHaveText('1');

		// Advance several frames — the disabled pass should be silently skipped
		await page.getByTestId('advance-once').click();
		await page.getByTestId('advance-once').click();
		await page.getByTestId('advance-once').click();

		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 5. Storage texture compute pass
	 * ──────────────────────────────────────────────────────── */

	test('executes compute pass writing to a storage texture', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-storage-texture').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('storage-texture');

		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	test('samples a compute texture with nearest and linear samplers', async ({ page }) => {
		const renderSamplerMode = async (mode: 'nearest' | 'linear'): Promise<string> => {
			await page.goto('/?scenario=compute');
			await expect(page.getByTestId('gpu-status')).toHaveText('ready');
			await expect(page.getByTestId('controls-ready')).toHaveText('yes');
			await page.getByTestId(`set-compute-sample-${mode}`).click();
			await expect(page.getByTestId('compute-mode')).toHaveText(`sample-${mode}`);
			await expect(page.getByTestId('pass-count')).toHaveText('2');
			for (let frame = 0; frame < 3; frame += 1) {
				const frameBeforeAdvance = toNumber(await page.getByTestId('frame-count').textContent());
				await page.getByTestId('advance-once').click();
				await expect
					.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
					.toBeGreaterThan(frameBeforeAdvance);
			}
			await expect(page.getByTestId('last-error')).toHaveText('none');
			return getCanvasHash(page);
		};

		const nearestHash = await renderSamplerMode('nearest');
		const linearHash = await renderSamplerMode('linear');
		expect(linearHash).not.toBe(nearestHash);
	});

	/* ────────────────────────────────────────────────────────
	 * 6. Ping-pong compute pass (single iteration)
	 * ──────────────────────────────────────────────────────── */

	test('executes ping-pong compute pass with single iteration', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-ping-pong').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('ping-pong');

		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 7. Ping-pong compute pass with multiple iterations
	 * ──────────────────────────────────────────────────────── */

	test('executes ping-pong compute pass with multiple iterations per frame', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-ping-pong-multi').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('ping-pong-multi');

		// Advance several frames to exercise texture A/B alternation across iterations
		for (let i = 0; i < 5; i++) {
			await page.getByTestId('advance-once').click();
		}

		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(3);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 8. Particle simulation (storage buffer + time uniform)
	 * ──────────────────────────────────────────────────────── */

	test('executes particle compute pass that reads frame time', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-particle').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('particle');

		// Switch to always mode to generate multiple frames with varying time
		await page.getByTestId('set-mode-always').click();
		await expect(page.getByTestId('render-mode')).toHaveText('always');

		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(3);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 9. Bad compute shader → error report
	 * ──────────────────────────────────────────────────────── */

	test('reports compilation error for invalid compute shader', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');
		await expect(page.getByTestId('error-count')).toHaveText('0');

		await page.getByTestId('set-compute-bad-shader').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('bad-shader');

		await page.getByTestId('advance-once').click();

		// Should eventually surface a compilation error
		await expect
			.poll(async () => toNumber(await page.getByTestId('error-count').textContent()), {
				timeout: 5_000
			})
			.toBeGreaterThan(0);

		await expect(page.getByTestId('last-error')).toContainText('Compute shader compilation failed');
		await expect(page.getByTestId('last-error')).not.toContainText('WebGPU uncaptured error');
	});

	/* ────────────────────────────────────────────────────────
	 * 10. Recovery from bad compute shader
	 * ──────────────────────────────────────────────────────── */

	test('recovers from bad compute shader by switching to a valid one', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		// Trigger bad shader
		await page.getByTestId('set-compute-bad-shader').click();
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('error-count').textContent()), {
				timeout: 5_000
			})
			.toBeGreaterThan(0);

		const stalledFrames = toNumber(await page.getByTestId('frame-count').textContent());

		// Switch to valid basic compute pass
		await page.getByTestId('set-compute-basic').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('basic');

		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()), {
				timeout: 5_000
			})
			.toBeGreaterThan(stalledFrames);
	});

	/* ────────────────────────────────────────────────────────
	 * 11. Hot-swap compute source at runtime
	 * ──────────────────────────────────────────────────────── */

	test('hot-swaps compute shader source via setCompute without errors', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		// Start with basic compute
		await page.getByTestId('set-compute-basic').click();
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		// Hot-swap to a different compute shader source (changes workgroup size 64→32)
		await page.getByTestId('hot-swap-compute').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('hot-swap');

		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(1);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 12. Toggle compute pass enabled flag at runtime
	 * ──────────────────────────────────────────────────────── */

	test('toggles compute pass enabled flag at runtime', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		// Start with basic compute pass enabled
		await page.getByTestId('set-compute-basic').click();
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		// Disable the compute pass
		await page.getByTestId('toggle-compute-enabled').click();
		await page.getByTestId('advance-once').click();

		await expect(page.getByTestId('last-error')).toHaveText('none');

		// Re-enable the compute pass
		await page.getByTestId('toggle-compute-enabled').click();
		await page.getByTestId('advance-once').click();

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 13. Dispatch override at runtime
	 * ──────────────────────────────────────────────────────── */

	test('overrides dispatch dimensions at runtime via setDispatch', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-basic').click();
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		// Change dispatch dimensions from [4,1,1] to [8,2,1]
		await page.getByTestId('set-dispatch-override').click();
		await page.getByTestId('advance-once').click();

		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(1);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 14. Remove compute pass (back to none)
	 * ──────────────────────────────────────────────────────── */

	test('removes compute pass and continues rendering fragment only', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		// Start with compute
		await page.getByTestId('set-compute-basic').click();
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		// Remove compute pass
		await page.getByTestId('set-compute-none').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('none');
		await expect(page.getByTestId('pass-count')).toHaveText('0');

		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(1);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 15. Switch between different compute modes
	 * ──────────────────────────────────────────────────────── */

	test('switches between different compute pass configurations without errors', async ({
		page
	}) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		const modes: Array<{ testId: string; mode: string }> = [
			{ testId: 'set-compute-basic', mode: 'basic' },
			{ testId: 'set-compute-auto-dispatch', mode: 'auto-dispatch' },
			{ testId: 'set-compute-dynamic-dispatch', mode: 'dynamic-dispatch' },
			{ testId: 'set-compute-particle', mode: 'particle' },
			{ testId: 'set-compute-none', mode: 'none' }
		];

		for (const { testId, mode } of modes) {
			await page.getByTestId(testId).click();
			await expect(page.getByTestId('compute-mode')).toHaveText(mode);
			await page.getByTestId('advance-once').click();
			await expect(page.getByTestId('last-error')).toHaveText('none');
		}

		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(3);
	});

	/* ────────────────────────────────────────────────────────
	 * 16. Compute pass in always render mode produces changing frames
	 * ──────────────────────────────────────────────────────── */

	test('compute pass produces changing canvas in always render mode', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-particle').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('particle');

		await page.getByTestId('set-mode-always').click();
		await expect(page.getByTestId('render-mode')).toHaveText('always');

		// In always mode with a time-dependent compute, canvas should keep changing
		const hashA = await getCanvasHash(page);
		const hashB = await waitForCanvasHashChange(page, hashA);
		expect(hashB).not.toBe(hashA);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 17. Compute pass in manual mode produces stable canvas
	 * ──────────────────────────────────────────────────────── */

	test('compute pass in manual mode keeps canvas stable between advances', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');
		await expect(page.getByTestId('render-mode')).toHaveText('manual');

		await page.getByTestId('set-compute-basic').click();
		await page.getByTestId('advance-once').click();

		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);

		// A frame callback can initiate asynchronous compilation without submitting an image.
		// Wait for the material's gradient before asserting that manual rendering has stopped.
		await expect.poll(async () => (await getCanvasPixel(page, 0.5, 0.5))[2]).toBeGreaterThan(100);
		const hashAfterAdvance = await getCanvasHash(page);
		await expectCanvasHashStable(page, hashAfterAdvance, 220);
	});

	/* ────────────────────────────────────────────────────────
	 * 18. Switch from storage-buffer compute to storage-texture compute
	 * ──────────────────────────────────────────────────────── */

	test('transitions from storage buffer compute to storage texture compute', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		// Start with basic (storage buffer)
		await page.getByTestId('set-compute-basic').click();
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);
		await expect(page.getByTestId('last-error')).toHaveText('none');

		// Switch to storage texture compute
		await page.getByTestId('set-compute-storage-texture').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('storage-texture');

		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(1);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 19. Switch from storage-texture compute to ping-pong compute
	 * ──────────────────────────────────────────────────────── */

	test('transitions from storage texture compute to ping-pong compute', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-storage-texture').click();
		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(0);
		await expect(page.getByTestId('last-error')).toHaveText('none');

		// Switch to ping-pong
		await page.getByTestId('set-compute-ping-pong').click();
		await expect(page.getByTestId('compute-mode')).toHaveText('ping-pong');

		await page.getByTestId('advance-once').click();
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()))
			.toBeGreaterThan(1);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});

	/* ────────────────────────────────────────────────────────
	 * 20. Ping-pong multi-iteration does not error after many frames
	 * ──────────────────────────────────────────────────────── */

	test('ping-pong multi-iteration stays stable after many frames', async ({ page }) => {
		await page.goto('/?scenario=compute');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');

		await page.getByTestId('set-compute-ping-pong-multi').click();
		await page.getByTestId('set-mode-always').click();

		// Let it run for a while to exercise A/B flipping over many frames
		await expect
			.poll(async () => toNumber(await page.getByTestId('frame-count').textContent()), {
				timeout: 10_000
			})
			.toBeGreaterThan(15);

		await expect(page.getByTestId('last-error')).toHaveText('none');
	});
});
