<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { CopyFeedbackIcon } from '$lib/components/copy-feedback';
	import type { SectionUiConfig } from '$lib/site/content-ui';
	import { siteConfig } from '$lib/site/site';
	import { Button } from '$lib/components/ui/button';
	import { ButtonGroup, ButtonGroupSeparator } from '$lib/components/ui/button-group';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ChevronDownIcon, CopyIcon } from '$lib/icons';
	import { copyRawMarkdown, resolveDocsActionGroups } from './actions';

	type Props = {
		rawPath: string;
		rawUrl: string;
		title: string;
		config: SectionUiConfig['pageActions'];
	};

	type CopyState = 'idle' | 'copying' | 'success' | 'error';
	let { rawPath, rawUrl, title, config }: Props = $props();

	let copyState = $state<CopyState>('idle');
	let copyContentWidth = $state<number>();
	let copyWidthMotionReady = $state(false);
	let resetTimeout: ReturnType<typeof setTimeout> | undefined;

	const actionGroups = $derived(resolveDocsActionGroups({ product: siteConfig.name, url: rawUrl, title }));
	const hasActionLinks = $derived(actionGroups.length > 0);
	const announcement = $derived(
		copyState === 'success'
			? config.copy.announcement
			: copyState === 'error'
				? config.copy.errorAnnouncement
				: ''
	);

	function copyLabel() {
		return config.copy[copyState];
	}

	const measureCopyContent: Attachment<HTMLSpanElement> = (node) => {
		let enableMotionFrame: number | undefined;
		let hasMeasured = false;

		const updateWidth = () => {
			const isInitialMeasurement = !hasMeasured;
			hasMeasured = true;
			copyContentWidth = Math.ceil(node.getBoundingClientRect().width);

			if (isInitialMeasurement) {
				enableMotionFrame = requestAnimationFrame(() => {
					copyWidthMotionReady = true;
				});
			}
		};
		const observer = new ResizeObserver(updateWidth);

		observer.observe(node);
		updateWidth();

		return () => {
			observer.disconnect();
			if (enableMotionFrame !== undefined) {
				cancelAnimationFrame(enableMotionFrame);
			}
		};
	};

	async function copyMarkdown() {
		if (copyState === 'copying') return;
		clearTimeout(resetTimeout);

		if (copyState !== 'success') {
			copyState = 'copying';
		}

		try {
			await copyRawMarkdown(rawPath);
			copyState = 'success';
		} catch {
			copyState = 'error';
		}

		resetTimeout = setTimeout(() => {
			copyState = 'idle';
		}, 2400);
	}

	onDestroy(() => clearTimeout(resetTimeout));
</script>

<ButtonGroup
	aria-label={config.label}
	class="rounded-lg shadow-2xs bg-primary"
>
	{#if config.showCopyMarkdown}<Button
		size="sm"
		variant="default"
		class="shadow-none active:not-aria-[haspopup]:scale-100"
		aria-busy={copyState === 'copying'}
		onclick={() => void copyMarkdown()}
	>
		<span
			class={[
				'-mx-1 inline-flex overflow-hidden',
				copyWidthMotionReady
					? 'transition-[width] duration-150 ease-out motion-reduce:transition-none'
					: 'transition-none'
			]}
			style:width={copyContentWidth === undefined ? undefined : `${copyContentWidth}px`}
		>
			<span
				class="inline-flex w-max shrink-0 items-center gap-1.5 px-1"
				{@attach measureCopyContent}
			>
				<CopyFeedbackIcon copied={copyState === 'success'} idleIcon={CopyIcon} />
				<span>{copyLabel()}</span>
			</span>
		</span>
	</Button>{/if}

	{#if config.showAssistantLinks && hasActionLinks}
		{#if config.showCopyMarkdown}<ButtonGroupSeparator class="bg-white/20" />{/if}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						type="button"
						variant="default"
						size="icon-sm"
						class="shadow-none"
						aria-label={config.moreLabel}
					>
						<ChevronDownIcon aria-hidden="true" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>

			<DropdownMenu.Content align="start" class="w-auto">
				{#each actionGroups as group, groupIndex (group.label)}
					{#if groupIndex > 0}
						<DropdownMenu.Separator />
					{/if}

					<DropdownMenu.Group>
						<DropdownMenu.GroupHeading class="text-xs font-medium text-muted-foreground">
							{group.label}
						</DropdownMenu.GroupHeading>

						{#each group.items as item (item.label)}
							{@const Icon = item.icon}
							<DropdownMenu.Item
								class="transition-[color,background-color,border-color,box-shadow,scale,background-size] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
							>
								{#snippet child({ props })}
									<a
										{...props}
										href={item.href}
										target={item.opensNewTab ? '_blank' : undefined}
										rel="external noopener noreferrer"
									>
										<Icon size={16} aria-hidden="true" />
										<span class="whitespace-nowrap">{item.label}</span>
										{#if item.opensNewTab}
											<span class="sr-only">{config.newTabHint}</span>
										{/if}
									</a>
								{/snippet}
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Group>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/if}
</ButtonGroup>

<p class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
