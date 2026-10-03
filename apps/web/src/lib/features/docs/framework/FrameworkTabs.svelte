<script lang="ts">
	import { labels } from '$lib/site/labels';
	import * as Tabs from '$lib/components/ui/tabs';
	import { frameworks, type Framework } from '$lib/stores/framework.svelte';

	let { items }: { items: Record<Framework, { label: string }> } = $props();
</script>

<Tabs.List variant="line" aria-label={labels.framework.tabs}>
	{#each frameworks as framework (framework)}
		<Tabs.Trigger value={framework} data-framework={framework}>
			{items[framework].label}
		</Tabs.Trigger>
	{/each}
</Tabs.List>
