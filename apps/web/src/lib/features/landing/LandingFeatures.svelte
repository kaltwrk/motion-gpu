<script lang="ts">
	import { Grid2x2Icon } from '$lib/icons';
	import LandingSection from './LandingSection.svelte';
	import LandingSectionHeader from './LandingSectionHeader.svelte';
	import LandingPanel from './LandingPanel.svelte';
	import LandingCard from './LandingCard.svelte';
	import { features } from './content';
</script>

<LandingSection id="features" variant="muted">
	<LandingSectionHeader
		id="features-title"
		label="Features"
		title="Strict contracts for deterministic rendering"
		description="From a single fullscreen fragment shader to multi-pass effects, Spektral gives you strict contracts and deterministic runtime behavior."
		icon={Grid2x2Icon}
	/>
	<LandingPanel>
		<div class="grid gap-1 sm:grid-cols-2">
			{#each features as feature (feature.title)}<LandingCard {...feature} />{/each}
		</div>
	</LandingPanel>
</LandingSection>
