import {
	useEffect,
	useId,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import '../spektral.css';
import { createSpektralErrorOverlayModel } from '../core/error-overlay-model.js';
import { registerErrorOverlay } from '../core/error-overlay-stack.js';
import type { SpektralErrorReport } from '../core/error-report.js';
import { Portal } from './Portal.js';

interface SpektralErrorOverlayProps {
	report: SpektralErrorReport;
	onDismiss: () => void;
}

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ChevronDownIcon() {
	return (
		<svg
			className="spektral-error-details-chevron"
			viewBox="0 0 18 18"
			fill="none"
			aria-hidden="true"
			focusable="false"
		>
			<polyline
				points="15.25 6.5 9 12.75 2.75 6.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function SpektralErrorOverlay({ report, onDismiss }: SpektralErrorOverlayProps) {
	const model = createSpektralErrorOverlayModel(report);
	const componentId = useId();
	const titleId = `${componentId}-title`;
	const descriptionId = `${componentId}-description`;
	const sourceTitleId = `${componentId}-source-title`;
	const overlayElement = useRef<HTMLDivElement | null>(null);
	const [dialogElement, setDialogElement] = useState<HTMLDivElement | null>(null);

	const getFocusableElements = (): HTMLElement[] => {
		if (!dialogElement) return [];

		return Array.from(dialogElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
			(element) => element.getAttribute('aria-hidden') !== 'true'
		);
	};

	const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
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

	useEffect(() => {
		if (!dialogElement) return;

		const portalRoot = overlayElement.current?.parentElement;
		if (!portalRoot) return;

		return registerErrorOverlay({ dialog: dialogElement, portalRoot, onDismiss });
	}, [dialogElement, onDismiss]);

	return (
		<Portal>
			<div ref={overlayElement} className="spektral-error-overlay" role="presentation">
				<div className="spektral-error-dialog-shell" role="presentation">
					<div
						ref={setDialogElement}
						className="spektral-error-dialog"
						role="alertdialog"
						aria-modal="true"
						aria-labelledby={titleId}
						aria-describedby={descriptionId}
						tabIndex={-1}
						data-testid="spektral-error"
						onKeyDown={handleDialogKeyDown}
					>
						<header className="spektral-error-header">
							<div className="spektral-error-header-top">
								<div className="spektral-error-header-copy">
									<h2 id={titleId} className="spektral-error-title">
										{report.title}
									</h2>
									<p className="spektral-error-recoverable">
										Recoverable: <span>{report.recoverable ? 'yes' : 'no'}</span>
									</p>
								</div>
								<div className="spektral-error-badges">
									<div className="spektral-error-badge-wrap">
										<p className="spektral-error-badge spektral-error-badge-phase">
											{report.phase}
										</p>
									</div>
									<div className="spektral-error-badge-wrap">
										<p className="spektral-error-badge spektral-error-badge-severity">
											{report.severity}
										</p>
									</div>
								</div>
							</div>
						</header>
						<div id={descriptionId} className="spektral-error-body">
							{model.displayMessage.length > 0 ? (
								<p className="spektral-error-message">{model.displayMessage}</p>
							) : null}
							<p className="spektral-error-hint">{report.hint}</p>
						</div>

						{model.metadata.length > 0 ? (
							<dl className="spektral-error-metadata" aria-label="Shader diagnostics">
								{model.metadata.map((entry) => (
									<div key={entry.label} className="spektral-error-metadata-item">
										<dt>{entry.label}</dt>
										<dd>{entry.value}</dd>
									</div>
								))}
							</dl>
						) : null}

						{report.source ? (
							<section className="spektral-error-source" aria-labelledby={sourceTitleId}>
								<h3 id={sourceTitleId} className="spektral-error-source-title">
									Source
								</h3>
								<figure className="spektral-error-source-frame">
									<figcaption className="spektral-error-source-tabs">
										<span className="spektral-error-source-tab spektral-error-source-tab-active">
											{report.source.location}
											{report.source.column ? `, col ${report.source.column}` : ''}
										</span>
										<span className="spektral-error-source-tab-spacer" aria-hidden="true"></span>
									</figcaption>

									<div
										className="spektral-error-source-snippet"
										role="region"
										aria-label={`Source code from ${report.source.location}`}
									>
										{report.source.snippet.map((snippetLine) => (
											<div
												key={`snippet-${snippetLine.number}`}
												className={
													snippetLine.highlight
														? 'spektral-error-source-row spektral-error-source-row-active'
														: 'spektral-error-source-row'
												}
											>
												<span className="spektral-error-source-line">
													{snippetLine.highlight ? (
														<span className="spektral-sr-only">Error line: </span>
													) : null}
													{snippetLine.number}
												</span>
												<span className="spektral-error-source-code">
													{snippetLine.code || ' '}
												</span>
											</div>
										))}
									</div>
								</figure>
							</section>
						) : null}

						<div className="spektral-error-sections">
							{model.stackText.length > 0 ? (
								<details className="spektral-error-details">
									<summary>
										<ChevronDownIcon />
										<span>Stack trace</span>
									</summary>
									<pre>{model.stackText}</pre>
								</details>
							) : null}
							{report.context ? (
								<details className="spektral-error-details">
									<summary>
										<ChevronDownIcon />
										<span>Runtime context</span>
									</summary>
									<pre>{model.runtimeContextText}</pre>
								</details>
							) : null}
						</div>
					</div>
				</div>
			</div>
		</Portal>
	);
}
