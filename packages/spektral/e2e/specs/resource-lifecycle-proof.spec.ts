import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const proofUrl = `/@fs${fileURLToPath(new URL('../resource-lifecycle-proof.ts', import.meta.url))}`;

test.beforeEach(async ({ page }) => {
	await page.route('**/resource-lifecycle-proof', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' })
	);
	await page.goto('/resource-lifecycle-proof');
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
