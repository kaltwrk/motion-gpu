<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { SVGAttributes } from 'svelte/elements';

	type Props = Omit<SVGAttributes<SVGSVGElement>, 'children'> & {
		size?: number | string;
		title?: string;
		children: Snippet;
	};

	let { size = 18, width = size, height = size, title, children, ...restProps }: Props = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	{width}
	{height}
	viewBox="0 0 18 18"
	fill="none"
	focusable="false"
	aria-hidden={title ? undefined : 'true'}
	{...restProps}
>
	{#if title}<title>{title}</title>{/if}
	{@render children()}
</svg>
