import appleTouchIcon from './assets/apple-touch-icon.png';
import manifestIcon192 from './assets/web-app-manifest-192x192.png';
import manifestIcon512 from './assets/web-app-manifest-512x512.png';
import logoRaw from './assets/logo.svg?raw';

/**
 * Canonical site-level metadata shared across SEO tags, manifests, and feeds.
 * Keep this object project-specific when using the docs template for a new brand.
 */
export const siteConfig = {
	/** Primary site name used in titles and Open Graph site fields. */
	name: 'Spektral',
	logoRaw,
	language: 'en',
	locale: 'en_US',
	home: { href: '/docs', label: 'Open Spektral documentation' },
	assets: {
		favicon: '/favicon.svg',
		appleTouchIcon,
		manifestIcons: [
			{ src: manifestIcon192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
			{ src: manifestIcon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
		]
	},
	redirects: {
		siteHosts: ['motion-gpu.dev', 'www.motion-gpu.dev', 'www.spektral.madebyhex.com'],
		previewHosts: ['preview.motion-gpu.dev']
	},
	preview: { origin: 'https://preview.spektral.madebyhex.com', embedPath: '/playground/embed' },
	/** Compact site name for environments with strict length limits. */
	shortName: 'Spektral Docs',
	/** Public canonical URL used to build absolute links. */
	url: 'https://spektral.madebyhex.com',
	/** Default SEO description for the homepage and fallback metadata. */
	description:
		'A WebGPU library for fullscreen WGSL shaders with framework-neutral core APIs and adapters for Svelte 5, React 19, and Vue 3.',
	/** Author shown in metadata and structured data. */
	author: 'Marek Jóźwiak',
	/** Primary SEO keywords for indexing and discovery. */
	keywords: [
		'webgpu',
		'svelte',
		'svelte 5',
		'react',
		'vue',
		'shaders',
		'wgsl',
		'graphics',
		'gpu',
		'visualization',
		'creative coding',
		'spektral'
	],
	/** Default social preview image endpoint. */
	ogImage: '/og',
	/** Browser chrome colors synchronized with the light and dark inset surfaces. */
	themeColor: {
		light: '#ffffff',
		dark: '#131316'
	},
	/** External profile links used by docs actions and metadata. */
	links: {
		github: 'https://github.com/kaltwrk/spektral',
		twitter: 'https://x.com/madebyhex'
	},
	/** Package metadata used in installation snippets and docs helpers. */
	package: {
		name: 'spektral'
	}
};
