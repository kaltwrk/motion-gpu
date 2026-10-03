<script lang="ts">
	import { labels } from '$lib/site/labels';
	import { FrameworkReactIcon, FrameworkSvelteIcon, FrameworkVueIcon } from '$lib/icons';
	import { contentUiDefaults, formatUiText } from '$lib/site/content-ui';
	import { Button } from '$lib/components/ui/button';

	type Framework = 'svelte' | 'react' | 'vue';

	type Props = {
		activeFramework: string;
		onSelectFramework: (framework: string) => void;
	};

	let { activeFramework, onSelectFramework }: Props = $props();

	const frameworkOptions: Array<{ value: Framework; label: string }> =
		contentUiDefaults.framework.enabled.map((value) => ({
			value,
			label: labels.framework.names[value]
		}));

	function selectAndFocus(index: number, group: HTMLElement | null) {
		const option = frameworkOptions[index];
		if (!option) return;
		onSelectFramework(option.value);
		group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus();
	}

	function handleKeydown(event: KeyboardEvent, index: number) {
		const lastIndex = frameworkOptions.length - 1;
		let nextIndex: number;

		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				event.preventDefault();
				nextIndex = index === lastIndex ? 0 : index + 1;
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				event.preventDefault();
				nextIndex = index === 0 ? lastIndex : index - 1;
				break;
			case 'Home':
				event.preventDefault();
				nextIndex = 0;
				break;
			case 'End':
				event.preventDefault();
				nextIndex = lastIndex;
				break;
			default:
				return;
		}

		const currentTarget = event.currentTarget;
		selectAndFocus(
			nextIndex,
			currentTarget instanceof HTMLElement ? currentTarget.closest('[role="radiogroup"]') : null
		);
	}
</script>

<div
	class="inline-flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5"
	role="radiogroup"
	aria-label={labels.framework.label}
>
	{#each frameworkOptions as framework, index (framework.value)}
		<Button
			variant="ghost"
			size="sm"
			class="gap-1.5 px-2 text-xs text-muted-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-2xs dark:aria-checked:bg-secondary"
			role="radio"
			tabindex={framework.value === activeFramework ? 0 : -1}
			aria-label={formatUiText(labels.framework.switch, { framework: framework.label })}
			aria-checked={framework.value === activeFramework}
			onclick={() => onSelectFramework(framework.value)}
			onkeydown={(event) => handleKeydown(event, index)}
		>
			{#if framework.value === 'svelte'}
				<FrameworkSvelteIcon size={14} aria-hidden="true" />
			{:else if framework.value === 'react'}
				<FrameworkReactIcon size={14} aria-hidden="true" />
			{:else}
				<FrameworkVueIcon size={14} aria-hidden="true" />
			{/if}
		</Button>
	{/each}
</div>
