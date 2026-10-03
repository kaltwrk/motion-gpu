<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Blood Moon',
		description: 'Edit the Blood Moon example in Svelte, React, or Vue and preview it live.',
		order: 10,
		data: {
			demo: 'blood-moon'
		}
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
