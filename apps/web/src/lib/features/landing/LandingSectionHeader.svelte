<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import type { IconComponent } from '$lib/icons';
	let {
		id,
		label,
		title,
		description,
		icon: Icon
	}: {
		id: string;
		label: string;
		title: string;
		description: string;
		icon: IconComponent;
	} = $props();
</script>

<div class="mb-12 flex flex-col items-center gap-4 text-center">
	<Badge
		variant="outline"
		class="h-7 gap-1.5 border-transparent bg-card px-2.5 font-normal shadow-2xs"
	>
		<Icon class="text-primary" aria-hidden="true" />
		{label}
	</Badge>
	<h2 {id} class="text-3xl leading-tight font-medium tracking-tight text-balance sm:text-4xl">
		{title}
	</h2>
	<p class="max-w-lg text-base leading-relaxed text-pretty text-muted-foreground">{description}</p>
</div>
