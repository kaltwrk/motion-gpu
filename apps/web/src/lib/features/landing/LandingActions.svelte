<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { BookOpenIcon, CubeIcon } from '$lib/icons';
</script>

<div class="flex flex-wrap items-center justify-center gap-3">
	<Button href={resolve('/[section]/[...slug]', { section: 'playground', slug: '' })}>
		<CubeIcon aria-hidden="true" />
		Playground
	</Button>
	<Button href={resolve('/[section]/[...slug]', { section: 'docs', slug: '' })} variant="outline">
		<BookOpenIcon aria-hidden="true" />
		Documentation
	</Button>
</div>
