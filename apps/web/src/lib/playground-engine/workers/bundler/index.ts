// @ts-nocheck
import { rollup } from '@rollup/browser';
import { DEV } from 'esm-env';
import typescript_strip_types from './plugins/typescript';
import commonjs from './plugins/commonjs';
import glsl from './plugins/glsl';
import json from './plugins/json';
import mp3 from './plugins/mp3';
import image from './plugins/image';
import svg from './plugins/svg';
import replace from './plugins/replace';
import reactJsxPlugin from './plugins/react-jsx';
import vueSfcPlugin from './plugins/vue-sfc';
import alias_plugin, { resolve } from './plugins/alias';
import typegpuTransformPlugin from './plugins/typegpu';
import type { Plugin, RollupCache, TransformResult } from '@rollup/browser';
import type { BundleMessageData, BundleOptions } from '../workers';
import type { CompileError, CompileResult } from 'svelte/compiler';
import type { BundleResult, PlaygroundFile as File } from '../../types';
import { max } from './semver';
import { NPM, VIRTUAL } from '../constants';
import {
	normalize_path,
	fetch_package,
	load_svelte,
	parse_npm_url,
	resolve_local,
	resolve_local_spektral,
	resolve_local_spektral_relative,
	resolve_subpath,
	resolve_version,
	type Package
} from '../npm';

// hack for magic-string and rollup inline sourcemaps
// do not put this into a separate module and import it, would be treeshaken in prod
self.window = self;

const ENTRYPOINT = '__entry.js';
const WRAPPER = '__wrapper.svelte';
const STYLES = '__styles.js';
const ESM_ENV = '__esm-env.js';

let current_id: number;

self.addEventListener('message', async (event: MessageEvent<BundleMessageData>) => {
	switch (event.data.type) {
		case 'init': {
			get_svelte(event.data.svelte_version);
			break;
		}

		case 'bundle': {
			try {
				const { uid, files, options } = event.data;
				let svelte: typeof import('svelte/compiler') | null = null;
				let svelte_version = options.svelte_version;
				let can_use_experimental_async = false;

				if (options.framework === 'svelte') {
					const loaded = await get_svelte(options.svelte_version);
					svelte = loaded.svelte;
					svelte_version = loaded.version;
					can_use_experimental_async = loaded.can_use_experimental_async;
				}

				current_id = uid;

				setTimeout(async () => {
					if (current_id !== uid) return;

					const result = await bundle(
						options.framework,
						svelte,
						svelte_version,
						uid,
						files,
						options,
						can_use_experimental_async
					);

					// error object might be augmented, see https://github.com/rollup/rollup/blob/76a3b8ede4729a71eb522fc29f7d550a4358827b/docs/plugin-development/index.md#thiserror,
					// hence only check that the specific abort property we set is there
					if ((result.error as any)?.svelte_bundler_aborted === ABORT.svelte_bundler_aborted) {
						return;
					}
					if (result && uid === current_id) postMessage(result);
				});
			} catch (e) {
				self.postMessage({
					type: 'error',
					uid: event.data.uid,
					message: `Error loading the compiler: ${(e as Error).message}`
				});
			}

			break;
		}
	}
});

let ready: ReturnType<typeof load_svelte>;
let ready_version: string;

function get_svelte(svelte_version: string) {
	if (ready_version === svelte_version) return ready;

	self.postMessage({ type: 'status', message: `fetching svelte@${svelte_version}` });
	ready_version = svelte_version;
	ready = load_svelte(svelte_version || 'latest');
	ready.then(({ version, can_use_experimental_async }) => {
		ready_version = version;
		self.postMessage({
			type: 'version',
			version,
			supports_async: can_use_experimental_async
		});
	});
	return ready;
}

const ABORT = { svelte_bundler_aborted: true };

let previous: {
	key: string;
	cache: RollupCache | undefined;
	cssById: Map<string, string>;
};

async function get_bundle(
	framework: BundleOptions['framework'],
	svelte: typeof import('svelte/compiler') | null,
	svelte_version: string,
	uid: number,
	virtual: Map<string, File>,
	options: BundleOptions,
	can_use_experimental_async: boolean
) {
	let bundle;

	const key = JSON.stringify(options);
	const warnings: unknown[] = [];
	const all_warnings: Array<{ message: string }> = [];

	const repl_plugin: Plugin = {
		name: 'svelte-repl',
		async resolveId(importee, importer) {
			if (uid !== current_id) throw ABORT;

			// entrypoint
			if (!importer) return `${VIRTUAL}/${ENTRYPOINT}`;

			// special case
			if (importee === 'esm-env') return `${VIRTUAL}/${ESM_ENV}`;

			// importing from a URL
			if (/^[a-z]+:/.test(importee)) return importee;
			if (importee[0] === '/' && importer && /^[a-z]+:/.test(importer)) {
				return new URL(importee, importer).href;
			}

			/** The npm package we're importing from, if any */
			let current: null | Package;

			if (importer.startsWith(NPM)) {
				const { name, version } = parse_npm_url(importer);
				current = await fetch_package(name, name === 'svelte' ? svelte_version : version);
			}

			// importing a relative file
			if (importee[0] === '.') {
				if (importer.startsWith(VIRTUAL)) {
					return resolve(virtual, importee, importer);
				}

				if (current) {
					const { name, version } = current.meta;
					const path = new URL(importee, importer).href.replace(`${NPM}/${name}@${version}/`, '');

					return normalize_path(current, path, importee, importer);
				}

				const resolved_url = new URL(importee, importer).href;

				// Normalize local spektral imports to include file extension,
				// so that './foo' and './foo.js' resolve to the same module ID.
				if (resolved_url.startsWith(`${location.origin}/spektral/`)) {
					return await resolve_local_spektral_relative(resolved_url);
				}

				return resolved_url;
			}

			// importing a file from the same package via pkg.imports
			if (importee[0] === '#') {
				if (current) {
					const subpath = resolve_subpath(current, importee);
					return normalize_path(current, subpath.slice(2), importee, importer);
				}
				return await resolve_local(importee);
			}

			// importing an external package -> `npm://$/<name>@<version>/<path>`
			const match = /^((?:@[^/]+\/)?[^/@]+)(?:@([^/]+))?(\/.+)?$/.exec(importee);
			if (!match) throw new Error(`Invalid import "${importee}"`);

			const pkg_name = match[1];

			if (pkg_name === 'react' || pkg_name === 'react-dom') {
				// Spektral's React adapter requires React 19, including ref cleanup support.
				const fallbackVersion = '19.2.8';
				const requestedVersion = match[2] ?? fallbackVersion;
				const resolvedVersion = await resolve_version(pkg_name, requestedVersion).catch(
					() => requestedVersion
				);
				const subpath = match[3] ?? '';
				if (pkg_name === 'react') {
					if (subpath === '/jsx-runtime') {
						return `https://esm.sh/react@${resolvedVersion}/es2022/jsx-runtime.development.mjs`;
					}
					if (subpath === '/jsx-dev-runtime') {
						return `https://esm.sh/react@${resolvedVersion}/es2022/jsx-dev-runtime.development.mjs`;
					}
					return `https://esm.sh/react@${resolvedVersion}/es2022/react.development.mjs`;
				}

				if (subpath === '/client') {
					return `https://esm.sh/react-dom@${resolvedVersion}/es2022/client.development.bundle.mjs`;
				}
				return `https://esm.sh/react-dom@${resolvedVersion}/es2022/react-dom.development.mjs`;
			}

			if (pkg_name === 'svelte' && svelte_version === 'local') {
				return await resolve_local(importee);
			}

			// Resolve local workspace package only in development.
			// In deployed runtimes (e.g. Cloudflare Workers), local filesystem-backed
			// package serving may be unavailable, so we fall back to npm resolution.
			if (pkg_name === 'spektral' && DEV) {
				try {
					return await resolve_local_spektral(importee);
				} catch (error) {
					console.warn(
						`[bundler] Failed to resolve local spektral for "${importee}", falling back to npm resolution`,
						error
					);
				}
			}

			let default_version = 'latest';

			if (current) {
				// use the version specified in importer's package.json, not `latest`
				const { meta } = current;

				if (meta.name === pkg_name) {
					default_version = meta.version;
				} else {
					default_version = max(
						meta.devDependencies?.[pkg_name] ??
							meta.peerDependencies?.[pkg_name] ??
							meta.dependencies?.[pkg_name]
					);
				}
			}

			const v = await resolve_version(match[1], match[2] ?? default_version);
			const pkg = await fetch_package(pkg_name, pkg_name === 'svelte' ? svelte_version : v);
			const subpath = resolve_subpath(pkg, '.' + (match[3] ?? ''));

			return normalize_path(pkg, subpath.slice(2), importee, importer);
		},
		async load(resolved) {
			if (uid !== current_id) throw ABORT;

			if (resolved.startsWith(VIRTUAL)) {
				const url = new URL(resolved);
				const lookupHref = url.href.slice(0, url.href.length - url.search.length - url.hash.length);
				const file = virtual.get(lookupHref.slice(VIRTUAL.length + 1))!;
				if (url.searchParams.has('raw')) {
					return `export default ${JSON.stringify(file.contents)};`;
				}
				return file.contents;
			}

			if (resolved.startsWith(NPM)) {
				let [, name, v, subpath] = /^npm:\/\/\$\/((?:@[^/]+\/)?[^/@]+)(?:@([^/]+))?\/(.+)$/.exec(
					resolved
				)!;

				const pkg = await fetch_package(name, name === 'svelte' ? svelte_version : v);

				const file = pkg.contents[subpath];
				if (file) return file.text;
			}

			const response = await fetch(resolved);
			if (response.ok) return response.text();

			throw new Error(`Could not load ${resolved}`);
		},
		transform(code, id) {
			if (uid !== current_id) throw ABORT;

			const name = id.replace(VIRTUAL + '/', '').replace(NPM + '/', '');

			self.postMessage({ type: 'status', message: `bundling ${name}` });

			if (!/\.(svelte|js|ts|jsx|tsx)$/.test(id)) return null;

			let result: CompileResult;

			if (id.endsWith('.svelte')) {
				if (framework !== 'svelte' || !svelte) {
					throw new Error(`Unexpected .svelte file in ${framework} playground: ${name}`);
				}
				const is_gt_5 = Number(svelte.VERSION.split('.')[0]) >= 5;

				const compilerOptions: any = {
					filename: name,
					generate: is_gt_5 ? 'client' : 'dom',
					dev: false
				};

				if (is_gt_5) {
					compilerOptions.runes = options.runes;
				}

				if (can_use_experimental_async) {
					compilerOptions.experimental = { async: true };
				}

				result = svelte.compile(code, compilerOptions);

				if (result.css?.code) {
					// resolve local files by inlining them
					result.css.code = result.css.code.replace(
						/url\(['"]?\.\/(.+?\.(svg|webp|png))['"]?\)/g,
						(match, $1, $2) => {
							if (virtual.has($1)) {
								if ($2 === 'svg') {
									return `url('data:image/svg+xml;base64,${btoa(virtual.get($1)!.contents)}')`;
								} else {
									return `url('data:image/${$2};base64,${virtual.get($1)!.contents}')`;
								}
							} else {
								return match;
							}
						}
					);
					// add the CSS via injecting a style tag
					result.js.code +=
						'\n\n' +
						`
					import { styles as $$_styles } from '${VIRTUAL}/${STYLES}';
					const $$__style = document.createElement('style');
					$$__style.textContent = ${JSON.stringify(result.css.code)};
					document.head.append($$__style);
					$$_styles.push($$__style);
				`.replace(/\t/g, '');
				}
			} else if (/\.svelte\.(js|ts)$/.test(id)) {
				if (framework !== 'svelte' || !svelte) {
					throw new Error(`Unexpected .svelte module in ${framework} playground: ${name}`);
				}
				const compilerOptions: any = {
					filename: name,
					generate: 'client',
					dev: false
				};

				if (can_use_experimental_async) {
					compilerOptions.experimental = { async: true };
				}

				result = svelte.compileModule?.(code, compilerOptions);

				if (!result) {
					return null;
				}
			} else {
				return null;
			}

			// @ts-expect-error
			(result.warnings || result.stats?.warnings)?.forEach((warning) => {
				// This is required, otherwise postMessage won't work
				// @ts-ignore
				delete warning.toString;
				// TODO remove stats post-launch
				// @ts-ignore
				warnings.push(warning);
			});

			const transform_result: TransformResult = {
				code: result.js.code,
				map: result.js.map
			};

			return transform_result;
		}
	};

	const cssById = previous?.key === key ? new Map(previous.cssById) : new Map<string, string>();
	let activeCssIds: string[] = [];

	bundle = await rollup({
		input: './__entry.js',
		// Vue playground rebuilds can retain stale module state in Rollup's incremental
		// cache, which breaks repeated runtime error surfacing in the preview.
		// Use a fresh graph for Vue while keeping cache for Svelte/React rebuild speed.
		cache: framework === 'vue' ? false : previous?.key === key ? previous.cache : true,
		plugins: [
			alias_plugin(undefined, virtual),
			typegpuTransformPlugin(),
			vueSfcPlugin(),
			reactJsxPlugin(),
			typescript_strip_types,
			repl_plugin,
			commonjs,
			json,
			svg,
			mp3,
			image,
			glsl,
			replace({
				'process.env.NODE_ENV': JSON.stringify('production'),
				__VUE_OPTIONS_API__: JSON.stringify(true),
				__VUE_PROD_DEVTOOLS__: JSON.stringify(false),
				__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false)
			}),
			{
				name: 'css',
				buildEnd() {
					activeCssIds = [...this.getModuleIds()].filter((id) => id.endsWith('.css'));
				},
				transform(code, id) {
					if (id.endsWith('.css')) {
						// We do not resolve nested CSS imports in the playground runtime.
						cssById.set(id, code.replace(/@import\s+["'][^"']+["'][^;]*;/g, ''));
						return {
							code: '',
							map: null
						};
					}
				}
			}
		],
		onwarn(warning) {
			all_warnings.push({
				message: warning.message
			});
		}
	});

	const activeCssById = new Map<string, string>();
	for (const id of activeCssIds) {
		const css = cssById.get(id);
		if (css !== undefined) {
			activeCssById.set(id, css);
		}
	}
	const user_css = [...activeCssById.values()].join('\n');

	previous = { key, cache: bundle.cache, cssById: activeCssById };

	return {
		bundle,
		css: user_css ? user_css : null,
		error: null,
		warnings,
		all_warnings
	};
}

async function bundle(
	framework: BundleOptions['framework'],
	svelte: typeof import('svelte/compiler') | null,
	svelte_version: string,
	uid: number,
	files: File[],
	options: BundleOptions,
	can_use_experimental_async: boolean
): Promise<BundleResult> {
	if (!DEV && framework === 'svelte' && svelte) {
		console.log(`running Svelte compiler version %c${svelte.VERSION}`, 'font-weight: bold');
	}

	const lookup: Map<string, File> = new Map();

	if (framework === 'svelte') {
		if (!svelte) {
			throw new Error('Svelte compiler is not loaded for svelte playground bundle.');
		}

		lookup.set(ENTRYPOINT, {
			type: 'file',
			name: ENTRYPOINT,
			basename: ENTRYPOINT,
			contents:
				svelte.VERSION.split('.')[0] >= '5'
					? `
				import { unmount as u } from 'svelte';
				import { styles } from '${VIRTUAL}/${STYLES}';
				export { mount, untrack } from 'svelte';
				export { default as App } from '${VIRTUAL}/${WRAPPER}';
				export function unmount(component) {
					u(component);
					styles.forEach(style => style.remove());
				}
			`
					: `
				import { styles } from '${VIRTUAL}/${STYLES}';
				export { default as App } from './App.svelte';
				export function mount(component, options) {
					return new component(options);
				}
				export function unmount(component) {
					component.$destroy();
					styles.forEach(style => style.remove());
				}
				export function untrack(fn) {
					return fn();
				}
			`,
			text: true
		});

		const wrapper = can_use_experimental_async
			? `
			<script>
				import App from './App.svelte';
			</script>

			<svelte:boundary>
				<App />

				{#snippet pending()}{/snippet}
			</svelte:boundary>
		`
			: `
			<script>
				import App from './App.svelte';
			</script>

			<App />
		`;

		lookup.set(WRAPPER, {
			type: 'file',
			name: WRAPPER,
			basename: WRAPPER,
			contents: wrapper,
			text: true
		});
	} else if (framework === 'react') {
		const reactAppModule = files.some((file) => file.name === 'App.tsx')
			? './App.tsx'
			: files.some((file) => file.name === 'App.jsx')
				? './App.jsx'
				: './App.tsx';

		lookup.set(ENTRYPOINT, {
			type: 'file',
			name: ENTRYPOINT,
			basename: ENTRYPOINT,
			contents: `
				import React from 'react';
				import { createRoot } from 'react-dom/client';
				import { styles } from '${VIRTUAL}/${STYLES}';
				export { default as App } from '${reactAppModule}';
				export function mount(component, options) {
					const root = createRoot(options.target);
					root.render(React.createElement(component));
					return root;
				}
				export function unmount(root) {
					root?.unmount?.();
					styles.forEach(style => style.remove());
				}
				export function untrack(fn) {
					return fn();
				}
			`,
			text: true
		});
	} else if (framework === 'vue') {
		const vueAppModule = files.some((file) => file.name === 'App.vue')
			? './App.vue'
			: files.some((file) => file.name === 'App.ts')
				? './App.ts'
				: './App.js';

		lookup.set(ENTRYPOINT, {
			type: 'file',
			name: ENTRYPOINT,
			basename: ENTRYPOINT,
			contents: `
				import { createApp, h } from 'vue';
				import { styles } from '${VIRTUAL}/${STYLES}';
				export { default as App } from '${vueAppModule}';
				export function mount(component, options) {
					const app = createApp({
						render() {
							return h(component);
						}
					});
					app.mount(options.target);
					return app;
				}
				export function unmount(app) {
					app?.unmount?.();
					styles.forEach(style => style.remove());
				}
				export function untrack(fn) {
					return fn();
				}
			`,
			text: true
		});
	} else {
		throw new Error(`Unsupported playground framework: ${framework}`);
	}

	lookup.set(STYLES, {
		type: 'file',
		name: STYLES,
		basename: STYLES,
		contents: `
			export let styles = [];
		`,
		text: true
	});

	lookup.set(ESM_ENV, {
		type: 'file',
		name: ESM_ENV,
		basename: ESM_ENV,
		contents: `
			export const BROWSER = true;
			export const DEV = true;
		`,
		text: true
	});

	files.forEach((file) => {
		lookup.set(file.name, file);
	});

	try {
		let client: Awaited<ReturnType<typeof get_bundle>> = await get_bundle(
			framework,
			svelte,
			svelte_version,
			uid,
			lookup,
			options,
			can_use_experimental_async
		);

		const client_result = (
			await client.bundle?.generate({
				format: 'iife',
				exports: 'named',
				inlineDynamicImports: true
				// sourcemap: 'inline'
			})
		)?.output[0];

		return {
			uid,
			error: null,
			client: client_result,
			css: client.css
		};
	} catch (err) {
		console.error(err);

		const e = err as CompileError; // TODO could be a non-Svelte error?

		return {
			uid,
			error: { ...e, message: e.message }, // not all Svelte versions return an enumerable message property
			client: null,
			css: null
		};
	}
}
