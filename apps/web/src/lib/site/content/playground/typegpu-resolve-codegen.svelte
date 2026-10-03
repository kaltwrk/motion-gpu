<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'TypeGPU Resolve Codegen',
		description:
			'Edit the TypeGPU Resolve Codegen example in Svelte, React, or Vue and preview it live.',
		order: 100,
		data: {
			demo: 'typegpu-resolve-codegen'
		}
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
