<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Glass Pane',
		description: 'Edit the Glass Pane example in Svelte, React, or Vue and preview it live.',
		order: 40,
		data: {
			demo: 'glass-pane'
		}
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
