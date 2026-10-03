import type { Handle } from '@sveltejs/kit';

import { siteConfig } from '$lib/site/site';
import { contentUiDefaults } from '$lib/site/content-ui';

const preferencesJson = JSON.stringify({
	theme: contentUiDefaults.theme,
	packageManager: contentUiDefaults.packageManager,
	framework: contentUiDefaults.framework
}).replaceAll('<', '\\u003c');

export function resolveLegacyRedirect(url: URL): URL | null {
	let targetHost: string | null = null;
	if (siteConfig.redirects.siteHosts.includes(url.hostname)) {
		targetHost = new URL(siteConfig.url).host;
	} else if (siteConfig.redirects.previewHosts.includes(url.hostname)) {
		targetHost = new URL(siteConfig.preview.origin).host;
	}

	if (!targetHost || targetHost === url.host) return null;

	const target = new URL(url);
	target.protocol = 'https:';
	target.host = targetHost;
	return target;
}

export const handle: Handle = async ({ event, resolve }) => {
	const redirectTarget = resolveLegacyRedirect(event.url);
	if (redirectTarget) {
		return new Response(null, {
			status: 308,
			headers: { location: redirectTarget.toString() }
		});
	}

	return resolve(event, {
		transformPageChunk: ({ html }) =>
			html
				.replace('%site.language%', siteConfig.language.replace(/[^a-zA-Z0-9-]/g, ''))
				.replace('%site.preferences%', () => preferencesJson)
	});
};
