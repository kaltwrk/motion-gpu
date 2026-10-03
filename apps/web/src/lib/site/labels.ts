/** Shared interface copy. View-specific copy and switches live in content-ui.ts. */
export const labels = {
	code: {
		example: 'Code example',
		copyClipboard: 'Copy code to clipboard',
		copy: 'Copy code',
		copied: 'Code copied',
		success: 'Code copied to clipboard.',
		failure: 'Could not copy the code.',
		failed: 'Could not copy code',
		copyInstall: 'Copy install command to clipboard',
		packageManager: 'Package manager',
		scrollableCode: 'Scrollable code',
		scrollableTable: 'Scrollable table'
	},
	framework: {
		label: 'Framework',
		tabs: 'Component framework',
		switch: 'Switch framework to {framework}',
		names: { svelte: 'Svelte', react: 'React', vue: 'Vue' }
	},
	heading: {
		copy: 'Copy link to this section',
		copied: 'Section link copied',
		failed: 'Could not copy the section link',
		success: 'Section link copied to clipboard.',
		failure: 'Could not copy the section link.'
	},
	mobileSidebar: { title: 'Sidebar', description: 'Choose a view or navigate its pages.' },
	playground: {
		title: 'Playground',
		loading: 'Loading playground…',
		loadFailed: 'The playground could not load',
		reloadHint: 'Reload the page to try again.',
		reload: 'Reload playground',
		skipEditor: 'Skip to code editor',
		resize: 'Resize preview panel',
		resizeHint:
			'Drag or use the arrow keys to resize. Hold Shift for larger steps. Press Home or double-click to reset.',
		sourceEditor: 'Source editor',
		sourceFiles: 'Source files',
		codeEditor: 'Code editor',
		runtimeErrors: 'Runtime errors',
		needsAttention: 'Preview needs attention',
		preview: 'Live preview',
		previewTitle: 'Playground preview',
		previewError: 'Preview error',
		retryRuntime: 'Retry runtime',
		status: {
			initializing: 'Initializing playground...',
			bundling: 'Bundling playground...',
			buildFailed: 'Build failed',
			ready: 'Preview ready',
			previewFailed: 'Preview failed',
			reloading: 'Reloading preview...',
			switchedFramework: 'Switched framework: {framework}'
		}
	}
};
