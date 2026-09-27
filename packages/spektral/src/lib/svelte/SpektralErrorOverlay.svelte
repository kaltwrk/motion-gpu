<script lang="ts">
	import { onMount } from 'svelte';
	import '../spektral.css';
	import { createSpektralErrorOverlayModel } from '../core/error-overlay-model';
	import { registerErrorOverlay } from '../core/error-overlay-stack';
	import type { SpektralErrorReport } from '../core/error-report';
	import Portal from './Portal.svelte';

	interface Props {
		report: SpektralErrorReport;
		onDismiss: () => void;
	}

	let { report, onDismiss }: Props = $props();
	const model = $derived(createSpektralErrorOverlayModel(report));

	const componentId = $props.id();
	const titleId = `${componentId}-title`;
	const descriptionId = `${componentId}-description`;
	const sourceTitleId = `${componentId}-source-title`;
	const focusableSelector =
		'a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	let overlayElement = $state<HTMLDivElement | null>(null);
	let dialogElement = $state<HTMLElement | null>(null);

	const getFocusableElements = (): HTMLElement[] => {
		if (!dialogElement) return [];

		return Array.from(dialogElement.querySelectorAll<HTMLElement>(focusableSelector)).filter(
			(element) => element.getAttribute('aria-hidden') !== 'true'
		);
	};

	const handleDialogKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Tab' || !dialogElement) return;

		const focusableElements = getFocusableElements();
		if (focusableElements.length === 0) {
			event.preventDefault();
			dialogElement.focus({ preventScroll: true });
			return;
		}

		const firstElement = focusableElements[0]!;
		const lastElement = focusableElements[focusableElements.length - 1]!;
		const activeElement = document.activeElement;
		const focusIsOutsideDialog =
			!(activeElement instanceof Node) || !dialogElement.contains(activeElement);

		if (
			event.shiftKey &&
			(activeElement === firstElement || activeElement === dialogElement || focusIsOutsideDialog)
		) {
			event.preventDefault();
			lastElement.focus();
			return;
		}

		if (
			!event.shiftKey &&
			(activeElement === lastElement || activeElement === dialogElement || focusIsOutsideDialog)
		) {
			event.preventDefault();
			firstElement.focus();
		}
	};

	onMount(() => {
		const portalRoot = overlayElement?.parentElement;
		if (!dialogElement || !portalRoot) return;

		return registerErrorOverlay({ dialog: dialogElement, portalRoot, onDismiss });
	});
</script>

{#snippet chevronDownIcon()}
	<svg
		class="spektral-error-details-chevron"
		viewBox="0 0 18 18"
		fill="none"
		aria-hidden="true"
		focusable="false"
	>
		<polyline
			points="15.25 6.5 9 12.75 2.75 6.5"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
{/snippet}

<Portal>
	<div bind:this={overlayElement} class="spektral-error-overlay" role="presentation">
		<div class="spektral-error-dialog-shell" role="presentation">
			<div
				bind:this={dialogElement}
				class="spektral-error-dialog"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				tabindex="-1"
				data-testid="spektral-error"
				onkeydown={handleDialogKeydown}
			>
				<header class="spektral-error-header">
					<div class="spektral-error-header-top">
						<div class="spektral-error-header-copy">
							<h2 id={titleId} class="spektral-error-title">{report.title}</h2>
							<p class="spektral-error-recoverable">
								Recoverable: <span>{report.recoverable ? 'yes' : 'no'}</span>
							</p>
						</div>
						<div class="spektral-error-badges">
							<div class="spektral-error-badge-wrap">
								<p class="spektral-error-badge spektral-error-badge-phase">
									{report.phase}
								</p>
							</div>
							<div class="spektral-error-badge-wrap">
								<p class="spektral-error-badge spektral-error-badge-severity">
									{report.severity}
								</p>
							</div>
						</div>
					</div>
				</header>
				<div id={descriptionId} class="spektral-error-body">
					{#if model.displayMessage.length > 0}
						<p class="spektral-error-message">{model.displayMessage}</p>
					{/if}
					<p class="spektral-error-hint">{report.hint}</p>
				</div>

				{#if model.metadata.length > 0}
					<dl class="spektral-error-metadata" aria-label="Shader diagnostics">
						{#each model.metadata as entry (entry.label)}
							<div class="spektral-error-metadata-item">
								<dt>{entry.label}</dt>
								<dd>{entry.value}</dd>
							</div>
						{/each}
					</dl>
				{/if}

				{#if report.source}
					<section class="spektral-error-source" aria-labelledby={sourceTitleId}>
						<h3 id={sourceTitleId} class="spektral-error-source-title">Source</h3>
						<figure class="spektral-error-source-frame">
							<figcaption class="spektral-error-source-tabs">
								<span class="spektral-error-source-tab spektral-error-source-tab-active"
									>{report.source.location}{#if report.source.column}, col {report.source
											.column}{/if}</span
								>
								<span class="spektral-error-source-tab-spacer" aria-hidden="true"></span>
							</figcaption>

							<div
								class="spektral-error-source-snippet"
								role="region"
								aria-label={`Source code from ${report.source.location}`}
							>
								{#each report.source.snippet as snippetLine (`snippet-${snippetLine.number}`)}
									<div
										class="spektral-error-source-row"
										class:spektral-error-source-row-active={snippetLine.highlight}
									>
										<span class="spektral-error-source-line">
											{#if snippetLine.highlight}<span class="spektral-sr-only"
													>Error line:
												</span>{/if}{snippetLine.number}
										</span>
										<span class="spektral-error-source-code">{snippetLine.code || ' '}</span>
									</div>
								{/each}
							</div>
						</figure>
					</section>
				{/if}

				<div class="spektral-error-sections">
					{#if model.stackText.length > 0}
						<details class="spektral-error-details">
							<summary>
								{@render chevronDownIcon()}
								<span>Stack trace</span>
							</summary>
							<pre>{model.stackText}</pre>
						</details>
					{/if}
					{#if report.context}
						<details class="spektral-error-details">
							<summary>
								{@render chevronDownIcon()}
								<span>Runtime context</span>
							</summary>
							<pre>{model.runtimeContextText}</pre>
						</details>
					{/if}
				</div>
			</div>
		</div>
	</div>
</Portal>
