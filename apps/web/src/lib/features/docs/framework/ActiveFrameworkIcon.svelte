<!--
Source: preserved framework logos in $lib/icons; see each component's source comment.
Original names: ReactIcon (Hugeicons), FrameworkSvelteIcon, FrameworkVueIcon (Spektral).
-->
<script lang="ts">
	import { FrameworkReactIcon, FrameworkSvelteIcon, FrameworkVueIcon } from '$lib/icons';
	import { frameworks, frameworkStore } from '$lib/stores/framework.svelte';
</script>

<span
	class="relative me-2 flex size-4 shrink-0 items-center justify-center text-muted-foreground"
	aria-hidden="true"
>
	{#each frameworks as framework (framework)}
		<span
			class="installation-framework-icon absolute inset-0 flex items-center justify-center"
			data-framework={framework}
			data-visible={frameworkStore.active === framework}
		>
			{#if framework === 'svelte'}
				<FrameworkSvelteIcon size={16} />
			{:else if framework === 'react'}
				<FrameworkReactIcon size={16} />
			{:else}
				<FrameworkVueIcon size={16} />
			{/if}
		</span>
	{/each}
</span>

<style>
	.installation-framework-icon {
		transition-property: opacity, scale, filter;
		transition-duration: 180ms;
		transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
	}

	.installation-framework-icon[data-visible='true'] {
		scale: 1;
		opacity: 1;
		filter: blur(0);
	}

	.installation-framework-icon[data-visible='false'] {
		scale: 0.25;
		opacity: 0;
		filter: blur(4px);
	}

	@media (prefers-reduced-motion: reduce) {
		.installation-framework-icon {
			scale: 1;
			filter: none;
			transition-property: opacity;
		}
	}
</style>
