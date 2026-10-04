import { expect, test } from '@playwright/test';
import { toNumber } from './helpers';

type PerfWindow = Window &
	typeof globalThis & {
		__SPEKTRAL_PERF__?: {
			setMode: (mode: 'always' | 'on-demand' | 'manual') => void;
			invalidate: () => void;
			advance: () => void;
			setTaskActive: (active: boolean) => void;
		};
	};

test.describe('spektral perf scenario e2e', () => {
	test('keeps both counters idle until invalidated, while an active noninvalidating task only wakes the CPU', async ({
		page
	}) => {
		await page.goto('/?scenario=perf');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');
		await expect
			.poll(async () => toNumber(await page.getByTestId('render-count').textContent()))
			.toBeGreaterThan(0);
		await page.evaluate(() => (window as PerfWindow).__SPEKTRAL_PERF__!.setMode('on-demand'));
		await page.waitForTimeout(150);
		const counters = () =>
			page.evaluate(() => [
				Number(document.querySelector('[data-testid="scheduler-count"]')!.textContent),
				Number(document.querySelector('[data-testid="render-count"]')!.textContent)
			]);
		const idle = await counters();
		await page.waitForTimeout(300);
		expect(await counters()).toEqual(idle);
		await page.evaluate(() => (window as PerfWindow).__SPEKTRAL_PERF__!.setTaskActive(true));
		await page.waitForTimeout(150);
		const active = await counters();
		await page.waitForTimeout(300);
		const running = await counters();
		expect(running[0]).toBeGreaterThan(active[0]!);
		expect(running[1]).toBe(active[1]);
		await page.evaluate(() => (window as PerfWindow).__SPEKTRAL_PERF__!.setTaskActive(false));
		await page.waitForTimeout(150);
		const stopped = await counters();
		await page.waitForTimeout(300);
		expect(await counters()).toEqual(stopped);
	});

	test('exposes perf controls and applies render mode semantics', async ({ page }) => {
		await page.goto('/?scenario=perf');
		await expect(page.getByTestId('scenario')).toHaveText('perf');
		await expect(page.getByTestId('gpu-status')).toHaveText('ready');
		await expect(page.getByTestId('controls-ready')).toHaveText('yes');
		await expect(page.getByTestId('last-error')).toHaveText('none');

		await expect
			.poll(async () => toNumber(await page.getByTestId('scheduler-count').textContent()))
			.toBeGreaterThan(0);
		await expect
			.poll(async () => toNumber(await page.getByTestId('render-count').textContent()))
			.toBeGreaterThan(0);

		const perfApiAvailable = await page.evaluate(
			() => typeof (window as PerfWindow).__SPEKTRAL_PERF__?.advance === 'function'
		);
		expect(perfApiAvailable).toBe(true);

		await page.evaluate(() => (window as PerfWindow).__SPEKTRAL_PERF__?.setMode('manual'));
		await expect(page.getByTestId('render-mode')).toHaveText('manual');

		await page.waitForTimeout(120);
		const manualBeforeIdle = toNumber(await page.getByTestId('render-count').textContent());
		await page.waitForTimeout(260);
		const manualAfterIdle = toNumber(await page.getByTestId('render-count').textContent());
		expect(manualAfterIdle).toBe(manualBeforeIdle);

		await page.evaluate(() => (window as PerfWindow).__SPEKTRAL_PERF__?.advance());
		await expect
			.poll(async () => toNumber(await page.getByTestId('render-count').textContent()))
			.toBeGreaterThan(manualAfterIdle);

		await page.evaluate(() => (window as PerfWindow).__SPEKTRAL_PERF__?.setMode('on-demand'));
		await expect(page.getByTestId('render-mode')).toHaveText('on-demand');
		const onDemandBeforeInvalidate = toNumber(await page.getByTestId('render-count').textContent());
		await page.evaluate(() => (window as PerfWindow).__SPEKTRAL_PERF__?.invalidate());
		await expect
			.poll(async () => toNumber(await page.getByTestId('render-count').textContent()))
			.toBeGreaterThan(onDemandBeforeInvalidate);

		await page.evaluate(() => (window as PerfWindow).__SPEKTRAL_PERF__?.setMode('always'));
		await expect(page.getByTestId('render-mode')).toHaveText('always');
		const alwaysBefore = toNumber(await page.getByTestId('render-count').textContent());
		await expect
			.poll(async () => toNumber(await page.getByTestId('render-count').textContent()))
			.toBeGreaterThan(alwaysBefore);
	});
});
