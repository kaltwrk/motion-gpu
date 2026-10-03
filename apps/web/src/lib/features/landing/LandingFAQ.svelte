<script lang="ts">
	import { onMount } from 'svelte';
	import * as Accordion from '$lib/components/ui/accordion';
	import { CircleQuestionIcon } from '$lib/icons';
	import LandingSection from './LandingSection.svelte';
	import LandingSectionHeader from './LandingSectionHeader.svelte';
	import LandingPanel from './LandingPanel.svelte';
	import { faqItems } from './content';

	let ready = $state(false);
	onMount(() => {
		ready = true;
	});
</script>

<LandingSection id="faq" variant="muted">
	<LandingSectionHeader
		id="faq-title"
		label="FAQ"
		title="Common questions before you build."
		description="A quick introduction to what Spektral is, who it is for, and how to begin."
		icon={CircleQuestionIcon}
	/>
	<LandingPanel>
		<Accordion.Root type="multiple" disabled={!ready} class="grid gap-1">
			{#each faqItems as item (item.question)}
				<Accordion.Item value={item.question} class="rounded-xl border-none bg-card shadow-sm">
					<Accordion.Trigger
						class="items-center gap-4 rounded-xl px-4 py-5 text-base hover:no-underline sm:px-6"
						>{item.question}</Accordion.Trigger
					>
					<Accordion.Content
						class="ps-4 pe-12 pb-5 text-base leading-relaxed text-pretty text-muted-foreground sm:ps-6 sm:pe-14"
						><p>{item.answer}</p></Accordion.Content
					>
				</Accordion.Item>
			{/each}
		</Accordion.Root>
	</LandingPanel>
</LandingSection>
