<script lang="ts">
	import { labels } from '$lib/site/labels';
	import { CodeBlock, CopyCodeButton } from '$lib/components/code-block';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import { LanguageBashIcon } from '$lib/icons';
	import { getHighlighter } from '$lib/utils/highlighter';
	import {
		packageManagers,
		packageManagerStore,
		type PackageManager
	} from '$lib/stores/package-manager.svelte';
	import { siteConfig } from '$lib/site/site';

	type Props = { pkg?: string; args?: string; isDev?: boolean };
	let { pkg = siteConfig.package.name, args, isDev = false }: Props = $props();
	const commands: Record<PackageManager, string> = $derived({
		npm: `npm install ${isDev ? '-D ' : ''}${pkg} ${args ?? ''}`,
		pnpm: `pnpm add ${isDev ? '-D ' : ''}${pkg} ${args ?? ''}`,
		bun: `bun add ${isDev ? '-D ' : ''}${pkg} ${args ?? ''}`,
		yarn: `yarn add ${isDev ? '-D ' : ''}${pkg} ${args ?? ''}`
	});
	const activeCommand = $derived(commands[packageManagerStore.active]);
	const highlighted = $derived.by(() => {
		const highlighter = getHighlighter();
		return Object.fromEntries(
			packageManagers.map((manager) => [
				manager,
				{
					light: highlighter.codeToHtml(commands[manager], {
						lang: 'bash',
						theme: 'github-light',
						tabindex: false
					}),
					dark: highlighter.codeToHtml(commands[manager], {
						lang: 'bash',
						theme: 'github-dark',
						tabindex: false
					})
				}
			])
		) as Record<PackageManager, { light: string; dark: string }>;
	});
</script>

<Card.Root
	size="sm"
	class="my-6 gap-0 bg-muted px-1 pt-0 pb-1 transition-shadow has-[[data-scrollable]:focus-visible]:ring-[3px] has-[[data-scrollable]:focus-visible]:ring-ring/50 has-[[data-scrollable]:focus-visible]:outline-1"
>
	<Tabs.Root
		value={packageManagerStore.active}
		onValueChange={(value) => {
			packageManagerStore.active = value as PackageManager;
		}}
		class="gap-0"
	>
		<div class="relative flex h-11 items-center px-4">
			<LanguageBashIcon size={16} class="me-2 shrink-0 text-muted-foreground" aria-hidden="true" />
			<Tabs.List variant="line" aria-label={labels.code.packageManager}>
				{#each packageManagers as manager (manager)}
					<Tabs.Trigger value={manager}>{manager}</Tabs.Trigger>
				{/each}
			</Tabs.List>
			<CopyCodeButton
				value={activeCommand}
				label={labels.code.copyInstall}
				class="absolute right-2"
			/>
		</div>
		{#each packageManagers as manager (manager)}
			<Tabs.Content value={manager} tabindex={-1} class="rounded-lg bg-card shadow-sm">
				<CodeBlock
					code={commands[manager]}
					htmlLight={highlighted[manager].light}
					htmlDark={highlighted[manager].dark}
					label={`${manager} install command`}
					lineNumbers={false}
					compact
					framed={false}
					copyable={false}
					class="bg-transparent"
				/>
			</Tabs.Content>
		{/each}
	</Tabs.Root>
</Card.Root>
