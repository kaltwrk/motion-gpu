<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Amber',
		description:
			'Load texture maps with useTexture and explore subsurface parallax, mip filtering and pointer interaction.',
		order: 20,
		data: { demo: 'amber' }
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
