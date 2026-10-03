import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const proofUrl = `/@fs${fileURLToPath(new URL('../renderer-proof.ts', import.meta.url))}`;

for (const generateMipmaps of [false, true]) {
	test(`anisotropic sampling renders with mipmaps=${generateMipmaps}`, async ({ page }) => {
		const pixels = await page.evaluate(
			async ({ url, generateMipmaps }) => {
				const proof: typeof import('../renderer-proof') = await import(/* @vite-ignore */ url);
				return proof.readAnisotropicTexture(generateMipmaps);
			},
			{ url: proofUrl, generateMipmaps }
		);
		expect(pixels).toEqual([[0, 255, 0, 255]]);
	});
}

for (const format of [undefined, 'rgba8unorm-srgb', 'rgba16float'] as const) {
	test(`runtime texture colorSpace respects ${format ?? 'automatic format'}`, async ({ page }) => {
		const pixels = await page.evaluate(
			async ({ url, format }) => {
				const proof: typeof import('../renderer-proof') = await import(/* @vite-ignore */ url);
				return proof.readTextureColorSpace(format);
			},
			{ url: proofUrl, format }
		);
		const expected =
			format === 'rgba16float'
				? [128, 128, 128, 128]
				: format
					? [55, 55, 55, 55]
					: [55, 128, 55, 55];
		for (let index = 0; index < pixels.length; index += 1) {
			expect(Math.abs(pixels[index]![0]! - expected[index]!)).toBeLessThanOrEqual(1);
		}
	});
}

test('explicit null clears a default texture and omission restores it', async ({ page }) => {
	const pixels = await page.evaluate(async (url) => {
		const proof: typeof import('../renderer-proof') = await import(/* @vite-ignore */ url);
		return proof.readTextureReset();
	}, proofUrl);
	expect(pixels).toEqual([
		[255, 0, 0, 255],
		[255, 255, 255, 255],
		[255, 255, 255, 255],
		[255, 0, 0, 255]
	]);
});

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

for (const kind of ['fragment', 'compute'] as const) {
	test(`${kind} feedback preserves submitted state after an aborted frame`, async ({ page }) => {
		const pixels = await page.evaluate(
			async ({ url, kind }) => {
				const proof: typeof import('../renderer-proof') = await import(/* @vite-ignore */ url);
				return proof.readAbortedFeedback(kind);
			},
			{ url: proofUrl, kind }
		);
		expect(Math.abs(pixels[0]! - 26)).toBeLessThanOrEqual(1);
		expect(Math.abs(pixels[1]! - 51)).toBeLessThanOrEqual(1);
	});
}

for (const matching of [false, true]) {
	test(`float32 feedback validates material layout before GPU binding (matching=${matching})`, async ({
		page
	}) => {
		const result = await page.evaluate(
			async ({ url, matching }) => {
				const proof: typeof import('../renderer-proof') = await import(/* @vite-ignore */ url);
				return proof.readFeedbackFormat(matching);
			},
			{ url: proofUrl, matching }
		);
		expect(result.validation).toBeNull();
		if (matching) {
			expect(result.error).toBeNull();
			expect(result.red).toBe(64);
		} else expect(result.error).toMatch(/sim.*rgba32float.*material.*format/s);
	});
}

test('texture bindings recover after a sibling texture update fails', async ({ page }) => {
	const result = await page.evaluate(async (url) => {
		const proof: typeof import('../renderer-proof') = await import(/* @vite-ignore */ url);
		return proof.readTextureUpdateRecovery();
	}, proofUrl);
	expect(result.error).toMatch(/positive integer/);
	expect(result.validation).toBeNull();
	expect(result.pixel).toEqual([0, 255, 0, 255]);
});
