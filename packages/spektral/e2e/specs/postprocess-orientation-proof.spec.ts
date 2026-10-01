import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const proofUrl = `/@fs${fileURLToPath(new URL('../postprocess-orientation-proof.ts', import.meta.url))}`;

test.beforeEach(async ({ page }) => {
	await page.route('**/orientation-proof', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
	);
	await page.goto('/orientation-proof');
});

for (const workingFormat of ['rgba8unorm', 'rgba16float'] as const) {
	test(`CopyPass allocates only two intermediate surfaces per size (${workingFormat})`, async ({
		page
	}) => {
		const { copy, blit } = await page.evaluate(
			async ({ url, workingFormat }) => {
				const proof: typeof import('../postprocess-orientation-proof') = await import(
					/* @vite-ignore */ url
				);
				return {
					copy: await proof.readPostprocessOrientation('copy', workingFormat),
					blit: await proof.readPostprocessOrientation('blit', workingFormat)
				};
			},
			{ url: proofUrl, workingFormat }
		);
		expect(copy.validation).toBeNull();
		expect(blit.validation).toBeNull();
		expect(copy.pixels).toEqual(blit.pixels);
		expect(copy.allocations).toEqual(blit.allocations);
		expect(copy.allocations).toEqual(
			[8, 8, 16, 16].map((size) => ({ width: size, height: size, format: workingFormat }))
		);
	});

	for (const kind of [
		'copy',
		'copy-clear',
		'copy-canvas',
		'blit',
		'shader',
		'shader-uv',
		'two-blits'
	] as const) {
		test(`${kind} preserves scene orientation after resizing (${workingFormat})`, async ({
			page
		}) => {
			const { direct, processed } = await page.evaluate(
				async ({ url, kind, workingFormat }) => {
					const proof: typeof import('../postprocess-orientation-proof') = await import(
						/* @vite-ignore */ url
					);
					return {
						direct: await proof.readPostprocessOrientation('direct', workingFormat),
						processed: await proof.readPostprocessOrientation(kind, workingFormat)
					};
				},
				{ url: proofUrl, kind, workingFormat }
			);
			expect(direct.validation).toBeNull();
			expect(processed.validation).toBeNull();
			expect(direct.pixels[0]![0]).toEqual([16, 239, 64, 255]);
			expect(processed.pixels).toEqual(direct.pixels);
		});
	}
}
