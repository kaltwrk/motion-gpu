<script lang="ts">
	import ScrollArea from '$lib/components/ui/ScrollArea.svelte';

	import type { PlaygroundController } from '../playground-controller.svelte';

	let {
		controller,
		onEditorHostChange
	}: {
		controller: PlaygroundController;
		onEditorHostChange: (host: HTMLDivElement | null) => void;
	} = $props();

	const registerEditorHost = (node: HTMLDivElement) => {
		onEditorHostChange(node);
		return {
			destroy() {
				onEditorHostChange(null);
			}
		};
	};
</script>

<section
	class="inset-shadow flex min-h-0 flex-col overflow-hidden rounded-md bg-background-muted p-px dark:bg-background"
>
	<div class="min-h-8 min-w-0 shrink-0 border-b border-(--guide-ink)">
		<div class="overflow-x-auto overflow-y-hidden">
			<div
				class="flex w-max min-w-full items-stretch [&>div:first-child]:rounded-tl-md [&>div:first-child]:border-r [&>div:first-child>button]:rounded-tl-md [&>div:last-child]:rounded-tr-md [&>div:last-child>button]:rounded-tr-md [&>div:not(:first-child)]:border-x"
			>
				{#each controller.openFilePaths as filePath (filePath)}
					<div
						class={`inline-flex shrink-0 items-center ${
							controller.activeFilePath === filePath
								? 'border-(--guide-ink) bg-background dark:bg-background-inset'
								: 'border-transparent bg-transparent'
						}`}
					>
						<button
							type="button"
							onclick={() => controller.switchToFile(filePath)}
							aria-pressed={controller.activeFilePath === filePath}
							class={`focus-ring relative px-2.5 py-2 text-left font-mono text-[11px] font-normal transition-[color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset motion-reduce:transition-none sm:px-3 sm:text-xs ${
								controller.activeFilePath === filePath
									? 'text-foreground'
									: 'text-foreground-muted hover:text-foreground'
							}`}
						>
							{filePath.split('/').at(-1)}
						</button>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div
		use:registerEditorHost
		class="min-h-0 min-w-0 flex-1 overflow-hidden bg-background dark:bg-background-inset"
		aria-label="Code editor"
	></div>

	{#if controller.syncError}
		<p
			class="rounded-b-md border-t border-(--guide-ink) bg-background p-px px-3 py-2 font-mono text-xs font-normal text-red-500 dark:bg-background-inset"
			role="alert"
		>
			{controller.syncError}
		</p>
	{/if}

	<section
		class="rounded-b-md border-t border-(--guide-ink) bg-background p-px dark:bg-background-inset"
	>
		{#if controller.runtimeLog}
			<details>
				<summary
					class="cursor-pointer px-3 py-2 font-mono text-xs font-medium text-foreground-muted"
				>
					Runtime log ({controller.status})
				</summary>
				<ScrollArea class="h-32" viewportClass="px-3 py-2">
					<pre
						class="font-mono text-[11px] leading-5 font-normal whitespace-pre-wrap text-foreground-muted">{controller.runtimeLogTail}</pre>
				</ScrollArea>
			</details>
		{:else}
			<p class=" px-3 py-2 font-mono text-xs font-normal text-foreground-muted">
				{controller.status}
			</p>
		{/if}
	</section>
</section>
