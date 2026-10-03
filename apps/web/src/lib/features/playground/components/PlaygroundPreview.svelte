<script lang="ts">
	import { labels } from '$lib/site/labels';
	import { Button } from '$lib/components/ui/button';
	import { ArrowRotateClockwiseIcon, CircleWarningIcon } from '$lib/icons';
	import type { PlaygroundController } from '../playground-controller.svelte';
	import { PLAYGROUND_PREVIEW_SANDBOX } from '$lib/playground-engine/preview/protocol';
	import PlaygroundFrameworkSwitch from './PlaygroundFrameworkSwitch.svelte';

	let {
		controller,
		onSelectFramework,
		onPreviewFrameChange
	}: {
		controller: PlaygroundController;
		onSelectFramework: (framework: string) => void;
		onPreviewFrameChange: (frame: HTMLIFrameElement | null) => void;
	} = $props();

	const registerPreviewFrame = (node: HTMLIFrameElement) => {
		onPreviewFrameChange(node);
		return {
			destroy() {
				onPreviewFrameChange(null);
			}
		};
	};
</script>

<section
	class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
	aria-label={labels.playground.preview}
>
	<div class="relative min-h-0 flex-1 overflow-hidden">
		{#key controller.previewFrameKey}
			<iframe
				use:registerPreviewFrame
				title={labels.playground.previewTitle}
				src={controller.previewUrl}
				class="block h-full w-full overflow-hidden"
				loading="eager"
				sandbox={PLAYGROUND_PREVIEW_SANDBOX}
				referrerpolicy="no-referrer"
			></iframe>
		{/key}
		<div class="absolute end-3 top-3 z-10 rounded-lg bg-background/95 shadow-sm backdrop-blur-md">
			<PlaygroundFrameworkSwitch activeFramework={controller.activeFramework} {onSelectFramework} />
		</div>
	</div>

	{#if controller.errorMessage}
		<div
			class="max-h-[45%] shrink-0 space-y-3 overflow-auto overscroll-contain border-t border-border bg-background p-4"
		>
			<div class="flex items-center gap-2 text-sm font-medium">
				<CircleWarningIcon
					size={16}
					strokeWidth={1.5}
					class="text-destructive"
					aria-hidden="true"
				/>
				{labels.playground.previewError}
			</div>
			<p
				class="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground"
				role="alert"
			>
				{controller.errorMessage}
			</p>
			<Button variant="outline" size="sm" onclick={controller.retryRuntime}>
				<ArrowRotateClockwiseIcon size={14} strokeWidth={1.5} aria-hidden="true" />
				{labels.playground.retryRuntime}
			</Button>
		</div>
	{/if}
</section>
