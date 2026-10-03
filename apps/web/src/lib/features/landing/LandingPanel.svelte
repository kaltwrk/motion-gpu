<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	let { children, class: className }: { children: Snippet; class?: string } = $props();
</script>

<div class={cn('w-full rounded-2xl bg-muted p-1 shadow-sm', className)}>
	{@render children()}
</div>
