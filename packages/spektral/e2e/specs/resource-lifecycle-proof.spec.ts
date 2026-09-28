import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const proofUrl = `/@fs${fileURLToPath(new URL('../resource-lifecycle-proof.ts', import.meta.url))}`;

test.beforeEach(async ({ page }) => {
	await page.route('**/resource-lifecycle-proof', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
	);
	await page.goto('/resource-lifecycle-proof');
});

for (const premultipliedAlpha of [true, false]) {
	test(`texture upload honors initial and runtime premultipliedAlpha=${premultipliedAlpha}`, async ({
		page
	}) => {
		const pixels = await page.evaluate(
			async ({ url, premultipliedAlpha }) => {
				const proof: typeof import('../resource-lifecycle-proof') = await import(
					/* @vite-ignore */ url
				);
				return proof.readPremultipliedTexture(premultipliedAlpha);
			},
			{ url: proofUrl, premultipliedAlpha }
		);
		const straight = [255, 128, 0, 255];
		const premultiplied = [128, 128, 0, 255];
		expect(pixels).toEqual(
			premultipliedAlpha
				? [premultiplied, straight, premultiplied]
				: [straight, premultiplied, straight]
		);
	});
}

test('shared shader feedback isolates parity, reset, resize and renderer disposal', async ({
	page
}) => {
	const result = await page.evaluate(async (url) => {
		const proof: typeof import('../resource-lifecycle-proof') = await import(
			/* @vite-ignore */ url
		);
		return proof.readSharedFeedback();
	}, proofUrl);
	const expected = {
		accumulated: [
			[32, 32],
			[64, 64],
			[96, 96]
		],
		reset: [96, 128, 96],
		lastOutput: 'simB',
		even: [191, 159],
		resized: [96, 96],
		afterDispose: 128,
		recreated: [96, 159]
	};
	// rgba16float feedback quantization can differ by one output byte across GPU backends.
	expect(result.lastOutput).toBe(expected.lastOutput);
	for (const key of [
		'accumulated',
		'reset',
		'even',
		'resized',
		'afterDispose',
		'recreated'
	] as const) {
		const actual = [result[key]].flat(2);
		const values = [expected[key]].flat(2);
		expect(actual).toHaveLength(values.length);
		actual.forEach((value, index) =>
			expect(Math.abs(value - values[index]!)).toBeLessThanOrEqual(1)
		);
	}
});

for (const action of ['remove', 'replace', 'remount', 'disable', 'switch-writer'] as const) {
	test(`compute ping-pong ${action} keeps scene and downstream views valid`, async ({ page }) => {
		const pixels = await page.evaluate(
			async ({ url, action }) => {
				const proof: typeof import('../resource-lifecycle-proof') = await import(
					/* @vite-ignore */ url
				);
				return proof.readComputeRemoval(action);
			},
			{ url: proofUrl, action }
		);
		const first = [32, 0, 32, 255];
		const empty = [0, 0, 0, 255];
		const green = [0, 255, 255, 255];
		expect(pixels).toEqual(
			action === 'switch-writer'
				? [first, green, green, [64, 0, 64, 255], green]
				: action === 'replace'
					? [first, green, green]
					: action === 'disable'
						? [first, first, first]
						: action === 'remount'
							? [first, empty, first]
							: [first, empty, empty]
		);
	});
}
