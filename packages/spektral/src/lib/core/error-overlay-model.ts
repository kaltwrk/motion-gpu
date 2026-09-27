import type { SpektralErrorContext, SpektralErrorReport } from './error-report.js';

export interface SpektralErrorOverlayModel {
	readonly displayMessage: string;
	readonly stackText: string;
	readonly runtimeContextText: string;
	readonly metadata: readonly SpektralErrorOverlayMetadata[];
}

export interface SpektralErrorOverlayMetadata {
	readonly label: string;
	readonly value: string;
}

function normalizeErrorText(value: string): string {
	return value
		.trim()
		.replace(/[.:!]+$/g, '')
		.toLowerCase();
}

function resolveDisplayMessage(report: SpektralErrorReport): string {
	const rawMessage = report.message.trim();
	if (
		rawMessage.length === 0 ||
		normalizeErrorText(rawMessage) === normalizeErrorText(report.title)
	) {
		return '';
	}

	const escapedTitle = report.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const stripped = rawMessage
		.replace(new RegExp(`^${escapedTitle}\\s*[:\\-|]\\s*`, 'i'), '')
		.trim();
	return stripped.length > 0 ? stripped : rawMessage;
}

function indentBlock(value: string, spaces = 2): string {
	const prefix = ' '.repeat(spaces);
	return value
		.split('\n')
		.map((line) => `${prefix}${line}`)
		.join('\n');
}

function formatStack(report: SpektralErrorReport): string {
	// Error.stack can repeat every diagnostic from the multiline error message.
	// Keep those messages out of the overlay, including its collapsed stack trace.
	const messageLines = new Set(
		[report.rawMessage, report.message, ...report.details]
			.flatMap((message) => message.split('\n'))
			.map((line) => line.trim())
	);
	return report.stack.filter((line) => !messageLines.has(line.trim())).join('\n');
}

function formatMaterialSignature(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) return '<empty>';

	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return trimmed;
	}
}

function appendList(lines: string[], values: readonly string[], indent = 2): void {
	const prefix = ' '.repeat(indent);
	if (values.length === 0) {
		lines.push(`${prefix}- <none>`);
		return;
	}
	for (const value of values) lines.push(`${prefix}- ${value}`);
}

function formatRuntimeContext(context: SpektralErrorContext | null): string {
	if (!context) return '';

	const lines: string[] = [];
	if (context.materialSignature) {
		lines.push(
			'materialSignature:',
			indentBlock(formatMaterialSignature(context.materialSignature))
		);
	}
	if (context.passGraph) {
		lines.push(
			'passGraph:',
			`  passCount: ${context.passGraph.passCount}`,
			`  enabledPassCount: ${context.passGraph.enabledPassCount}`,
			'  inputs:'
		);
		appendList(lines, context.passGraph.inputs, 4);
		lines.push('  outputs:');
		appendList(lines, context.passGraph.outputs, 4);
	}
	lines.push('activeRenderTargets:');
	appendList(lines, context.activeRenderTargets);
	return lines.join('\n');
}

function buildMetadata(report: SpektralErrorReport): readonly SpektralErrorOverlayMetadata[] {
	const shader = report.shader;
	if (!shader) return Object.freeze([]);
	const metadata: SpektralErrorOverlayMetadata[] = [];
	if (shader.passKind) {
		metadata.push({
			label: 'Pass',
			value: shader.passLabel ? `${shader.passLabel} (${shader.passKind})` : shader.passKind
		});
	}
	if (shader.inputFormat && shader.outputFormat) {
		metadata.push({
			label: 'Formats',
			value: `${shader.inputFormat} → ${shader.outputFormat}`
		});
	}
	return Object.freeze(metadata.map((entry) => Object.freeze(entry)));
}

/** Creates the framework-neutral text model rendered by all error overlays. */
export function createSpektralErrorOverlayModel(
	report: SpektralErrorReport
): SpektralErrorOverlayModel {
	return Object.freeze({
		displayMessage: resolveDisplayMessage(report),
		stackText: formatStack(report),
		runtimeContextText: formatRuntimeContext(report.context),
		metadata: buildMetadata(report)
	});
}
