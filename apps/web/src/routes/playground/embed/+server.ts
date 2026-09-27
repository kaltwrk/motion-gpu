import {
	PLAYGROUND_PREVIEW_CHANNEL,
	PLAYGROUND_PREVIEW_SANDBOX
} from '$lib/playground-engine/preview/protocol';
import previewDefaultStyles from '$lib/playground-engine/preview/runtime-shell/styles.css?raw';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { isLocalPreviewParent } from '$lib/playground-engine/preview/origin';
import type { RequestHandler } from './$types';

export const prerender = false;

const PREVIEW_SESSION_ID = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * Parses an HTTP(S) origin and rejects missing values or other URL schemes.
 */
function toSafeOrigin(value: string | null): string {
	if (!value) return '';
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') {
			return '';
		}
		return url.origin;
	} catch {
		return '';
	}
}

/**
 * Allows local same-origin previews and explicitly configured cross-origin parents.
 */
function isAllowedParentOrigin(parentOrigin: string, endpointOrigin: string): boolean {
	if (parentOrigin === endpointOrigin) return true;
	if (dev && isLocalPreviewParent(parentOrigin, endpointOrigin)) return true;

	return (env.PLAYGROUND_PREVIEW_PARENT_ORIGINS ?? '')
		.split(',')
		.some((value) => toSafeOrigin(value.trim()) === parentOrigin);
}

type PreviewTheme = 'light' | 'dark';

const toPreviewTheme = (value: string | null): PreviewTheme =>
	value === 'dark' ? 'dark' : 'light';

const previewThemeTokens: Record<PreviewTheme, { background: string; foreground: string }> = {
	light: {
		background: 'oklch(0.9764 0.0013 265)',
		foreground: 'oklch(0.1881 0.006 265)'
	},
	dark: {
		background: 'oklch(0.2099 0.0039 265)',
		foreground: 'oklch(0.9674 0.0013 265)'
	}
};

const buildInitialStyle = (theme: PreviewTheme): string => {
	const tokens = previewThemeTokens[theme];
	const colorScheme = theme === 'dark' ? 'dark' : 'light';
	return `${previewDefaultStyles}
:root {
	color-scheme: ${colorScheme};
}

html,
body {
	background: ${tokens.background};
	color: ${tokens.foreground};
}`;
};

/**
 * Builds the isolated preview document with session-bound parent messaging.
 */
const buildEmbedHtml = ({
	sessionId,
	parentOrigin,
	initialStyle,
	nonce
}: {
	sessionId: string;
	parentOrigin: string;
	initialStyle: string;
	nonce: string;
}) => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<style id="injected">${initialStyle}</style>
	</head>
	<body>
		<script nonce="${nonce}">
			(() => {
				if (self.origin !== 'null') {
					throw new Error('Playground preview requires an opaque origin.');
				}

				// Rebuilt demos and error dialogs must not take focus from the editor.
				// Clicking or tabbing into the preview still allows its normal focus management.
				const focusElement = HTMLElement.prototype.focus;
				HTMLElement.prototype.focus = function (options) {
					if (!document.hasFocus()) return;
					focusElement.call(this, options);
				};

				const CHANNEL = ${JSON.stringify(PLAYGROUND_PREVIEW_CHANNEL)};
				const SESSION_ID = ${JSON.stringify(sessionId)};
				const ALLOWED_PARENT_ORIGIN = ${JSON.stringify(parentOrigin)};
				const style = document.querySelector('#injected');
				let linksHandled = false;

				const canAcceptEvent = (event) => {
					if (event.source !== parent) return false;
					if (ALLOWED_PARENT_ORIGIN && event.origin !== ALLOWED_PARENT_ORIGIN) return false;

					const data = event.data;
					if (!data || data.channel !== CHANNEL) return false;
					if (SESSION_ID && data.session_id !== SESSION_ID) return false;
					return true;
				};

				const send = (payload) => {
					parent.postMessage(
						{
							channel: CHANNEL,
							session_id: SESSION_ID,
							...payload
						},
						ALLOWED_PARENT_ORIGIN || '*'
					);
				};

				const serializeError = (error) => ({
					message: error?.message ?? String(error),
					stack: error?.stack ?? ''
				});

				window.addEventListener('message', (event) => {
					if (!canAcceptEvent(event)) return;

					const data = event.data ?? {};
					const cmdId = data.cmd_id;
					const reply = (payload) => {
						send({ ...payload, cmd_id: cmdId });
					};

					try {
						if (data.action === 'eval') {
							if (style && typeof data?.args?.style === 'string') {
								style.textContent = data.args.style;
							}
							(0, eval)(data?.args?.script || '');
							reply({ action: 'cmd_ok' });
							return;
						}

						if (data.action === 'catch_clicks') {
							if (!linksHandled) {
								linksHandled = true;
								document.body.addEventListener('click', (clickEvent) => {
									if (
										clickEvent.which !== 1 ||
										clickEvent.metaKey ||
										clickEvent.ctrlKey ||
										clickEvent.shiftKey
									)
										return;
									if (clickEvent.defaultPrevented) return;

									let element = clickEvent.target;
									while (element && element.nodeName !== 'A') element = element.parentNode;
									if (!element || element.nodeName !== 'A') return;

									if (
										element.hasAttribute('download') ||
										element.getAttribute('rel') === 'external' ||
										element.target
									)
										return;

									clickEvent.preventDefault();
									window.open(element.href, '_blank', 'noopener,noreferrer');
								});
							}

							reply({ action: 'cmd_ok' });
							return;
						}

						throw new Error('Unsupported action: ' + String(data.action));
					} catch (error) {
						const serialized = serializeError(error);
						reply({ action: 'cmd_error', message: serialized.message, stack: serialized.stack });
					}
				});

				window.onerror = (msg, _url, _lineNo, _columnNo, error) => {
					send({ action: 'error', value: error || msg });
				};

				window.addEventListener('unhandledrejection', (event) => {
					send({ action: 'unhandledrejection', value: event.reason });
				});

				send({ action: 'ready' });
				window.addEventListener('load', () => {
					send({ action: 'ready' });
				});
			})();
		</script>
	</body>
</html>
`;

/**
 * Builds the preview CSP around its per-response script nonce and parent origin.
 */
function buildContentSecurityPolicy(nonce: string, parentOrigin: string): string {
	return [
		"default-src 'none'",
		"base-uri 'none'",
		"object-src 'none'",
		`sandbox ${PLAYGROUND_PREVIEW_SANDBOX}`,
		`script-src 'nonce-${nonce}' 'unsafe-eval'`,
		"style-src 'unsafe-inline'",
		'img-src data: blob: https: http:',
		'media-src data: blob: https: http:',
		'font-src data: blob: https: http:',
		'connect-src data: blob: https: http: wss: ws:',
		'worker-src blob:',
		'child-src blob:',
		"form-action 'none'",
		`frame-ancestors ${parentOrigin}`
	].join('; ');
}

/**
 * Creates a non-cacheable plain-text response for invalid preview parameters.
 */
function badRequest(message: string): Response {
	return new Response(message, {
		status: 400,
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
}

/**
 * Serves a session-bound sandbox document after validating its parent origin.
 */
export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get('session') ?? '';
	const parentOrigin = toSafeOrigin(url.searchParams.get('parent_origin'));
	if (!PREVIEW_SESSION_ID.test(sessionId)) {
		return badRequest('A valid preview session is required.');
	}
	if (!parentOrigin) {
		return badRequest('A valid HTTP(S) parent_origin is required.');
	}
	if (!isAllowedParentOrigin(parentOrigin, url.origin)) {
		return badRequest('parent_origin is not allowed for this preview endpoint.');
	}

	const theme = toPreviewTheme(url.searchParams.get('theme'));
	const nonce = crypto.randomUUID().replaceAll('-', '');
	const html = buildEmbedHtml({
		sessionId,
		parentOrigin,
		initialStyle: buildInitialStyle(theme),
		nonce
	});

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'Content-Security-Policy': buildContentSecurityPolicy(nonce, parentOrigin),
			'Permissions-Policy':
				'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
			'Referrer-Policy': 'no-referrer',
			'Cross-Origin-Resource-Policy': 'cross-origin',
			'Origin-Agent-Cluster': '?1',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
