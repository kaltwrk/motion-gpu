import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const proofUrl = `/@fs${fileURLToPath(new URL('../renderer-proof.ts', import.meta.url))}`;

test.beforeEach(async ({ page }) => {
	await page.route('**/renderer-proof', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
	);
	await page.goto('/renderer-proof');
});

for (const constant of [true, false]) {
	for (const workingFormat of ['auto', 'rgba16float'] as const) {
		for (const outputEncoding of ['srgb', 'linear'] as const) {
			test(`postprocessing stays linear: constant=${constant}, ${workingFormat}, ${outputEncoding}`, async ({
				page
			}) => {
				const pixels = await page.evaluate(
					async ({ url, constant, color }) => {
						const proof: typeof import('../renderer-proof') = await import(/* @vite-ignore */ url);
						return proof.readPostprocessColors(constant, color);
					},
					{ url: proofUrl, constant, color: { workingFormat, outputEncoding } }
				);
				const expected = outputEncoding === 'srgb' ? [188, 137, 188] : [128, 64, 128];
				for (let index = 0; index < pixels.length; index += 1) {
					expect(Math.abs(pixels[index]! - expected[index]!)).toBeLessThanOrEqual(1);
				}
			});
		}
	}
}

test('feedback passes and the scene read their own resolution after submission', async ({
	page
}) => {
	const pixel = await page.evaluate(async (url) => {
		const proof: typeof import('../renderer-proof') = await import(/* @vite-ignore */ url);
		return proof.readFeedbackResolution();
	}, proofUrl);
	expect(pixel).toEqual([64, 128, 255, 255]);
});
