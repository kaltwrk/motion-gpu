<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Playground',
		description: 'Write and preview Spektral scenes in Svelte, React, or Vue.',
		order: 0,
		view: {
			label: 'Playground',
			icon: 'TerminalIcon',
			layout: 'workspace',
			order: 10,
			ui: {
				search: {
					enabled: false
				},
				pageActions: {
					enabled: false
				},
				pagination: {
					enabled: false
				}
			}
		}
	} satisfies ContentFrontmatter;
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId="" title={metadata.title} />
