<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Data Mosh',
		description: 'Edit the Data Mosh example in Svelte, React, or Vue and preview it live.',
		order: 20,
		data: {
			demo: 'data-mosh'
		}
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
