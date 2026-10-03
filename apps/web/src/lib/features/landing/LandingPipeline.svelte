<script lang="ts">
	import { WorkflowIcon } from '$lib/icons';
	import LandingSection from './LandingSection.svelte';
	import LandingSectionHeader from './LandingSectionHeader.svelte';
	import LandingPanel from './LandingPanel.svelte';
	import LandingCard from './LandingCard.svelte';
	import { steps } from './content';
</script>

<LandingSection id="how-it-works" variant="default">
	<LandingSectionHeader
		id="how-it-works-title"
		label="How It Works"
		title="A transparent pipeline from start to finish"
		description="From first shader line to production diagnostics, each step keeps rendering behavior explicit and composable."
		icon={WorkflowIcon}
	/>
	<LandingPanel>
		<ol class="grid gap-1 sm:grid-cols-2">
			{#each steps as step, index (step.number)}
				<li class={index % 2 === 1 ? 'sm:translate-y-36' : undefined}><LandingCard {...step} /></li>
			{/each}
		</ol>
	</LandingPanel>
</LandingSection>
