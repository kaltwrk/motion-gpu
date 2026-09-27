const localPreviewHostnames = new Set(['localhost', '127.0.0.1']);

/**
 * Gives the development preview a different site so browsers can schedule it separately.
 */
export function resolvePreviewOrigin(
	parentOrigin: string,
	configuredOrigin: string | undefined,
	development: boolean
): string {
	if (configuredOrigin?.trim()) {
		try {
			const configured = new URL(configuredOrigin.trim());
			if (configured.protocol === 'http:' || configured.protocol === 'https:') {
				return configured.origin;
			}
		} catch {
			// Fall back to the local preview when the configured origin is invalid.
		}
	}

	const preview = new URL(parentOrigin);
	if (development && preview.protocol === 'http:' && localPreviewHostnames.has(preview.hostname)) {
		preview.hostname = preview.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
	}
	return preview.origin;
}

/**
 * Allows only the paired loopback host on the same development server port.
 */
export function isLocalPreviewParent(parentOrigin: string, endpointOrigin: string): boolean {
	const parent = new URL(parentOrigin);
	const endpoint = new URL(endpointOrigin);
	return (
		parent.protocol === 'http:' &&
		endpoint.protocol === 'http:' &&
		parent.port === endpoint.port &&
		localPreviewHostnames.has(parent.hostname) &&
		localPreviewHostnames.has(endpoint.hostname)
	);
}
