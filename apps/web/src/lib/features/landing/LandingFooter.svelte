<script lang="ts">
	import { resolve } from '$app/paths';
	import LandingBrand from './LandingBrand.svelte';
	import LandingSection from './LandingSection.svelte';
	import { footerGroups } from './content';
</script>

<LandingSection variant="muted" class="p-0!" id="footer">
	<footer aria-label="Site footer">
		<h2 id="footer-title" class="sr-only">Site links</h2>
		<div class="mx-auto max-w-4xl">
			<div
				class="grid gap-12 px-4 py-8 sm:px-8 sm:py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
			>
				<div>
					<a
						href={resolve('/')}
						aria-label="Spektral home"
						class="inline-flex rounded-lg transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
						><LandingBrand /></a
					>
				</div>
				<div class="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-4">
					{#each footerGroups as group (group.label)}
						<nav aria-label={group.label}>
							<h2 class="mb-4 text-sm font-medium">{group.label}</h2>
							<ul>
								{#each group.links as link (link.label)}
									{@const external = link.href.startsWith('https:')}
									<li>
										<!-- External URLs are local product links; internal paths go through resolve. -->
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											href={link.href.startsWith('https:') ? link.href : resolve(link.href as '/')}
											target={external ? '_blank' : undefined}
											rel={external ? 'noreferrer' : undefined}
											class="inline-flex min-h-8 items-center rounded-md text-sm text-muted-foreground transition-all ease-in-out outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
											>{link.label}</a
										>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									</li>
								{/each}
							</ul>
						</nav>
					{/each}
				</div>
			</div>
		</div>
	</footer>
</LandingSection>
