<script lang="ts">
	import { labels } from '$lib/site/labels';
	import { Button } from '$lib/components/ui/button';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { FileIcon, CheckIcon, CircleWarningIcon, LoaderIcon, TerminalIcon } from '$lib/icons';
	import type { PlaygroundController } from '../playground-controller.svelte';

	let {
		controller,
		onEditorHostChange
	}: {
		controller: PlaygroundController;
		onEditorHostChange: (host: HTMLDivElement | null) => void;
	} = $props();

	let logOpen = $state(false);
	let fileToolbar = $state<HTMLDivElement | null>(null);
	const hasError = $derived(Boolean(controller.errorMessage || controller.syncError));

	$effect(() => {
		const index = controller.openFilePaths.indexOf(controller.activeFilePath);
		fileToolbar?.querySelectorAll<HTMLButtonElement>('[aria-pressed]')[index]?.scrollIntoView({
			block: 'nearest',
			inline: 'nearest'
		});
	});

	const registerEditorHost = (node: HTMLDivElement) => {
		onEditorHostChange(node);
		return {
			destroy() {
				onEditorHostChange(null);
			}
		};
	};

	function navigateFiles(event: KeyboardEvent, index: number) {
		const paths = controller.openFilePaths;
		let nextIndex: number;
		switch (event.key) {
			case 'ArrowRight':
				nextIndex = (index + 1) % paths.length;
				break;
			case 'ArrowLeft':
				nextIndex = (index - 1 + paths.length) % paths.length;
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = paths.length - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		const toolbar = (event.currentTarget as HTMLElement).closest('[role="toolbar"]');
		controller.switchToFile(paths[nextIndex]);
		toolbar?.querySelectorAll<HTMLButtonElement>('[aria-pressed]')[nextIndex]?.focus();
	}
</script>

<section
	class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
	aria-label={labels.playground.sourceEditor}
>
	<div class="flex h-9 min-w-0 shrink-0 items-center border-b border-border bg-sidebar/50">
		<div
			class="min-w-0 flex-1 scrollbar-none overflow-x-auto overflow-y-hidden overscroll-x-contain"
		>
			<div
				bind:this={fileToolbar}
				class="flex w-max min-w-full items-center gap-1 px-1 py-1"
				role="toolbar"
				aria-label={labels.playground.sourceFiles}
			>
				{#each controller.openFilePaths as filePath, index (filePath)}
					<Button
						variant={controller.activeFilePath === filePath ? 'secondary' : 'ghost'}
						size="sm"
						onclick={() => controller.switchToFile(filePath)}
						onkeydown={(event) => navigateFiles(event, index)}
						tabindex={controller.activeFilePath === filePath ? 0 : -1}
						aria-pressed={controller.activeFilePath === filePath}
						class="gap-1.5 font-mono text-xs font-normal text-muted-foreground aria-pressed:text-foreground"
					>
						<FileIcon size={14} strokeWidth={1.5} aria-hidden="true" />
						{filePath.split('/').at(-1)}
					</Button>
				{/each}
			</div>
		</div>
	</div>

	<div
		id="playground-editor"
		tabindex="-1"
		use:registerEditorHost
		class="playground-editor-host min-h-0 min-w-0 flex-1"
		aria-label={labels.playground.codeEditor}
	></div>

	{#if controller.syncError}
		<p
			class="max-h-32 shrink-0 overflow-auto border-t border-border px-4 py-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-destructive"
			role="alert"
		>
			{controller.syncError}
		</p>
	{/if}

	{#if controller.runtimeLog && logOpen}
		<div
			id="playground-runtime-log"
			class="shrink-0 border-t border-border bg-sidebar/50"
			role="region"
			aria-label={labels.playground.runtimeErrors}
		>
			<ScrollArea class="h-32">
				<pre
					class="px-4 py-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">{controller.runtimeLogTail}</pre>
			</ScrollArea>
		</div>
	{/if}

	<footer
		class="flex min-h-8 shrink-0 items-center justify-between gap-3 border-t border-border bg-sidebar/50 px-3 text-xs text-muted-foreground"
	>
		<div class="flex min-w-0 items-center gap-2" role="status" aria-atomic="true">
			{#if hasError}
				<CircleWarningIcon
					size={14}
					strokeWidth={1.5}
					class="shrink-0 text-destructive"
					aria-hidden="true"
				/>
			{:else if controller.isSyncing || controller.status !== labels.playground.status.ready}
				<LoaderIcon
					size={14}
					strokeWidth={1.5}
					class="shrink-0 motion-safe:animate-spin"
					aria-hidden="true"
				/>
			{:else}
				<CheckIcon size={14} strokeWidth={1.5} class="shrink-0" aria-hidden="true" />
			{/if}
			<span class="truncate">{hasError ? labels.playground.needsAttention : controller.status}</span
			>
		</div>
		{#if controller.runtimeLog}
			<Button
				variant="ghost"
				size="sm"
				class="h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
				aria-expanded={logOpen}
				aria-controls="playground-runtime-log"
				onclick={() => (logOpen = !logOpen)}
			>
				<TerminalIcon size={14} strokeWidth={1.5} aria-hidden="true" />
				{labels.playground.runtimeErrors}
			</Button>
		{/if}
	</footer>
</section>
