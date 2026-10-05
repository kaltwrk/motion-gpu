<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Signal',
		description:
			'Render a real video texture with decoded-frame invalidation and a managed media lifecycle.',
		order: 30,
		data: { demo: 'signal' }
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
