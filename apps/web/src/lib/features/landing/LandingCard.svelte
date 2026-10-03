<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import type { IconComponent } from '$lib/icons';
	let {
		title,
		description,
		icon: Icon,
		number
	}: {
		title: string;
		description: string;
		icon: IconComponent;
		number?: string;
	} = $props();
</script>

<Card.Root class="h-full min-h-54 justify-between gap-8 [--card-spacing:--spacing(6)]">
	<Card.Header>
		<div class="flex items-center justify-between gap-4">
			<span
				class="flex size-10 items-center justify-center rounded-lg bg-muted text-primary shadow-2xs"
			>
				<Icon size={18} aria-hidden="true" />
			</span>
			{#if number}<span
					class="font-mono text-sm text-muted-foreground tabular-nums"
					aria-hidden="true">{number}</span
				>{/if}
		</div>
	</Card.Header>
	<Card.Content class="space-y-3">
		<Card.Title><h3 class="text-xl font-medium tracking-tight">{title}</h3></Card.Title>
		<p class="text-base leading-relaxed text-pretty text-muted-foreground">
			{description}
		</p>
	</Card.Content>
</Card.Root>
