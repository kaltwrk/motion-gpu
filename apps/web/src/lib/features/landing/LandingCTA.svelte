<script lang="ts">
	import LandingSection from './LandingSection.svelte';
	import LandingActions from './LandingActions.svelte';
	import LandingGlass from './LandingGlass.svelte';
	import * as Card from '$lib/components/ui/card';
</script>

<LandingSection id="cta">
	<Card.Root class="rounded-2xl bg-muted p-1 shadow-sm">
		<div
			class="relative isolate w-full overflow-hidden rounded-xl bg-card px-6 py-16 text-center shadow-sm sm:px-12 sm:py-20"
		>
			<LandingGlass />
			<div class="relative mx-auto flex max-w-3xl flex-col items-center gap-6">
				<h2
					id="cta-title"
					class="text-3xl leading-tight font-medium tracking-tight text-balance sm:text-4xl"
				>
					Bring your shader pipeline to <span class="text-primary">production</span>.
				</h2>
				<p class="max-w-xl text-base leading-relaxed text-pretty text-muted-foreground">
					Open the playground to iterate fast, then move to docs for strict contracts, render
					passes, and deterministic frame scheduling.
				</p>
				<div class="mt-2"><LandingActions /></div>
			</div>
		</div>
	</Card.Root>
</LandingSection>
