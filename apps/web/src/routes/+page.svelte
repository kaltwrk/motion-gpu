<script lang="ts">
	import { siteConfig } from '$lib/site/site';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
</script>

<main class="flex min-h-svh items-center justify-center p-6">
	<Button href={resolve(siteConfig.home.href as `/${string}/${string}`)}
		>{siteConfig.home.label}</Button
	>
</main>
