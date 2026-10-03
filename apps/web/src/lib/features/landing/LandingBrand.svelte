<script lang="ts">
	import logo from '$lib/site/assets/logo.svg?raw';
	import { cn } from '$lib/utils';
	let { class: className, markOnly = false }: { class?: string; markOnly?: boolean } = $props();
</script>

<span class={cn('inline-flex items-center gap-2 text-lg font-medium tracking-tight', className)}>
	<span
		class={cn(
			'inline-flex text-primary [&>svg]:fill-current',
			markOnly ? '[&>svg]:size-14' : '[&>svg]:size-6'
		)}
		aria-hidden="true"
	>
		<!-- Trusted, checked-in Spektral branding. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html logo}
	</span>
	{#if !markOnly}<span>Spektral</span>{/if}
</span>
