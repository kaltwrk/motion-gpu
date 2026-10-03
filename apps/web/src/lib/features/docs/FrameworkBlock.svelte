<script lang="ts">
	import { labels } from '$lib/site/labels';
	import FrameworkCodeBlock from '$lib/features/docs/FrameworkCodeBlock.svelte';
	import { getHighlighter } from '$lib/utils/highlighter';
	import { frameworks, type Framework } from '$lib/stores/framework.svelte';

	type Props = {
		svelteCode: string;
		reactCode: string;
		vueCode: string;
		svelteLang?: string;
		reactLang?: string;
		vueLang?: string;
	};
	let {
		svelteCode,
		reactCode,
		vueCode,
		svelteLang = 'svelte',
		reactLang = 'tsx',
		vueLang = 'vue'
	}: Props = $props();
	const items = $derived({
		svelte: { usage: svelteCode, label: labels.framework.names.svelte },
		react: { usage: reactCode, label: labels.framework.names.react },
		vue: { usage: vueCode, label: labels.framework.names.vue }
	});
	const highlighted = $derived.by(() => {
		const languages = { svelte: svelteLang, react: reactLang, vue: vueLang };
		const highlighter = getHighlighter();
		return Object.fromEntries(
			frameworks.map((framework) => [
				framework,
				{
					usage: {
						light: highlighter.codeToHtml(items[framework].usage, {
							lang: languages[framework],
							theme: 'github-light',
							tabindex: false
						}),
						dark: highlighter.codeToHtml(items[framework].usage, {
							lang: languages[framework],
							theme: 'github-dark',
							tabindex: false
						})
					}
				}
			])
		) as Record<Framework, { usage: { light: string; dark: string } }>;
	});
</script>

<FrameworkCodeBlock {items} {highlighted} selectable class="my-6" />
