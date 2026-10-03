<script lang="ts">
	import '$lib/features/landing/landing.css';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import LandingHeader from '$lib/features/landing/LandingHeader.svelte';
	import LandingFooter from '$lib/features/landing/LandingFooter.svelte';
	import { ArrowLeftIcon, ArrowRotateClockwiseIcon, BookOpenIcon } from '$lib/icons';
	import { siteConfig } from '$lib/site/site';

	const status = $derived(page.status);
	const canRetry = $derived(status >= 500 || status === 408 || status === 429);
	const message = $derived.by(() => {
		switch (status) {
			case 404:
				return {
					title: 'Page not found.',
					description:
						'This address doesn’t lead to a page. Head back home or find what you need in the docs.'
				};
			case 403:
				return {
					title: 'This page is restricted.',
					description:
						'You don’t have access to this page. You can still explore the public docs or return home.'
				};
			case 408:
				return {
					title: 'The request timed out.',
					description: 'This page took too long to respond. Reload it to try again.'
				};
			case 410:
				return {
					title: 'This page is no longer available.',
					description: 'Head back home or browse the docs to find the current information.'
				};
			case 429:
				return {
					title: 'Too many requests.',
					description: 'Please wait a moment before reloading this page.'
				};
			default:
				return status >= 500
					? {
							title: 'Unable to load this page.',
							description:
								'Something went wrong while loading this page. Try reloading it, or return to the homepage.'
						}
					: {
							title: 'This page is unavailable.',
							description: 'Check the address, or continue from the homepage or docs.'
						};
		}
	});
</script>

<svelte:head>
	<title>{status} · {message.title} — {siteConfig.name}</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="description" content={message.description} />
</svelte:head>

<Button
	href="#main-content"
	variant="secondary"
	class="fixed inset-s-3 top-3 z-50 -translate-y-20 focus:translate-y-0"
>
	Skip to main content
</Button>

<div class="landing-page">
	<LandingHeader />
	<div class="mx-auto flex min-h-svh max-w-5xl flex-col border-border pt-24 sm:border-x">
		<main id="main-content" tabindex="-1" class="flex flex-1 items-center py-6 sm:py-8">
			<div class="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
				<div class="flex flex-col items-center text-center">
					<div class="mb-8 w-full max-w-md" aria-hidden="true">
						<span
							class="text-[clamp(7rem,22vw,8rem)] leading-none font-medium tracking-tighter text-primary tabular-nums"
						>
							{status}
						</span>
					</div>
					<h1
						id="error-title"
						class="max-w-xl text-3xl leading-[1.1] font-medium tracking-tight text-balance sm:text-4xl"
					>
						<span class="sr-only">Error {status}: </span>{message.title}
					</h1>
					<p class="mt-4 max-w-md text-base leading-relaxed text-pretty text-muted-foreground">
						{message.description}
					</p>
					<div class="mt-8 flex flex-wrap items-center justify-center gap-3" data-sveltekit-reload>
						{#if canRetry}
							<Button href={page.url.href}>
								<ArrowRotateClockwiseIcon aria-hidden="true" />
								Reload page
							</Button>
							<Button href={resolve('/')} variant="outline">
								<ArrowLeftIcon aria-hidden="true" />
								Back to home
							</Button>
						{:else}
							<Button href={resolve('/')}>
								<ArrowLeftIcon aria-hidden="true" />
								Back to home
							</Button>
							<Button
								href={resolve('/[section]/[...slug]', { section: 'docs', slug: '' })}
								variant="outline"
							>
								<BookOpenIcon aria-hidden="true" />
								Browse docs
							</Button>
						{/if}
					</div>
				</div>
			</div>
		</main>
		<LandingFooter />
	</div>
</div>
