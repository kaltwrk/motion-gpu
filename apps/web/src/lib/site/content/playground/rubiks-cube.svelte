<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Rubiks Cube',
		description: 'Edit the Rubiks Cube example in Svelte, React, or Vue and preview it live.',
		order: 70,
		data: {
			demo: 'rubiks-cube'
		}
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
