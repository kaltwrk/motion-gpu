import type { Framework } from '$lib/stores/framework.svelte';
type HighlightedCode = { light: string; dark: string };
export type HighlightedFrameworkContent = Record<
	Framework,
	{ install: HighlightedCode; usage: HighlightedCode }
>;
