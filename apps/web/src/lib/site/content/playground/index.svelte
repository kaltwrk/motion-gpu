<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Spektral Logo',
		description: 'Edit the Spektral Logo example in Svelte, React, or Vue and preview it live.',
		order: 0,
		data: {
			demo: 'spektral-logo'
		},
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

<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />
