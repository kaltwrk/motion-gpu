<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Kinetic Array',
		description:
			'Simulate coupled springs with compute passes and render their storage-buffer state directly.',
		order: 50,
		data: { demo: 'kinetic-array' }
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
