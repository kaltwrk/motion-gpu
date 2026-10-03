<script lang="ts">
	import LandingSection from './LandingSection.svelte';
	import LandingActions from './LandingActions.svelte';
	import LandingBrand from './LandingBrand.svelte';
	import LandingGlass from './LandingGlass.svelte';
</script>

<LandingSection id="home" variant="full" class="isolate overflow-hidden">
	<LandingGlass />
	<div class="relative flex min-h-120 flex-col items-center justify-center gap-6 py-12 text-center">
		<LandingBrand markOnly class="mb-2" />
		<h1
			id="home-title"
			class="max-w-3xl text-4xl leading-[1.1] font-medium tracking-tight text-balance sm:text-5xl"
		>
			<span class="text-primary">Minimalist</span> framework for modern
			<span class="text-primary">WebGPU</span> visuals.
		</h1>
		<p class="max-w-lg text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
			If you need performance, clarity, and composability in WebGPU, this is the right stack.
		</p>
		<div class="mt-2"><LandingActions /></div>
	</div>
</LandingSection>
