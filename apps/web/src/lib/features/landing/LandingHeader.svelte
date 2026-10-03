<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ThemeToggle } from '$lib/components/theme-toggle';
	import { Button } from '$lib/components/ui/button';
	import { GitHubIcon, Menu2Icon, XmarkIcon } from '$lib/icons';
	import LandingBrand from './LandingBrand.svelte';
	import { githubUrl, navigation } from './content';

	let mobileOpen = $state(false);
	let menuButton = $state<HTMLButtonElement | null>(null);
	let ready = $state(false);

	function closeMobileMenu() {
		mobileOpen = false;
		menuButton?.focus();
	}

	afterNavigate(() => {
		if (mobileOpen) closeMobileMenu();
	});

	onMount(() => {
		ready = true;
	});
</script>

<svelte:window
	onkeydown={(event: KeyboardEvent) => {
		if (event.key === 'Escape' && mobileOpen) {
			closeMobileMenu();
		}
	}}
/>

<header
	class="fixed top-2 left-1/2 z-40 h-15 w-full max-w-4xl shrink-0 -translate-x-1/2 px-2 sm:top-4 sm:px-0"
>
	<div
		class="mx-auto max-w-3xl rounded-xl bg-card/80 px-2.5 shadow-lg backdrop-blur-xl backdrop-saturate-150 lg:max-w-5xl"
	>
		<div class="relative flex h-12 items-center justify-between gap-3">
			<a
				href={resolve('/')}
				aria-label="Spektral home"
				class="inline-flex min-h-8 shrink-0 items-center rounded-md px-1.5 transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<LandingBrand />
			</a>
			<nav aria-label="Primary navigation" class="hidden items-center gap-5 lg:flex">
				{#each navigation as item (item.href)}
					<a
						href={resolve(`/${item.href}`)}
						class="inline-flex min-h-9 items-center rounded-md text-sm text-muted-foreground transition-all ease-in-out outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
						>{item.label}</a
					>
				{/each}
			</nav>
			<div class="flex items-center gap-2">
				<ThemeToggle />
				<Button
					href={githubUrl}
					target="_blank"
					rel="noreferrer"
					variant="default"
					size="sm"
					class="hidden gap-1.5 px-3 sm:inline-flex"
				>
					<GitHubIcon aria-hidden="true" /> GitHub
				</Button>
				<Button
					bind:ref={menuButton}
					variant="ghost"
					size="icon"
					class="lg:hidden"
					aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
					aria-expanded={mobileOpen}
					aria-controls="landing-mobile-nav"
					disabled={!ready}
					onclick={() => (mobileOpen = !mobileOpen)}
				>
					{#if mobileOpen}
						<XmarkIcon aria-hidden="true" />
					{:else}
						<Menu2Icon aria-hidden="true" />
					{/if}
				</Button>
			</div>
		</div>
		<nav
			id="landing-mobile-nav"
			aria-label="Mobile navigation"
			hidden={!mobileOpen}
			class="pb-2.5 lg:hidden"
		>
			{#each navigation as item (item.href)}
				<a
					href={resolve(`/${item.href}`)}
					onclick={closeMobileMenu}
					class="flex min-h-11 items-center rounded-md px-2 text-sm transition-colors ease-in-out outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
					>{item.label}</a
				>
			{/each}
			<Button
				href={githubUrl}
				target="_blank"
				rel="noreferrer"
				variant="default"
				class="mt-2 w-full gap-1.5 sm:hidden"
				onclick={closeMobileMenu}
			>
				<GitHubIcon aria-hidden="true" /> GitHub
			</Button>
		</nav>
	</div>
</header>
