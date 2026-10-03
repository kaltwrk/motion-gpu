<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Particle Icosahedron',
		description:
			'Edit the Particle Icosahedron example in Svelte, React, or Vue and preview it live.',
		order: 50,
		data: {
			demo: 'particle-icosahedron'
		}
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
