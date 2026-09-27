import type { Handle } from '@sveltejs/kit';

const SITE_REDIRECT_HOSTS = new Set([
	'motion-gpu.dev',
	'www.motion-gpu.dev',
	'www.spektral.madebyhex.com'
]);
const LEGACY_PREVIEW_HOST = 'preview.motion-gpu.dev';
const SPEKTRAL_SITE_HOST = 'spektral.madebyhex.com';
const SPEKTRAL_PREVIEW_HOST = 'preview.spektral.madebyhex.com';

export function resolveLegacyRedirect(url: URL): URL | null {
	let targetHost: string | null = null;
	if (SITE_REDIRECT_HOSTS.has(url.hostname)) {
		targetHost = SPEKTRAL_SITE_HOST;
	} else if (url.hostname === LEGACY_PREVIEW_HOST) {
		targetHost = SPEKTRAL_PREVIEW_HOST;
	}

	if (!targetHost) return null;

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

	return resolve(event);
};
