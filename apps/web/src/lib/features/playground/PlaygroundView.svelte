<script lang="ts">
	import { labels } from '$lib/site/labels';
	import { Button } from '$lib/components/ui/button';
	import { themeStore } from '$lib/stores/theme.svelte';
	import PlaygroundEditor from './components/PlaygroundEditor.svelte';
	import PlaygroundPreview from './components/PlaygroundPreview.svelte';

	import type { PlaygroundController } from './playground-controller.svelte';

	let {
		controller,
		onSelectFramework,
		onEditorHostChange,
		onPreviewFrameChange
	}: {
		controller: PlaygroundController;
		onSelectFramework: (framework: string) => void;
		onEditorHostChange: (host: HTMLDivElement | null) => void;
		onPreviewFrameChange: (frame: HTMLIFrameElement | null) => void;
	} = $props();

	let workspaceHost = $state<HTMLDivElement | null>(null);
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

	const RESIZER_SIZE = 1;
	const MIN_EDITOR_WIDTH = 380;
	const MIN_PREVIEW_WIDTH = 260;
	const MIN_EDITOR_HEIGHT = 260;
	const MIN_PREVIEW_HEIGHT = 220;

	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
	const getWorkspaceWidth = () => workspaceHost?.clientWidth ?? 0;
	const getWorkspaceHeight = () => workspaceHost?.clientHeight ?? 0;
	const isDesktopViewport = () => getWorkspaceWidth() >= 768;

	const getMaxPreviewWidth = (workspaceWidth: number) =>
		Math.max(MIN_PREVIEW_WIDTH, workspaceWidth - RESIZER_SIZE - MIN_EDITOR_WIDTH);
	const getMinPreviewHeight = (workspaceHeight: number) =>
		Math.min(MIN_PREVIEW_HEIGHT, (workspaceHeight - RESIZER_SIZE) / 2);
	const getMaxPreviewHeight = (workspaceHeight: number) =>
		Math.max(
			getMinPreviewHeight(workspaceHeight),
			workspaceHeight - RESIZER_SIZE - MIN_EDITOR_HEIGHT
		);

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
		previewHeight = clamp(
			previewHeight,
			getMinPreviewHeight(workspaceHeight),
			getMaxPreviewHeight(workspaceHeight)
		);
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
			getMinPreviewHeight(workspaceHeight),
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
		if (event.key === 'Home') {
			event.preventDefault();
			previewWidth = null;
			previewHeight = null;
			return;
		}
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
			getMinPreviewHeight(workspaceHeight),
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

<Button
	href="#playground-editor"
	variant="secondary"
	class="fixed inset-s-2 top-2 z-50 -translate-y-20 focus:translate-y-0"
	>{labels.playground.skipEditor}</Button
>

<div
	data-playground-shell
	class="playground-shell flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
>
	<div
		bind:this={workspaceHost}
		class={`playground-workspace relative min-h-0 flex-1 ${
			activeResize ? 'playground-workspace--resizing' : ''
		}`}
		style={`--playground-columns: ${workspaceColumns}; --playground-rows: ${workspaceRows};`}
	>
		<div class="playground-editor-slot flex min-h-0 overflow-hidden">
			<PlaygroundEditor {controller} {onEditorHostChange} />
		</div>

		<button
			type="button"
			aria-label={labels.playground.resize}
			aria-describedby="playground-resize-help"
			class={`panel-resizer ${activeResize ? 'panel-resizer--active' : ''}`}
			ondblclick={() => {
				previewWidth = null;
				previewHeight = null;
			}}
			onpointerdown={(event) => beginResize(event)}
			onkeydown={(event) => resizeByKeyboard(event)}
		></button>

		<p id="playground-resize-help" class="sr-only">
			{labels.playground.resizeHint}
		</p>

		<PlaygroundPreview {controller} {onSelectFramework} {onPreviewFrameChange} />
	</div>
</div>

<style>
	.playground-shell {
		container-type: inline-size;
	}
	.playground-workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: var(--playground-rows);
	}

	.playground-editor-slot > :global(*) {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
	}

	.panel-resizer {
		position: relative;
		z-index: 10;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: var(--border);
		cursor: row-resize;
		touch-action: none;
		outline: none;
	}

	.panel-resizer::after {
		position: absolute;
		inset: -11px 0;
		content: '';
	}

	.panel-resizer::before {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 32px;
		height: 5px;
		border-radius: 999px;
		background: var(--muted-foreground);
		box-shadow: 0 0 0 3px var(--background);
		transform: translate(-50%, -50%);
		content: '';
	}

	.panel-resizer:hover,
	.panel-resizer--active,
	.panel-resizer:focus-visible {
		background: var(--ring);
	}

	.panel-resizer:focus-visible::before {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}

	.playground-workspace--resizing :global(iframe) {
		pointer-events: none;
	}

	:global(body.playground-resizing) {
		cursor: row-resize;
		user-select: none;
	}

	@container (min-width: 768px) {
		.playground-workspace {
			grid-template-columns: var(--playground-columns);
			grid-template-rows: minmax(0, 1fr);
		}
		.panel-resizer,
		:global(body.playground-resizing) {
			cursor: col-resize;
		}
		.panel-resizer::after {
			inset: 0 -11px;
		}
		.panel-resizer::before {
			width: 5px;
			height: 32px;
		}
	}

	.playground-shell {
		--playground-editor-bg: var(--background);
		--playground-editor-gutter-bg: var(--background);
		--playground-editor-fg: var(--foreground);
		--playground-editor-gutter-fg: var(--muted-foreground);
		--playground-editor-gutter-border: var(--border);
		--playground-editor-active-line-bg: color-mix(in oklab, var(--muted) 55%, transparent);
		--playground-editor-selection-bg: color-mix(in oklab, var(--primary) 20%, transparent);
		--playground-editor-cursor: var(--foreground);
		/* Match the GitHub syntax themes used by documentation code blocks. */
		--playground-token-keyword: #d73a49;
		--playground-token-function: #6f42c1;
		--playground-token-string: #032f62;
		--playground-token-comment: #6a737d;
		--playground-token-number: #005cc5;
		--playground-token-type: #e36209;
		--playground-token-tag: #22863a;
		--playground-token-property: #005cc5;
		--playground-token-variable: #24292e;
		--playground-token-constant: #005cc5;
		--playground-token-invalid: var(--destructive);
	}

	:global(.dark) .playground-shell {
		--playground-token-keyword: #f97583;
		--playground-token-function: #b392f0;
		--playground-token-string: #9ecbff;
		--playground-token-comment: #8b949e;
		--playground-token-number: #79b8ff;
		--playground-token-type: #ffab70;
		--playground-token-tag: #85e89d;
		--playground-token-property: #79b8ff;
		--playground-token-variable: #e1e4e8;
		--playground-token-constant: #79b8ff;
	}

	.playground-shell :global(.cm-editor) {
		height: 100%;
		min-height: 0;
		min-width: 100%;
	}

	.playground-shell :global(.cm-scroller) {
		font-family: var(--font-mono);
		font-kerning: none;
		font-variant-ligatures: none;
		font-feature-settings:
			'liga' 0,
			'calt' 0;
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in oklab, var(--foreground) 20%, transparent) transparent;
	}

	.playground-shell :global(.playground-editor-host:has(.cm-focused)),
	.playground-shell :global(.playground-editor-host:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}

	.playground-shell :global(.cm-content:focus) {
		outline: none;
	}
</style>
