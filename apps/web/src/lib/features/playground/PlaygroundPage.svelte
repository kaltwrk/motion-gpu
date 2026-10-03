<script lang="ts">
	import { labels } from '$lib/site/labels';
	import { onMount, tick } from 'svelte';
	import { SvelteURL } from 'svelte/reactivity';
	import { LoaderIcon } from '$lib/icons';
	import { afterNavigate, goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getPlaygroundPage, playgroundPages } from '$lib/site/playground';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { frameworkStore, type Framework } from '$lib/stores/framework.svelte';

	let { demoId }: { demoId: string } = $props();
	const demo = $derived(getPlaygroundPage(demoId));

	const syncLocationFromController = () => {
		if (typeof window === 'undefined' || !controller) return;
		const nextUrl = new URL(window.location.href);
		nextUrl.searchParams.delete('demo');
		nextUrl.searchParams.set('framework', controller.activeFramework);
		replaceState(nextUrl, page.state);
	};

	let PlaygroundView = $state<
		(typeof import('$lib/features/playground/PlaygroundView.svelte'))['default'] | null
	>(null);
	let failedToLoad = $state(false);
	let controller = $state<ReturnType<
		(typeof import('$lib/features/playground/playground-controller.svelte'))['createPlaygroundController']
	> | null>(null);

	const selectFramework = (framework: string) => {
		if (!controller) return;
		controller.switchFramework(framework);
		frameworkStore.active = controller.activeFramework as Framework;
		syncLocationFromController();
	};
	const handleEditorHostChange = (host: HTMLDivElement | null) => {
		if (!controller) return;
		controller.setEditorHost(host);
	};

	const handlePreviewFrameChange = (frame: HTMLIFrameElement | null) => {
		if (!controller) return;
		controller.setPreviewFrame(frame);
	};

	afterNavigate(() => {
		if (!controller) return;
		controller.switchFramework(page.url.searchParams.get('framework') ?? frameworkStore.active);
		frameworkStore.active = controller.activeFramework as Framework;
		syncLocationFromController();
	});

	onMount(() => {
		let mounted = true;
		let disposeController: (() => void) | undefined;

		void (async () => {
			// Existing shared URLs enter through the index, then use the demo's canonical route.
			const linkedDemo = !demo.slug
				? playgroundPages.find((entry) => entry.id === page.url.searchParams.get('demo'))
				: undefined;
			if (linkedDemo?.slug) {
				const destination = new SvelteURL(page.url);
				destination.pathname = resolve('/[section]/[...slug]', {
					section: page.params.section ?? 'playground',
					slug: linkedDemo.slug
				});
				destination.searchParams.delete('demo');
				await goto(destination, { replaceState: true });
				return;
			}
			const [{ default: LoadedPlaygroundView }, { createPlaygroundController }] = await Promise.all(
				[
					import('$lib/features/playground/PlaygroundView.svelte'),
					import('$lib/features/playground/playground-controller.svelte')
				]
			);
			if (!mounted) return;

			PlaygroundView = LoadedPlaygroundView;
			controller = createPlaygroundController(
				demoId,
				page.url.searchParams.get('framework') ?? frameworkStore.active
			);
			await tick();
			if (!mounted || !controller) return;
			disposeController = controller.mount();
			frameworkStore.active = controller.activeFramework as Framework;
			syncLocationFromController();
		})().catch((error: unknown) => {
			if (!mounted) return;
			failedToLoad = true;
			console.error('Failed to load the playground.', error);
		});

		return () => {
			mounted = false;
			disposeController?.();
		};
	});
</script>

<h1 class="sr-only">{demo.title}</h1>

{#if !failedToLoad && PlaygroundView && controller}
	<PlaygroundView
		{controller}
		onSelectFramework={selectFramework}
		onEditorHostChange={handleEditorHostChange}
		onPreviewFrameChange={handlePreviewFrameChange}
	/>
{:else}
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
			{#if failedToLoad}
				<div role="alert" class="space-y-2">
					<h2 class="text-lg font-medium">{labels.playground.loadFailed}</h2>
					<p class="text-sm text-muted-foreground">{labels.playground.reloadHint}</p>
				</div>
				<Button onclick={() => window.location.reload()}>{labels.playground.reload}</Button>
			{:else}
				<LoaderIcon
					size={20}
					strokeWidth={1.5}
					class="text-muted-foreground motion-safe:animate-spin"
					aria-hidden="true"
				/>
				<p role="status" class="text-sm text-muted-foreground">{labels.playground.loading}</p>
			{/if}
		</div>
	</div>
{/if}
