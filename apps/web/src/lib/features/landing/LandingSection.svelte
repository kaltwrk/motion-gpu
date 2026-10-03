<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		id,
		variant = 'default',
		class: className,
		children
	}: {
		id: string;
		variant?: 'default' | 'muted' | 'full';
		class?: string;
		children: Snippet;
	} = $props();
</script>

<section
	{id}
	aria-labelledby={`${id}-title`}
	data-section-variant={variant}
	class="w-full scroll-mt-16 not-first:border-t not-first:border-dashed"
>
	<div
		class={cn(
			'w-full',
			variant === 'muted' && 'sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,56rem)_minmax(0,1fr)]'
		)}
	>
		{#if variant === 'muted'}<div class="bg-dashed hidden sm:block" aria-hidden="true"></div>{/if}
		<div
			class={cn(
				'relative w-full min-w-0 px-4 py-8 sm:px-8 sm:py-16',
				variant !== 'full' && 'mx-auto max-w-4xl sm:border-x',
				variant === 'default' && 'border-dashed',
				className
			)}
		>
			{@render children()}
		</div>
		{#if variant === 'muted'}<div class="bg-dashed hidden sm:block" aria-hidden="true"></div>{/if}
	</div>
</section>
