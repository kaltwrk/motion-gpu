<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Ping Pong Fluid',
		description: 'Edit the Ping Pong Fluid example in Svelte, React, or Vue and preview it live.',
		order: 60,
		data: {
			demo: 'ping-pong-fluid'
		}
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
