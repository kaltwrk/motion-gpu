<script lang="ts">
	import { onMount } from 'svelte';
	import { CodeBlock, CopyCodeButton } from '$lib/components/code-block';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import ActiveFrameworkIcon from './framework/ActiveFrameworkIcon.svelte';
	import FrameworkTabs from './framework/FrameworkTabs.svelte';
	import { frameworks, frameworkStore, type Framework } from '$lib/stores/framework.svelte';
	import { cn } from '$lib/utils';
	import type { HighlightedFrameworkContent } from './types';

	type Props = {
		items: Record<Framework, { usage: string; label: string }>;
		highlighted: Record<Framework, Pick<HighlightedFrameworkContent[Framework], 'usage'>>;
		class?: string;
		selectable?: boolean;
	};

	const exampleFileNames: Record<Framework, string> = {
		svelte: 'Hero.svelte',
		react: 'Hero.tsx',
		vue: 'Hero.vue'
	};

	let { items, highlighted, class: className, selectable = false }: Props = $props();
	const activeCode = $derived(items[frameworkStore.active].usage);

	onMount(() => {
		document.documentElement.dataset.docsFrameworkReady = 'true';
	});
</script>

{#snippet header()}
	<div class="relative flex h-11 items-center px-4">
		<ActiveFrameworkIcon />

		{#if selectable}
			<FrameworkTabs {items} />
		{:else}
			<span class="min-w-0 truncate pe-10 text-sm font-medium text-foreground">
				{#each frameworks as framework (framework)}
					<span
						class="docs-framework-content"
						data-framework={framework}
						data-default={framework === 'svelte' ? 'true' : undefined}
						>{exampleFileNames[framework]}</span
					>
				{/each}
			</span>
		{/if}

		<CopyCodeButton
			value={activeCode}
			label="Copy usage example to clipboard"
			size="icon-sm"
			class="absolute right-2"
		/>
	</div>
{/snippet}

{#snippet code(framework: Framework)}
	<CodeBlock
		code={items[framework].usage}
		htmlLight={highlighted[framework].usage.light}
		htmlDark={highlighted[framework].usage.dark}
		label={`${items[framework].label} usage example`}
		framed={false}
		copyable={false}
		class="bg-transparent"
	/>
{/snippet}

<Card.Root
	size="sm"
	class={cn(
		'gap-0 bg-muted px-1 pt-0 pb-1 transition-shadow has-[[data-scrollable]:focus-visible]:ring-[3px] has-[[data-scrollable]:focus-visible]:ring-ring/50 has-[[data-scrollable]:focus-visible]:outline-1',
		className
	)}
>
	{#if selectable}
		<Tabs.Root
			value={frameworkStore.active}
			onValueChange={(value) => {
				frameworkStore.active = value as Framework;
			}}
			loop
			class="gap-0"
		>
			{@render header()}
			{#each frameworks as framework (framework)}
				<Tabs.Content
					value={framework}
					tabindex={-1}
					class="docs-framework-content rounded-lg bg-card shadow-sm"
					data-framework={framework}
					data-default={framework === 'svelte' ? 'true' : undefined}
				>
					{@render code(framework)}
				</Tabs.Content>
			{/each}
		</Tabs.Root>
	{:else}
		{@render header()}
		<div class="rounded-lg bg-card shadow-sm">
			{#each frameworks as framework (framework)}
				<div
					class="docs-framework-content"
					data-framework={framework}
					data-default={framework === 'svelte' ? 'true' : undefined}
				>
					{@render code(framework)}
				</div>
			{/each}
		</div>
	{/if}
</Card.Root>
