import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
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
