import { labels } from '$lib/site/labels';
import { contentUiDefaults, formatUiText } from '$lib/site/content-ui';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css as cssLanguage } from '@codemirror/lang-css';
import { html as htmlLanguage } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json as jsonLanguage } from '@codemirror/lang-json';
import { wgsl as wgslLanguage } from '@iizukak/codemirror-lang-wgsl';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import {
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	type ViewUpdate
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { svelte as svelteLanguage } from '@replit/codemirror-lang-svelte';
import { env as publicEnv } from '$env/dynamic/public';
import { siteConfig } from '$lib/site/site';
import { dev } from '$app/environment';
import { synchronizedEditorScroll } from '$lib/playground-engine/editor/scroll';
import { resolvePreviewOrigin } from '$lib/playground-engine/preview/origin';
import {
	getPlaygroundDemoVariant,
	type PlaygroundFramework,
	resolvePlaygroundDemoId
} from './playground-demos';
import {
	Bundler,
	ReplProxy,
	buildEvalScript,
	type BundleResult,
	type PlaygroundFile
} from '$lib/playground-engine';
import previewDefaultStyles from '$lib/playground-engine/preview/runtime-shell/styles.css?raw';
import {
	PLAYGROUND_PREVIEW_EVENT_ORIGIN,
	PLAYGROUND_PREVIEW_TARGET_ORIGIN
} from '$lib/playground-engine/preview/protocol';

type EditorThemeMode = 'light' | 'dark';
const playgroundFrameworks: PlaygroundFramework[] = ['svelte', 'react', 'vue'];
const PLAYGROUND_PREVIEW_ROUTE = siteConfig.preview.embedPath;
const previewThemeTokens: Record<EditorThemeMode, { background: string; foreground: string }> = {
	light: {
		background: 'oklch(1 0 0)',
		foreground: 'oklch(0.1881 0.006 265)'
	},
	dark: {
		background: 'oklch(0.2574 0.0056 265)',
		foreground: 'oklch(0.9674 0.0013 265)'
	}
};

const createPreviewSessionId = () => crypto.randomUUID();

const editorFontStack = 'var(--font-mono)';

const compactLogForDisplay = (value: string) =>
	value
		.replace(/\n{3,}/g, '\n\n')
		.replace(/^(?:[ \t]*\n)+/, '')
		.replace(/[ \t]+\n/g, '\n');

const buildPreviewThemeStyle = (mode: EditorThemeMode): string => {
	const tokens = previewThemeTokens[mode];
	const siteTheme = getComputedStyle(document.documentElement);
	const background = siteTheme.getPropertyValue('--background').trim() || tokens.background;
	const foreground = siteTheme.getPropertyValue('--foreground').trim() || tokens.foreground;
	const colorScheme = mode === 'dark' ? 'dark' : 'light';
	return `
:root {
	color-scheme: ${colorScheme};
}

html,
body {
	background: ${background};
	color: ${foreground};
}
`;
};

const formatBundleError = (error: NonNullable<BundleResult['error']>) => {
	const location =
		error.filename && error.start
			? `${error.filename}:${error.start.line}:${error.start.column}`
			: error.filename
				? error.filename
				: '';
	const frame = 'frame' in error && typeof error.frame === 'string' ? error.frame : '';
	const details = [location, error.message, frame].filter(Boolean).join('\n');
	return details || 'Bundle failed.';
};

const resolvePlaygroundFramework = (
	value: PlaygroundFramework | string | null | undefined
): PlaygroundFramework => (value === 'react' ? 'react' : value === 'vue' ? 'vue' : 'svelte');

const resolveEnabledFramework = (value: string | null | undefined): PlaygroundFramework =>
	contentUiDefaults.framework.enabled.includes(value as PlaygroundFramework)
		? (value as PlaygroundFramework)
		: contentUiDefaults.framework.default;

const editorSyntaxTheme = syntaxHighlighting(
	HighlightStyle.define([
		{
			tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword],
			color: 'var(--playground-token-keyword)'
		},
		{ tag: [t.string, t.special(t.string), t.docString], color: 'var(--playground-token-string)' },
		{
			tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom],
			color: 'var(--playground-token-number)'
		},
		{
			tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
			color: 'var(--playground-token-comment)'
		},
		{
			tag: [t.typeName, t.className, t.namespace],
			color: 'var(--playground-token-type)'
		},
		{
			tag: [t.function(t.variableName), t.function(t.propertyName)],
			color: 'var(--playground-token-function)'
		},
		{ tag: [t.tagName], color: 'var(--playground-token-tag)' },
		{
			tag: [t.propertyName, t.attributeName, t.labelName],
			color: 'var(--playground-token-property)'
		},
		{ tag: [t.macroName], color: 'var(--playground-token-variable)' },
		{ tag: [t.variableName, t.name], color: 'var(--playground-token-variable)' },
		{
			tag: [t.regexp, t.escape, t.special(t.variableName), t.url],
			color: 'var(--playground-token-constant)'
		},
		{ tag: [t.invalid], color: 'var(--playground-token-invalid)' }
	])
);

const createEditorTheme = (mode: EditorThemeMode) =>
	EditorView.theme(
		{
			'&': {
				height: '100%',
				minHeight: '0',
				fontSize: '0.8125rem',
				backgroundColor: 'var(--playground-editor-bg)',
				color: 'var(--playground-editor-fg)'
			},
			'.cm-scroller': {
				fontFamily: editorFontStack,
				lineHeight: '1.55',
				overflow: 'auto'
			},
			'.cm-content': {
				padding: '16px 0',
				width: 'max-content',
				minWidth: '0'
			},
			'.cm-line': {
				padding: '0 12px 0 14px'
			},
			'.cm-gutters': {
				backgroundColor: 'var(--playground-editor-gutter-bg)',
				borderRight: '1px solid var(--playground-editor-gutter-border)',
				color: 'var(--playground-editor-gutter-fg)',
				minWidth: '52px',
				position: 'sticky',
				left: '0',
				zIndex: '2'
			},
			'.cm-lineNumbers': {
				width: '52px',
				minWidth: '52px',
				maxWidth: '52px'
			},
			'.cm-lineNumbers .cm-gutterElement': {
				boxSizing: 'border-box',
				width: '100%',
				padding: '0 8px 0 0',
				textAlign: 'right'
			},
			'.cm-activeLine': {
				backgroundColor: 'var(--playground-editor-active-line-bg)'
			},
			'.cm-activeLineGutter': {
				backgroundColor: 'var(--playground-editor-active-line-bg)'
			},
			'.cm-selectionBackground': {
				backgroundColor: 'var(--playground-editor-selection-bg) !important'
			},
			'&.cm-focused': {
				outline: 'none'
			},
			'&.cm-focused .cm-cursor': {
				borderLeftColor: 'var(--playground-editor-cursor)'
			}
		},
		{ dark: mode === 'dark' }
	);

const languageExtensionForPath = (filePath: string): Extension => {
	if (filePath.endsWith('.svelte')) return svelteLanguage();
	if (filePath.endsWith('.vue')) return htmlLanguage();
	if (filePath.endsWith('.tsx')) {
		return javascript({ typescript: true, jsx: true });
	}
	if (filePath.endsWith('.jsx')) {
		return javascript({ jsx: true });
	}
	if (filePath.endsWith('.ts') || filePath.endsWith('.d.ts')) {
		return javascript({ typescript: true });
	}
	if (filePath.endsWith('.js')) return javascript();
	if (filePath.endsWith('.json')) return jsonLanguage();
	if (filePath.endsWith('.html')) return htmlLanguage();
	if (filePath.endsWith('.css')) return cssLanguage();
	if (filePath.endsWith('.wgsl')) return wgslLanguage();
	return [];
};

const playgroundEditorBaseExtensions: Extension[] = [
	EditorView.contentAttributes.of({ 'aria-label': 'Source code' }),
	synchronizedEditorScroll,
	lineNumbers(),
	highlightActiveLineGutter(),
	highlightSpecialChars(),
	highlightActiveLine(),
	history(),
	keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap])
];

/**
 * Creates the reactive editor, bundler, and authenticated preview lifecycle for the playground.
 */
export const createPlaygroundController = (
	initialDemoId?: string | null,
	initialFramework?: PlaygroundFramework | string | null
) => {
	let editorHost: HTMLDivElement | null = null;
	let editorInstance: EditorView | null = null;
	let suppressEditorUpdate = false;

	let bundler: Bundler | null = null;
	let bundleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let latestBundle: BundleResult | null = null;
	let isBundleRunning = false;
	let hasPendingBundle = false;
	let lastResolvedSvelteVersion = 'latest';

	let previewFrame: HTMLIFrameElement | null = null;
	let previewProxy: ReplProxy | null = null;
	let previewLoadCleanup: (() => void) | null = null;
	let previewReady = false;
	let previewSessionId = '';
	let previewTargetOrigin = '';
	let isMounted = false;

	let previewReloadToken = $state(0);
	let previewUrl = $state('');
	let errorMessage = $state('');
	let syncError = $state('');
	let runtimeLog = $state('');
	let status = $state(labels.playground.status.initializing);
	let isSyncing = $state(false);
	let syncingPath = $state('');
	let activeEditorTheme: EditorThemeMode =
		typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
			? 'dark'
			: 'light';

	const languageCompartment = new Compartment();
	const themeCompartment = new Compartment();

	const runtimeTemplateRawModules = import.meta.glob('./runtime-template/*/src/**/*', {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>;

	const runtimeTemplateFilesByFramework = playgroundFrameworks.reduce<
		Record<PlaygroundFramework, Record<string, string>>
	>(
		(acc, framework) => {
			acc[framework] = {};
			return acc;
		},
		{
			svelte: {},
			react: {},
			vue: {}
		}
	);

	for (const [path, source] of Object.entries(runtimeTemplateRawModules)) {
		const match = path.match(/\/runtime-template\/([^/]+)\/src\/(.+)$/);
		if (!match) continue;
		const framework = resolvePlaygroundFramework(match[1]);
		const relativePath = `src/${match[2]}`;
		runtimeTemplateFilesByFramework[framework][relativePath] = source;
	}

	const frameworkEntryPaths: Record<PlaygroundFramework, { appPath: string; runtimePath: string }> =
		{
			svelte: { appPath: 'src/App.svelte', runtimePath: 'src/runtime.svelte' },
			react: { appPath: 'src/App.tsx', runtimePath: 'src/runtime.tsx' },
			vue: { appPath: 'src/App.vue', runtimePath: 'src/runtime.vue' }
		};
	const reservedDemoSourceFileNames: readonly string[] = [
		'App.svelte',
		'runtime.svelte',
		'App.tsx',
		'runtime.tsx',
		'App.vue',
		'runtime.vue'
	];

	const initialResolvedDemoId = resolvePlaygroundDemoId(initialDemoId);
	const initialResolvedFramework = resolveEnabledFramework(initialFramework);
	let activeFramework = $state(initialResolvedFramework);
	const activeDemoId = initialResolvedDemoId;
	let activeFilePath = $state(frameworkEntryPaths[initialResolvedFramework].appPath);
	const sortFilePaths = (paths: string[], framework: PlaygroundFramework): string[] => {
		const entryPaths = frameworkEntryPaths[framework];
		return [...paths].sort((left, right) => {
			if (left === right) return 0;
			if (left === entryPaths.appPath) return -1;
			if (right === entryPaths.appPath) return 1;
			if (left === entryPaths.runtimePath) return -1;
			if (right === entryPaths.runtimePath) return 1;
			return left.localeCompare(right);
		});
	};

	const toFilesForDemo = (
		demoId: string,
		frameworkInput: PlaygroundFramework | string = activeFramework
	) => {
		const resolvedDemoId = resolvePlaygroundDemoId(demoId);
		const framework = resolvePlaygroundFramework(frameworkInput);
		const demoVariant = getPlaygroundDemoVariant(resolvedDemoId, framework);
		const baseFiles = runtimeTemplateFilesByFramework[framework] ?? {};
		const entryPaths = frameworkEntryPaths[framework];

		if (!demoVariant) return { ...baseFiles };

		const files: Record<string, string> = {
			...baseFiles,
			[entryPaths.appPath]: demoVariant.appSource
		};

		if (typeof demoVariant.runtimeSource === 'string') {
			files[entryPaths.runtimePath] = demoVariant.runtimeSource;
		}

		for (const [relativePath, source] of Object.entries(demoVariant.additionalFiles ?? {})) {
			const normalizedPath = relativePath.replace(/^\.?\//, '');
			if (!normalizedPath || reservedDemoSourceFileNames.includes(normalizedPath)) {
				continue;
			}
			files[`src/${normalizedPath}`] = source;
		}

		return files;
	};

	const initialDemoFiles = toFilesForDemo(initialResolvedDemoId, initialResolvedFramework);
	const initialFilePaths = sortFilePaths(Object.keys(initialDemoFiles), initialResolvedFramework);
	let fileContents = $state<Record<string, string>>(initialDemoFiles);
	let openFilePaths = $state<string[]>([...initialFilePaths]);
	const runtimeLogTail = $derived(
		compactLogForDisplay(runtimeLog).split('\n').slice(-120).join('\n')
	);

	const appendLog = (chunk: string) => {
		runtimeLog = (runtimeLog + chunk + '\n').slice(-50000);
	};

	const rebuildPreviewUrl = () => {
		if (typeof window === 'undefined') return;

		previewSessionId = createPreviewSessionId();
		const configuredOrigin =
			publicEnv.PUBLIC_PLAYGROUND_PREVIEW_ORIGIN?.trim() || (dev ? '' : siteConfig.preview.origin);
		const origin = resolvePreviewOrigin(window.location.origin, configuredOrigin, dev);
		const query = [
			`session=${encodeURIComponent(previewSessionId)}`,
			`parent_origin=${encodeURIComponent(window.location.origin)}`,
			`theme=${encodeURIComponent(activeEditorTheme)}`,
			`v=${encodeURIComponent(String(previewReloadToken))}`
		].join('&');

		previewTargetOrigin = origin;
		previewUrl = `${origin}${PLAYGROUND_PREVIEW_ROUTE}?${query}`;
	};

	const reloadPreviewFrame = () => {
		previewReloadToken += 1;
		rebuildPreviewUrl();
	};

	rebuildPreviewUrl();

	const toBundlerFiles = (flatFiles: Record<string, string>): PlaygroundFile[] =>
		Object.entries(flatFiles)
			.filter(([filePath]) => filePath.startsWith('src/'))
			.map(([filePath, contents]) => {
				const name = filePath.slice(4);
				return {
					type: 'file',
					name,
					basename: name.split('/').at(-1) ?? name,
					contents,
					text: true
				};
			});

	const applyEditorTheme = (mode: EditorThemeMode) => {
		if (!editorInstance) return;
		editorInstance.dispatch({
			effects: themeCompartment.reconfigure([createEditorTheme(mode), editorSyntaxTheme])
		});
	};

	const syncEditorWithActiveFile = () => {
		if (!editorInstance) return;

		const nextContents = fileContents[activeFilePath] ?? '';
		const previousContents = editorInstance.state.doc.toString();
		const languageEffect = languageCompartment.reconfigure(
			languageExtensionForPath(activeFilePath)
		);

		if (previousContents === nextContents) {
			editorInstance.dispatch({ effects: languageEffect });
			return;
		}

		suppressEditorUpdate = true;
		try {
			editorInstance.dispatch({
				changes: {
					from: 0,
					to: previousContents.length,
					insert: nextContents
				},
				effects: languageEffect
			});
		} finally {
			suppressEditorUpdate = false;
		}
	};

	const handleEditorUpdate = (update: ViewUpdate) => {
		if (!update.docChanged || suppressEditorUpdate) return;
		const nextValue = update.state.doc.toString();
		const filePath = activeFilePath;
		if ((fileContents[filePath] ?? '') === nextValue) return;
		fileContents = { ...fileContents, [filePath]: nextValue };
		syncingPath = filePath;
		queueBundle();
	};

	const ensureEditor = () => {
		if (!editorHost || editorInstance) return;

		try {
			editorInstance = new EditorView({
				parent: editorHost,
				state: EditorState.create({
					doc: fileContents[activeFilePath] ?? '',
					extensions: [
						playgroundEditorBaseExtensions,
						EditorState.tabSize.of(2),
						indentUnit.of('  '),
						languageCompartment.of(languageExtensionForPath(activeFilePath)),
						themeCompartment.of([createEditorTheme(activeEditorTheme), editorSyntaxTheme]),
						EditorView.updateListener.of(handleEditorUpdate)
					]
				})
			});
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : 'Could not initialize CodeMirror editor.';
		}
	};

	const destroyEditor = () => {
		editorInstance?.destroy();
		editorInstance = null;
	};

	const switchToFile = (filePath: string) => {
		if (!(filePath in fileContents)) return;

		activeFilePath = filePath;
		syncEditorWithActiveFile();
		editorInstance?.focus();
	};

	const applyBundleToPreview = async (bundle: BundleResult) => {
		if (!previewProxy || !previewReady) {
			return;
		}
		if (bundle.error) {
			return;
		}

		const script = buildEvalScript(bundle);
		if (!script) return;

		const previewStyle = `${previewDefaultStyles}\n${buildPreviewThemeStyle(activeEditorTheme)}\n${bundle.css ?? ''}`;
		await previewProxy.eval(script, previewStyle);
	};

	const runBundle = async () => {
		if (!bundler) return;
		if (isBundleRunning) {
			hasPendingBundle = true;
			return;
		}

		isBundleRunning = true;
		isSyncing = true;
		syncError = '';
		errorMessage = '';
		status = labels.playground.status.bundling;

		try {
			const files = toBundlerFiles(fileContents);
			const expectedAppFile = frameworkEntryPaths[activeFramework].appPath;
			const expectedAppModule = expectedAppFile.slice(4);
			if (!files.some((file) => file.name === expectedAppModule)) {
				throw new Error(`Missing ${expectedAppFile} in playground files.`);
			}

			await bundler.bundle(files, {
				framework: activeFramework,
				svelte_version: lastResolvedSvelteVersion,
				runes: true
			});

			latestBundle = bundler.result;
			if (!latestBundle) {
				throw new Error('Bundler did not return an output payload.');
			}

			if (latestBundle.error) {
				errorMessage = formatBundleError(latestBundle.error);
				status = labels.playground.status.buildFailed;
				return;
			}

			await applyBundleToPreview(latestBundle);
			status = labels.playground.status.ready;
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : 'Could not bundle playground sources.';
			status = labels.playground.status.buildFailed;
		} finally {
			isSyncing = false;
			syncingPath = '';
			isBundleRunning = false;
			if (hasPendingBundle) {
				hasPendingBundle = false;
				void runBundle();
			}
		}
	};

	const queueBundle = () => {
		if (bundleDebounceTimer) {
			clearTimeout(bundleDebounceTimer);
		}
		bundleDebounceTimer = setTimeout(() => {
			bundleDebounceTimer = null;
			void runBundle();
		}, 140);
	};

	const disconnectPreviewProxy = () => {
		previewLoadCleanup?.();
		previewLoadCleanup = null;
		previewReady = false;
		previewProxy?.destroy();
		previewProxy = null;
	};

	const connectPreviewProxy = () => {
		if (!previewFrame || !isMounted || !previewTargetOrigin || !previewSessionId) {
			return;
		}

		disconnectPreviewProxy();

		const frame = previewFrame;
		previewProxy = new ReplProxy(
			frame,
			{
				on_error: (event) => {
					appendLog(`[preview:error] ${String(event?.value ?? 'Unknown runtime error')}`);
					errorMessage = `Runtime error in preview: ${String(event?.value ?? 'unknown')}`;
				},
				on_unhandled_rejection: (event) => {
					appendLog(`[preview:unhandledrejection] ${String(event?.value ?? 'Unknown rejection')}`);
				}
			},
			{
				targetOrigin: PLAYGROUND_PREVIEW_TARGET_ORIGIN,
				expectedOrigin: PLAYGROUND_PREVIEW_EVENT_ORIGIN,
				sessionId: previewSessionId
			}
		);

		const onLoad = () => {
			if (frame !== previewFrame) return;
			void (async () => {
				try {
					await previewProxy?.wait_until_ready();
					if (frame !== previewFrame) return;
					previewReady = true;
					await previewProxy?.handle_links();
					if (latestBundle && !latestBundle.error) {
						await applyBundleToPreview(latestBundle);
					}
				} catch (error) {
					if (frame !== previewFrame) return;
					const message =
						error instanceof Error ? error.message : 'Could not initialize preview frame.';
					appendLog(`[preview:connect] ${message}`);
					errorMessage = message;
					status = labels.playground.status.previewFailed;
				}
			})();
		};

		frame.addEventListener('load', onLoad);
		previewLoadCleanup = () => frame.removeEventListener('load', onLoad);
	};

	const setEditorHost = (nextHost: HTMLDivElement | null) => {
		if (editorHost === nextHost) return;
		editorHost = nextHost;

		if (!isMounted) return;

		destroyEditor();
		ensureEditor();
	};

	const setPreviewFrame = (nextFrame: HTMLIFrameElement | null) => {
		if (previewFrame === nextFrame) {
			return;
		}

		previewFrame = nextFrame;
		if (!nextFrame) {
			disconnectPreviewProxy();
			return;
		}

		connectPreviewProxy();
	};

	const retryRuntime = () => {
		errorMessage = '';
		syncError = '';
		runtimeLog = '';
		status = labels.playground.status.reloading;
		reloadPreviewFrame();
		queueBundle();
	};

	const switchFramework = (nextFramework: PlaygroundFramework | string | null | undefined) => {
		const resolvedFramework = resolveEnabledFramework(nextFramework);
		if (resolvedFramework === activeFramework) return;

		const demoVariant = getPlaygroundDemoVariant(activeDemoId, resolvedFramework);
		if (activeDemoId && !demoVariant) return;

		activeFramework = resolvedFramework;
		errorMessage = '';
		syncError = '';
		runtimeLog = '';
		latestBundle = null;
		reloadPreviewFrame();

		const nextFileContents = toFilesForDemo(activeDemoId, resolvedFramework);
		const frameworkEntry = frameworkEntryPaths[resolvedFramework].appPath;
		const sortedPaths = sortFilePaths(Object.keys(nextFileContents), resolvedFramework);

		fileContents = nextFileContents;
		openFilePaths = [...sortedPaths];
		activeFilePath = frameworkEntry;

		syncEditorWithActiveFile();
		editorInstance?.focus();
		status = formatUiText(labels.playground.status.switchedFramework, {
			framework: labels.framework.names[resolvedFramework]
		});
		queueBundle();
	};

	const setEditorTheme = (mode: EditorThemeMode) => {
		if (activeEditorTheme === mode) return;
		activeEditorTheme = mode;
		applyEditorTheme(mode);
		if (latestBundle && !latestBundle.error) {
			void applyBundleToPreview(latestBundle);
		}
	};

	const mount = () => {
		let isDisposed = false;
		isMounted = true;

		const setupBundler = () => {
			bundler = new Bundler({
				svelte_version: 'latest',
				onstatus: (message) => {
					if (isDisposed) return;
					if (message) {
						status = message;
					}
				},
				onversion: (version) => {
					lastResolvedSvelteVersion = version;
				},
				onerror: (message) => {
					if (isDisposed) return;
					errorMessage = message;
					status = labels.playground.status.buildFailed;
				}
			});
		};

		const onVisibilityChange = () => {
			if (document.visibilityState !== 'visible') return;
			editorInstance?.requestMeasure();
		};

		ensureEditor();
		setupBundler();
		connectPreviewProxy();
		queueBundle();
		document.addEventListener('visibilitychange', onVisibilityChange);

		return () => {
			isDisposed = true;
			isMounted = false;
			document.removeEventListener('visibilitychange', onVisibilityChange);
			if (bundleDebounceTimer) {
				clearTimeout(bundleDebounceTimer);
				bundleDebounceTimer = null;
			}
			disconnectPreviewProxy();
			bundler?.destroy();
			bundler = null;
			destroyEditor();
		};
	};

	return {
		get activeDemoId() {
			return activeDemoId;
		},
		get activeFramework() {
			return activeFramework;
		},
		get activeFilePath() {
			return activeFilePath;
		},
		get errorMessage() {
			return errorMessage;
		},
		get isSyncing() {
			return isSyncing;
		},
		get frameworks() {
			return playgroundFrameworks;
		},
		get openFilePaths() {
			return openFilePaths;
		},
		get previewFrameKey() {
			return String(previewReloadToken);
		},
		get previewUrl() {
			return previewUrl;
		},
		get runtimeLog() {
			return runtimeLog;
		},
		get runtimeLogTail() {
			return runtimeLogTail;
		},
		get status() {
			return status;
		},
		get syncError() {
			return syncError;
		},
		get syncingPath() {
			return syncingPath;
		},
		mount,
		retryRuntime,
		setEditorHost,
		setEditorTheme,
		setPreviewFrame,
		switchFramework,
		switchToFile
	};
};

export type PlaygroundController = ReturnType<typeof createPlaygroundController>;
