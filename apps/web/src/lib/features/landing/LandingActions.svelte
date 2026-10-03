<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { BookOpenIcon, CubeIcon } from '$lib/icons';

	let {
		playgroundLabel = 'Playground',
		docsLabel = 'Documentation',
		docsSlug = ''
	}: {
		playgroundLabel?: string;
		docsLabel?: string;
		docsSlug?: string;
	} = $props();
</script>

<div class="flex flex-wrap items-center justify-center gap-3">
	<Button href={resolve('/[section]/[...slug]', { section: 'playground', slug: '' })}>
		<CubeIcon aria-hidden="true" />
		{playgroundLabel}
	</Button>
	<Button
		href={resolve('/[section]/[...slug]', { section: 'docs', slug: docsSlug })}
		variant="outline"
	>
		<BookOpenIcon aria-hidden="true" />
		{docsLabel}
	</Button>
</div>
