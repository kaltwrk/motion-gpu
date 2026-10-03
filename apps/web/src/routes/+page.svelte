<script lang="ts">
	import '$lib/features/landing/landing.css';
	import { Button } from '$lib/components/ui/button';
	import LandingHeader from '$lib/features/landing/LandingHeader.svelte';
	import LandingHero from '$lib/features/landing/LandingHero.svelte';
	import LandingFeatures from '$lib/features/landing/LandingFeatures.svelte';
	import LandingPipeline from '$lib/features/landing/LandingPipeline.svelte';
	import LandingFAQ from '$lib/features/landing/LandingFAQ.svelte';
	import LandingCTA from '$lib/features/landing/LandingCTA.svelte';
	import LandingFooter from '$lib/features/landing/LandingFooter.svelte';
</script>

<Button
	href="#main-content"
	variant="secondary"
	class="fixed inset-s-3 top-3 z-50 -translate-y-20 focus:translate-y-0"
	>Skip to main content</Button
>
<div class="landing-page">
	<LandingHeader />
	<div class="mx-auto max-w-5xl border-border sm:border-x">
		<main id="main-content" tabindex="-1">
			<LandingHero />
			<LandingFeatures />
			<LandingPipeline />
			<LandingFAQ />
			<LandingCTA />
		</main>
		<LandingFooter />
	</div>
</div>
