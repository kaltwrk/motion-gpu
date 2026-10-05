import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		{
			name: 'playground-media-cors',
			configureServer(server) {
				// Match the production _headers rule for fetches from the opaque preview iframe.
				server.middlewares.use((request, response, next) => {
					if (request.url?.startsWith('/playground-media/')) {
						response.setHeader('Access-Control-Allow-Origin', '*');
						response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
						response.setHeader('X-Content-Type-Options', 'nosniff');
					}
					next();
				});
			}
		},
		sveltekit()
	],
	server: {
		// localhost and 127.0.0.1 must both reach the local preview server.
		host: '127.0.0.1'
	},
	optimizeDeps: {
		exclude: ['@rollup/browser']
	},
	worker: {
		format: 'es'
	},
	test: {
		include: ['src/**/*.test.{js,ts}'],
		exclude: [...configDefaults.exclude, 'tests/e2e/**']
	}
});
