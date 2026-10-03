<script lang="ts">
	import LandingSection from './LandingSection.svelte';
	import LandingActions from './LandingActions.svelte';
	import * as Card from '$lib/components/ui/card';
</script>

<LandingSection id="cta">
	<Card.Root class="rounded-2xl bg-muted p-1 shadow-sm">
		<div
			class="relative isolate w-full overflow-hidden rounded-xl bg-card px-6 py-16 text-center shadow-sm sm:px-12 sm:py-20"
		>
			<div class="hero-glow pointer-events-none absolute inset-0 -z-10" aria-hidden="true"></div>
			<div class="relative mx-auto flex max-w-3xl flex-col items-center gap-6">
				<h2
					id="cta-title"
					class="text-3xl leading-tight font-medium tracking-tight text-balance sm:text-4xl"
				>
					Start with a <span class="text-primary">working shader</span>.
				</h2>
				<p class="max-w-xl text-base leading-relaxed text-pretty text-muted-foreground">
					Open an editable example in Svelte, React, or Vue. Change the shader and preview the
					result, then follow the setup guide to use Spektral in your app.
				</p>
				<div class="mt-2">
					<LandingActions
						playgroundLabel="Try an example"
						docsLabel="Read the setup guide"
						docsSlug="getting-started"
					/>
				</div>
			</div>
		</div>
	</Card.Root>
</LandingSection>
