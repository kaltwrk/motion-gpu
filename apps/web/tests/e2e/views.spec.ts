import { expect, test } from '@playwright/test';
import { playgroundPages } from '../../src/lib/site/playground';

test('switches views inside one shell and restores the persistent TOC', async ({ page }) => {
	await page.goto('/docs');
	await expect(page.locator('#docs-toc-sidebar')).toBeVisible();
	await page.getByRole('button', { name: 'Select view: Docs', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Playground', exact: true }).click();
	await expect(page).toHaveURL(/\/playground/);
	await expect(page.locator('[data-app-shell]')).toHaveCount(1);
	await expect(page.locator('[data-docs-navigation] a')).toHaveCount(playgroundPages.length);
	await expect(page.getByRole('button', { name: 'Search documentation', exact: true })).toHaveCount(
		0
	);
	await expect(page.locator('#docs-toc-sidebar')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Copy Markdown', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Choose demo', exact: true })).toHaveCount(0);
	await expect(page.getByRole('radiogroup', { name: 'Framework', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Select view: Playground', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Docs', exact: true }).click();
	await expect(page).toHaveURL(/\/docs$/);
	await expect(page.locator('#docs-toc-sidebar')).toBeVisible();
	await expect(page.locator('[data-docs-navigation] a')).toHaveCount(27);
	await expect(page.locator('iframe[title="Playground preview"]')).toHaveCount(0);
});

test('switches views with the keyboard in the mobile sidebar', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/docs');
	await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
	await page.getByRole('button', { name: 'Select view: Docs', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Docs', exact: true }).press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/playground/);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Choose demo', exact: true })).toHaveCount(0);
	await expect(page.getByRole('radiogroup', { name: 'Framework', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
	await page
		.locator('[data-docs-navigation]')
		.getByRole('link', { name: 'Diamond', exact: true })
		.click();
	await expect(page).toHaveURL(/\/playground\/diamond/);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Diamond', exact: true })).toHaveCount(1);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('generates SEO and PNG previews for both Markdown and custom views', async ({ request }) => {
	for (const path of ['/docs', '/playground']) {
		const response = await request.get(path);
		expect(response.status()).toBe(200);
		const html = await response.text();
		expect(html).toContain(`https://spektral.madebyhex.com${path}/og/index`);
		expect(html).not.toContain('%site.');
		const image = await request.get(`${path}/og/index`);
		expect(image.status()).toBe(200);
		expect(image.headers()['content-type']).toContain('image/png');
		const png = await image.body();
		expect(png.subarray(1, 4).toString()).toBe('PNG');
		expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
	}
	expect((await request.get('/playground/raw/index')).status()).toBe(404);
	expect((await request.get('/constructor')).status()).toBe(404);
	expect((await request.get('/docs/missing')).status()).toBe(404);
	const llms = await (await request.get('/llms.txt')).text();
	expect(llms).toContain('/docs/raw/index');
	expect(llms).not.toContain('/playground/raw/');
	const sitemap = await (await request.get('/sitemap.xml')).text();
	expect(sitemap).toContain('<loc>https://spektral.madebyhex.com/playground</loc>');
	expect(sitemap).not.toContain('/playground/embed');
	const manifest: unknown = await (await request.get('/site.webmanifest')).json();
	expect(manifest).toMatchObject({ name: 'Spektral', start_url: '/docs' });
});

test('each playground sidebar item has a page and its own social image', async ({
	page,
	request
}) => {
	await page.goto('/playground');
	const links = await page.locator('[data-docs-navigation] a').evaluateAll((nodes) =>
		nodes.map((node) => ({
			href: new URL(node.getAttribute('href') ?? '', document.baseURI).pathname,
			title: node.textContent.trim()
		}))
	);
	expect(links).toHaveLength(playgroundPages.length);
	for (const link of links) {
		const response = await request.get(link.href);
		expect(response.status(), link.href).toBe(200);
		const html = await response.text();
		expect(html).toContain(`<title>${link.title}`);
		const slug = link.href.replace(/^\/playground\/?/, '') || 'index';
		expect(html).toContain(`/playground/og/${slug}`);
	}
	const image = await request.get('/playground/og/diamond');
	expect(image.status()).toBe(200);
	expect(image.headers()['content-type']).toContain('image/png');
	expect((await request.get('/playground/missing-demo')).status()).toBe(404);
});

test('existing shared demo links resolve to the selected demo page', async ({ page }) => {
	await page.goto('/playground?demo=diamond&framework=react');
	await expect(page).toHaveURL('/playground/diamond?framework=react');
	await expect(page.locator('[data-docs-navigation] a[aria-current="page"]')).toHaveText('Diamond');
	await expect(page.getByRole('radio', { name: 'Switch framework to React' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
});
