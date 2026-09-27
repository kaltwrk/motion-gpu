<script lang="ts">
	import { themeStore } from '$lib/stores/theme.svelte';
	import PlaygroundEditor from './components/PlaygroundEditor.svelte';
	import PlaygroundHeader from './components/PlaygroundHeader.svelte';
	import PlaygroundPreview from './components/PlaygroundPreview.svelte';

	import type { PlaygroundController } from './playground-controller.svelte';

	let {
		controller,
		onSelectDemo,
		onSelectFramework,
		onEditorHostChange,
		onPreviewFrameChange
	}: {
		controller: PlaygroundController;
		onSelectDemo: (demoId: string) => void;
		onSelectFramework: (framework: string) => void;
		onEditorHostChange: (host: HTMLDivElement | null) => void;
		onPreviewFrameChange: (frame: HTMLIFrameElement | null) => void;
	} = $props();

	let workspaceHost: HTMLDivElement | null = null;
	let previewWidth = $state<number | null>(null);
	let previewHeight = $state<number | null>(null);
	let activeResizeHandle: HTMLButtonElement | null = null;
	let activeResize = $state<{
		pointerId: number;
		startX: number;
		startY: number;
		startPreviewWidth: number | null;
		startPreviewHeight: number | null;
	} | null>(null);

	const RESIZER_SIZE = 4;
	const MIN_EDITOR_WIDTH = 380;
	const MIN_PREVIEW_WIDTH = 260;
	const MIN_EDITOR_HEIGHT = 260;
	const MIN_PREVIEW_HEIGHT = 220;

	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
	const getWorkspaceWidth = () => workspaceHost?.clientWidth ?? 0;
	const getWorkspaceHeight = () => workspaceHost?.clientHeight ?? 0;
	const isDesktopViewport = () =>
		typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

	const getMaxPreviewWidth = (workspaceWidth: number) =>
		Math.max(MIN_PREVIEW_WIDTH, workspaceWidth - RESIZER_SIZE - MIN_EDITOR_WIDTH);
	const getMaxPreviewHeight = (workspaceHeight: number) =>
		Math.max(MIN_PREVIEW_HEIGHT, workspaceHeight - RESIZER_SIZE - MIN_EDITOR_HEIGHT);

	const getDefaultPreviewWidth = (workspaceWidth: number) =>
		Math.round((workspaceWidth - RESIZER_SIZE) / 2);
	const getDefaultPreviewHeight = (workspaceHeight: number) =>
		Math.round((workspaceHeight - RESIZER_SIZE) / 2);

	const clampPanelSize = () => {
		if (isDesktopViewport()) {
			const workspaceWidth = getWorkspaceWidth();
			if (workspaceWidth <= 0 || previewWidth === null) return;
			previewWidth = clamp(previewWidth, MIN_PREVIEW_WIDTH, getMaxPreviewWidth(workspaceWidth));
			return;
		}

		const workspaceHeight = getWorkspaceHeight();
		if (workspaceHeight <= 0 || previewHeight === null) return;
		previewHeight = clamp(previewHeight, MIN_PREVIEW_HEIGHT, getMaxPreviewHeight(workspaceHeight));
	};

	const workspaceColumns = $derived.by(() => {
		if (previewWidth === null) {
			return `minmax(0,1fr) ${RESIZER_SIZE}px minmax(0,1fr)`;
		}
		return `minmax(0,1fr) ${RESIZER_SIZE}px ${Math.round(previewWidth)}px`;
	});
	const workspaceRows = $derived.by(() => {
		if (previewHeight === null) {
			return `minmax(0,1fr) ${RESIZER_SIZE}px minmax(0,1fr)`;
		}
		return `minmax(0,1fr) ${RESIZER_SIZE}px ${Math.round(previewHeight)}px`;
	});

	const demoSelectOptions = $derived.by(() =>
		controller.demos.map((demo) => ({
			value: demo.id,
			label: demo.name
		}))
	);

	const beginResize = (event: PointerEvent) => {
		if (event.button !== 0 || !workspaceHost) return;
		const handle = event.currentTarget;
		if (!(handle instanceof HTMLButtonElement)) return;

		event.preventDefault();
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			// Ignore if the browser cannot capture this pointer.
		}
		activeResizeHandle = handle;
		activeResize = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startPreviewWidth: previewWidth,
			startPreviewHeight: previewHeight
		};
		document.body.classList.add('playground-resizing');
	};

	const updateResize = (event: PointerEvent) => {
		if (!activeResize || !workspaceHost || event.pointerId !== activeResize.pointerId) return;

		if (isDesktopViewport()) {
			const workspaceWidth = getWorkspaceWidth();
			if (workspaceWidth <= 0) return;
			const deltaX = event.clientX - activeResize.startX;
			const baseWidth = activeResize.startPreviewWidth ?? getDefaultPreviewWidth(workspaceWidth);
			previewWidth = clamp(
				baseWidth - deltaX,
				MIN_PREVIEW_WIDTH,
				getMaxPreviewWidth(workspaceWidth)
			);
			return;
		}

		const workspaceHeight = getWorkspaceHeight();
		if (workspaceHeight <= 0) return;
		const deltaY = event.clientY - activeResize.startY;
		const baseHeight = activeResize.startPreviewHeight ?? getDefaultPreviewHeight(workspaceHeight);
		previewHeight = clamp(
			baseHeight - deltaY,
			MIN_PREVIEW_HEIGHT,
			getMaxPreviewHeight(workspaceHeight)
		);
	};

	const endResize = (event?: PointerEvent) => {
		if (!activeResize) return;
		if (event && event.pointerId !== activeResize.pointerId) return;
		const pointerId = activeResize.pointerId;

		activeResize = null;
		if (activeResizeHandle?.hasPointerCapture(pointerId)) {
			activeResizeHandle.releasePointerCapture(pointerId);
		}
		activeResizeHandle = null;
		document.body.classList.remove('playground-resizing');
	};

	const resizeByKeyboard = (event: KeyboardEvent) => {
		const desktop = isDesktopViewport();
		const validKey = desktop
			? event.key === 'ArrowLeft' || event.key === 'ArrowRight'
			: event.key === 'ArrowUp' || event.key === 'ArrowDown';
		if (!validKey) return;

		event.preventDefault();
		const step = event.shiftKey ? 48 : 16;
		const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;

		if (desktop) {
			const workspaceWidth = getWorkspaceWidth();
			if (workspaceWidth <= 0) return;
			const baseWidth = previewWidth ?? getDefaultPreviewWidth(workspaceWidth);
			previewWidth = clamp(
				baseWidth - direction * step,
				MIN_PREVIEW_WIDTH,
				getMaxPreviewWidth(workspaceWidth)
			);
			return;
		}

		const workspaceHeight = getWorkspaceHeight();
		if (workspaceHeight <= 0) return;
		const baseHeight = previewHeight ?? getDefaultPreviewHeight(workspaceHeight);
		previewHeight = clamp(
			baseHeight - direction * step,
			MIN_PREVIEW_HEIGHT,
			getMaxPreviewHeight(workspaceHeight)
		);
	};

	$effect(() => {
		const host = workspaceHost;
		if (!host || typeof ResizeObserver === 'undefined') return;

		clampPanelSize();

		const observer = new ResizeObserver(() => {
			clampPanelSize();
		});
		observer.observe(host);

		return () => observer.disconnect();
	});

	$effect(() => {
		if (typeof window === 'undefined') return;

		const onPointerMove = (event: PointerEvent) => updateResize(event);
		const onPointerUp = (event: PointerEvent) => endResize(event);
		const onResize = () => clampPanelSize();

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerUp);
		window.addEventListener('resize', onResize);

		return () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			window.removeEventListener('pointercancel', onPointerUp);
			window.removeEventListener('resize', onResize);
			document.body.classList.remove('playground-resizing');
		};
	});

	$effect(() => {
		controller.setEditorTheme(themeStore.isDark ? 'dark' : 'light');
	});
</script>

<main
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-background-muted p-2 dark:bg-background"
>
	<PlaygroundHeader
		activeDemoId={controller.activeDemoId}
		activeFramework={controller.activeFramework}
		demoOptions={demoSelectOptions}
		{onSelectDemo}
		{onSelectFramework}
	/>

	<div
		bind:this={workspaceHost}
		class={`playground-workspace relative mt-2 min-h-0 flex-1 ${
			activeResize ? 'playground-workspace--resizing' : ''
		}`}
		style={`--playground-columns: ${workspaceColumns}; --playground-rows: ${workspaceRows};`}
	>
		<div class="playground-editor-slot flex min-h-0 overflow-hidden">
			<PlaygroundEditor {controller} {onEditorHostChange} />
		</div>

		<button
			type="button"
			aria-label="Resize preview panel"
			tabindex={0}
			class={`panel-resizer ${activeResize ? 'panel-resizer--active' : ''}`}
			onpointerdown={(event) => beginResize(event)}
			onkeydown={(event) => resizeByKeyboard(event)}
		></button>

		<PlaygroundPreview {controller} {onPreviewFrameChange} />
	</div>
</main>

<style>
	.playground-workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: var(--playground-rows);
		column-gap: 0;
		row-gap: 0;
	}

	.playground-editor-slot > :global(*) {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
	}

	.playground-workspace--resizing {
		transition: none;
	}

	.panel-resizer {
		appearance: none;
		padding: 0;
		border: 0;
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
		background: transparent;
		z-index: 2;
	}

	.panel-resizer::before {
		position: absolute;
		content: '';
		opacity: 0;
	}

	@media (min-width: 1024px) {
		.playground-workspace {
			grid-template-columns: var(--playground-columns);
			grid-template-rows: minmax(0, 1fr);
		}

		.panel-resizer {
			cursor: col-resize;
		}

		.panel-resizer::after {
			position: absolute;
			top: 0;
			right: -6px;
			bottom: 0;
			left: -6px;
			content: '';
		}

		.panel-resizer::before {
			top: 0;
			left: 50%;
			height: 100%;
			border-left: 1px solid transparent;
			transform: translateX(-0.5px);
		}

		.playground-workspace--resizing .panel-resizer--active::before {
			border-left-color: var(--color-accent);
			opacity: 1;
		}

		:global(body.playground-resizing) {
			cursor: col-resize;
			user-select: none;
		}
	}

	@media (max-width: 1023px) {
		.panel-resizer {
			cursor: row-resize;
		}

		.panel-resizer::after {
			position: absolute;
			top: -6px;
			right: 0;
			bottom: -6px;
			left: 0;
			content: '';
		}

		.panel-resizer::before {
			top: 50%;
			left: 0;
			width: 100%;
			border-top: 1px solid transparent;
			transform: translateY(-0.5px);
		}

		.playground-workspace--resizing .panel-resizer--active::before {
			border-top-color: var(--color-accent);
			opacity: 1;
		}

		:global(body.playground-resizing) {
			cursor: row-resize;
			user-select: none;
		}
	}

	:global(.cm-editor),
	:global(.cm-editor .cm-content),
	:global(.cm-editor .cm-gutter),
	:global(.cm-editor .cm-scroller) {
		font-family:
			'Berkeley Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace !important;
		font-kerning: none;
		font-variant-ligatures: none;
		font-feature-settings:
			'liga' 0,
			'calt' 0;
		text-rendering: geometricPrecision;
	}

	:global(.cm-editor),
	:global(.cm-editor.cm-focused),
	:global(.cm-editor:focus),
	:global(.cm-editor:focus-visible),
	:global(.cm-editor .cm-content),
	:global(.cm-editor .cm-content:focus),
	:global(.cm-editor .cm-content:focus-visible) {
		outline: none !important;
		outline-offset: 0 !important;
		transition: none !important;
	}

	:global(.cm-editor),
	:global(.cm-editor .cm-gutters) {
		background-color: var(--playground-editor-bg) !important;
	}

	:global(.cm-editor .cm-gutters) {
		background-color: var(--playground-editor-gutter-bg) !important;
	}

	:global(.cm-editor) {
		height: 100%;
		min-height: 0;
		min-width: 100%;
	}

	:global(.cm-editor .cm-scroller) {
		overflow: auto;
	}

	:global(.cm-editor .cm-activeLine),
	:global(.cm-editor .cm-activeLineGutter) {
		background-color: var(--playground-editor-active-line-bg) !important;
		border-color: transparent !important;
	}

	:global(.cm-editor .cm-foldGutter) {
		width: 0 !important;
		min-width: 0 !important;
		padding: 0 !important;
		margin: 0 !important;
		overflow: hidden !important;
	}

	:global(.cm-editor .cm-foldGutter .cm-gutterElement) {
		display: none !important;
	}

	:global(.cm-editor .cm-scroller) {
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--color-foreground) 12%, transparent) transparent;
	}

	:global(.cm-editor .cm-scroller::-webkit-scrollbar) {
		width: 10px;
		height: 10px;
		--playground-cm-thumb-color: color-mix(in srgb, var(--color-foreground) 20%, transparent);
	}

	:global(.cm-editor .cm-scroller::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(.cm-editor .cm-scroller::-webkit-scrollbar:hover) {
		--playground-cm-thumb-color: color-mix(in srgb, var(--color-foreground) 52%, transparent);
	}

	:global(.cm-editor .cm-scroller::-webkit-scrollbar-thumb) {
		background-color: var(--playground-cm-thumb-color);
		border: 1px solid transparent;
		border-radius: 9999px;
		background-clip: content-box;
		transition: background-color 120ms ease-out;
	}

	:global(.cm-editor .cm-scroller::-webkit-scrollbar-thumb:hover) {
		background-color: color-mix(in srgb, var(--color-foreground) 62%, transparent);
	}

	:global(.cm-editor .cm-scroller::-webkit-scrollbar-thumb:active) {
		background-color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
	}

	:global(.cm-editor .cm-scroller::-webkit-scrollbar-corner) {
		background: transparent;
	}

	:global(html:not(.dark)) {
		--playground-editor-bg: transparent;
		--playground-editor-gutter-bg: var(--color-background);
		--playground-editor-fg: #1f2328;
		--playground-editor-gutter-fg: #6e7781;
		--playground-editor-gutter-border: #d0d7de;
		--playground-editor-active-line-bg: color-mix(in srgb, var(--color-accent) 10%, transparent);
		--playground-editor-selection-bg: rgb(9 105 218 / 20%);
		--playground-editor-cursor: #1f2328;
		--playground-token-keyword: #cf222e;
		--playground-token-function: #8250df;
		--playground-token-string: #0a3069;
		--playground-token-comment: #6e7781;
		--playground-token-number: #0550ae;
		--playground-token-type: #953800;
		--playground-token-tag: #116329;
		--playground-token-property: #0550ae;
		--playground-token-variable: #1f2328;
		--playground-token-constant: #0550ae;
		--playground-token-invalid: #cf222e;
	}

	:global(html.dark) {
		--playground-editor-bg: transparent;
		--playground-editor-gutter-bg: var(--color-background-inset);
		--playground-editor-fg: #e6edf3;
		--playground-editor-gutter-fg: #7d8590;
		--playground-editor-gutter-border: #30363d;
		--playground-editor-active-line-bg: color-mix(in srgb, var(--color-accent) 14%, transparent);
		--playground-editor-selection-bg: rgb(47 129 247 / 20%);
		--playground-editor-cursor: #e6edf3;
		--playground-token-keyword: #ff7b72;
		--playground-token-function: #d2a8ff;
		--playground-token-string: #a5d6ff;
		--playground-token-comment: #8b949e;
		--playground-token-number: #79c0ff;
		--playground-token-type: #ffa657;
		--playground-token-tag: #7ee787;
		--playground-token-property: #79c0ff;
		--playground-token-variable: #e6edf3;
		--playground-token-constant: #79c0ff;
		--playground-token-invalid: #ff7b72;
	}
</style>
