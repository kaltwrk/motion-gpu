<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, useId } from 'vue';
import '../spektral.css';
import { createSpektralErrorOverlayModel } from '../core/error-overlay-model.js';
import { registerErrorOverlay } from '../core/error-overlay-stack.js';
import type { SpektralErrorReport } from '../core/error-report.js';
import Portal from './Portal.vue';

interface Props {
	report: SpektralErrorReport;
	onDismiss: () => void;
}

const props = defineProps<Props>();

const ChevronDownIcon = () =>
	h(
		'svg',
		{
			class: 'spektral-error-details-chevron',
			viewBox: '0 0 18 18',
			fill: 'none',
			'aria-hidden': 'true',
			focusable: 'false'
		},
		[
			h('polyline', {
				points: '15.25 6.5 9 12.75 2.75 6.5',
				stroke: 'currentColor',
				'stroke-width': '1.5',
				'stroke-linecap': 'round',
				'stroke-linejoin': 'round'
			})
		]
	);

const componentId = useId();
const titleId = `${componentId}-title`;
const descriptionId = `${componentId}-description`;
const sourceTitleId = `${componentId}-source-title`;
const focusableSelector =
	'a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const overlayElement = ref<HTMLDivElement | null>(null);
const dialogElement = ref<HTMLElement | null>(null);

function getFocusableElements(): HTMLElement[] {
	if (!dialogElement.value) return [];

	return Array.from(dialogElement.value.querySelectorAll<HTMLElement>(focusableSelector)).filter(
		(element) => element.getAttribute('aria-hidden') !== 'true'
	);
}

function handleDialogKeydown(event: KeyboardEvent): void {
	if (event.key !== 'Tab' || !dialogElement.value) return;

	const focusableElements = getFocusableElements();
	if (focusableElements.length === 0) {
		event.preventDefault();
		dialogElement.value.focus({ preventScroll: true });
		return;
	}

	const firstElement = focusableElements[0]!;
	const lastElement = focusableElements[focusableElements.length - 1]!;
	const activeElement = document.activeElement;
	const focusIsOutsideDialog =
		!(activeElement instanceof Node) || !dialogElement.value.contains(activeElement);

	if (
		event.shiftKey &&
		(activeElement === firstElement ||
			activeElement === dialogElement.value ||
			focusIsOutsideDialog)
	) {
		event.preventDefault();
		lastElement.focus();
		return;
	}

	if (
		!event.shiftKey &&
		(activeElement === lastElement || activeElement === dialogElement.value || focusIsOutsideDialog)
	) {
		event.preventDefault();
		firstElement.focus();
	}
}

let unregisterOverlay: (() => void) | undefined;

onMounted(() => {
	const portalRoot = overlayElement.value?.parentElement;
	if (!dialogElement.value || !portalRoot) return;

	unregisterOverlay = registerErrorOverlay({
		dialog: dialogElement.value,
		portalRoot,
		onDismiss: props.onDismiss
	});
});

onUnmounted(() => {
	unregisterOverlay?.();
});

const model = computed(() => createSpektralErrorOverlayModel(props.report));
const displayMessage = computed(() => model.value.displayMessage);
const showDisplayMessage = computed(() => displayMessage.value.length > 0);
</script>

<template>
	<Portal>
		<div ref="overlayElement" class="spektral-error-overlay" role="presentation">
			<div class="spektral-error-dialog-shell" role="presentation">
				<div
					ref="dialogElement"
					class="spektral-error-dialog"
					role="alertdialog"
					aria-modal="true"
					:aria-labelledby="titleId"
					:aria-describedby="descriptionId"
					tabindex="-1"
					data-testid="spektral-error"
					@keydown="handleDialogKeydown"
				>
					<header class="spektral-error-header">
						<div class="spektral-error-header-top">
							<div class="spektral-error-header-copy">
								<h2 :id="titleId" class="spektral-error-title">{{ report.title }}</h2>
								<p class="spektral-error-recoverable">
									Recoverable: <span>{{ report.recoverable ? 'yes' : 'no' }}</span>
								</p>
							</div>
							<div class="spektral-error-badges">
								<div class="spektral-error-badge-wrap">
									<p class="spektral-error-badge spektral-error-badge-phase">
										{{ report.phase }}
									</p>
								</div>
								<div class="spektral-error-badge-wrap">
									<p class="spektral-error-badge spektral-error-badge-severity">
										{{ report.severity }}
									</p>
								</div>
							</div>
						</div>
					</header>
					<div :id="descriptionId" class="spektral-error-body">
						<p v-if="showDisplayMessage" class="spektral-error-message">{{ displayMessage }}</p>
						<p class="spektral-error-hint">{{ report.hint }}</p>
					</div>

					<dl
						v-if="model.metadata.length > 0"
						class="spektral-error-metadata"
						aria-label="Shader diagnostics"
					>
						<div
							v-for="entry in model.metadata"
							:key="entry.label"
							class="spektral-error-metadata-item"
						>
							<dt>{{ entry.label }}</dt>
							<dd>{{ entry.value }}</dd>
						</div>
					</dl>

					<section
						v-if="report.source"
						class="spektral-error-source"
						:aria-labelledby="sourceTitleId"
					>
						<h3 :id="sourceTitleId" class="spektral-error-source-title">Source</h3>
						<figure class="spektral-error-source-frame">
							<figcaption class="spektral-error-source-tabs">
								<span class="spektral-error-source-tab spektral-error-source-tab-active"
									>{{ report.source.location
									}}<template v-if="report.source.column"
										>, col {{ report.source.column }}</template
									></span
								>
								<span class="spektral-error-source-tab-spacer" aria-hidden="true"></span>
							</figcaption>

							<div
								class="spektral-error-source-snippet"
								role="region"
								:aria-label="`Source code from ${report.source.location}`"
							>
								<div
									v-for="snippetLine in report.source.snippet"
									:key="`snippet-${snippetLine.number}`"
									class="spektral-error-source-row"
									:class="{ 'spektral-error-source-row-active': snippetLine.highlight }"
								>
									<span class="spektral-error-source-line">
										<span v-if="snippetLine.highlight" class="spektral-sr-only">Error line: </span
										>{{ snippetLine.number }}
									</span>
									<span class="spektral-error-source-code">{{ snippetLine.code || ' ' }}</span>
								</div>
							</div>
						</figure>
					</section>

					<div class="spektral-error-sections">
						<details v-if="model.stackText.length > 0" class="spektral-error-details">
							<summary><ChevronDownIcon /><span>Stack trace</span></summary>
							<pre>{{ model.stackText }}</pre>
						</details>
						<details v-if="report.context" class="spektral-error-details">
							<summary><ChevronDownIcon /><span>Runtime context</span></summary>
							<pre>{{ model.runtimeContextText }}</pre>
						</details>
					</div>
				</div>
			</div>
		</div>
	</Portal>
</template>
