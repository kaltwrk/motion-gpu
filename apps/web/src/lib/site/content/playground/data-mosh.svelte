<script module lang="ts">
	import { getPlaygroundPage } from '$lib/site/playground';

	export const metadata = getPlaygroundPage('data-mosh');
</script>

<script lang="ts">
	import PlaygroundPage from '$lib/features/playground/PlaygroundPage.svelte';
</script>

<PlaygroundPage demoId={metadata.id} />
