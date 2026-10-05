<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Ferrofluid',
		description:
			'A magnetic surface driven by PingPongComputePass, storage textures and pointer input.',
		order: 10,
		data: { demo: 'ferrofluid' }
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
