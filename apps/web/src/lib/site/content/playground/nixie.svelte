<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Nixie',
		description:
			'Build HDR bloom through named render targets, shader passes and a custom composite pass.',
		order: 40,
		data: { demo: 'nixie' }
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
