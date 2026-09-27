import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useRef } from 'react';
import {
	attachShaderCompilationDiagnostics,
	getShaderCompilationDiagnostics
} from '../lib/core/error-diagnostics.js';
import type { SpektralErrorReport } from '../lib/core/error-report.js';
import { defineMaterial, type FragMaterial } from '../lib/core/material.js';
import type { RenderMode } from '../lib/core/types.js';
import { FragCanvas } from '../lib/react/FragCanvas.js';
import type { SpektralContext } from '../lib/react/spektral-context.js';
import { useSpektral } from '../lib/react/spektral-context.js';
import { useFrame } from '../lib/react/frame-context.js';
import {
	runErrorHistoryContract,
	type ErrorHistoryMutationMode
} from './helpers/error-history-contract.js';

const { createRendererMock } = vi.hoisted(() => ({
	createRendererMock: vi.fn()
}));

vi.mock('../lib/core/renderer', () => ({
	createRenderer: createRendererMock
}));

const material = defineMaterial({
	fragment: `
fn frag(uv: vec2f) -> vec4f {
	return vec4f(uv.x, uv.y, 0.5, 1.0);
}
`
});
const alternateMaterial = defineMaterial({
	fragment: `
fn frag(uv: vec2f) -> vec4f {
	return vec4f(1.0 - uv.x, uv.y, 0.2, 1.0);
}
`
});
const runtimeBindingsMaterial = defineMaterial({
	fragment: `
fn frag(uv: vec2f) -> vec4f {
	return vec4f(uv, 0.0, 1.0);
}
`,
	uniforms: {
		uGain: 0
	},
	textures: {
		uTex: {}
	}
});

interface MockRenderer {
	render: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
}

type FrameMutationMode = 'none' | 'valid-both' | 'invalid-uniform' | 'invalid-texture';

let rafQueue: FrameRequestCallback[] = [];
let retryTimers: Array<{ callback: () => void; delayMs: number }> = [];

async function flushFrame(timestamp: number): Promise<void> {
	const callback = rafQueue.shift();
	if (!callback) {
		throw new Error('No queued animation frame callback');
	}

	callback(timestamp);
	await Promise.resolve();
	await Promise.resolve();
}

function stubRetryTimers(): { clearTimeoutMock: ReturnType<typeof vi.fn> } {
	retryTimers = [];
	vi.stubGlobal(
		'setTimeout',
		vi.fn((callback: () => void, delayMs?: number) => {
			retryTimers.push({ callback, delayMs: delayMs ?? 0 });
			return retryTimers.length as unknown as ReturnType<typeof setTimeout>;
		})
	);
	const clearTimeoutMock = vi.fn();
	vi.stubGlobal('clearTimeout', clearTimeoutMock);
	return { clearTimeoutMock };
}

function flushRetryTimer(index = 0): void {
	const timer = retryTimers[index];
	if (!timer) {
		throw new Error('No queued retry timer callback');
	}
	timer.callback();
}

function SpektralProbe({ onProbe }: { onProbe: (value: SpektralContext) => void }) {
	const context = useSpektral();

	useEffect(() => {
		onProbe(context);
	}, [context, onProbe]);

	return null;
}

function SpektralWithControlProbe({
	onProbe,
	renderMode = 'always',
	autoRender = true,
	dpr = 1,
	maxDelta = 0.1
}: {
	onProbe: (value: SpektralContext) => void;
	renderMode?: RenderMode;
	autoRender?: boolean;
	dpr?: number;
	maxDelta?: number;
}) {
	const probeMaterial = defineMaterial({
		fragment: `
fn frag(uv: vec2f) -> vec4f {
	return vec4f(uv.x, uv.y, 0.4, 1.0);
}
`
	});

	return (
		<FragCanvas
			material={probeMaterial}
			renderMode={renderMode}
			autoRender={autoRender}
			dpr={dpr}
			maxDelta={maxDelta}
			showErrorOverlay={false}
		>
			<SpektralProbe onProbe={onProbe} />
		</FragCanvas>
	);
}

function FrameMutationProbe({ mode = 'none' }: { mode?: FrameMutationMode }) {
	const runtimeTextureRef = useRef<HTMLCanvasElement | null>(null);
	if (!runtimeTextureRef.current) {
		const canvas = document.createElement('canvas');
		canvas.width = 2;
		canvas.height = 2;
		runtimeTextureRef.current = canvas;
	}
	const appliedModeRef = useRef<FrameMutationMode | null>(null);

	useFrame(
		({ setUniform, setTexture }) => {
			if (mode === 'none' || appliedModeRef.current === mode) {
				return;
			}
			appliedModeRef.current = mode;

			if (mode === 'valid-both') {
				setUniform('uGain', 0.75);
				setTexture('uTex', runtimeTextureRef.current);
				return;
			}

			if (mode === 'invalid-uniform') {
				setUniform('uMissing', 1);
				return;
			}

			setTexture('uMissing', runtimeTextureRef.current);
		},
		{ autoInvalidate: false }
	);

	return null;
}

function FragCanvasFrameMutationHarness({
	material,
	mode = 'none',
	onError,
	onErrorHistory,
	errorHistoryLimit,
	showErrorOverlay = false
}: {
	material: FragMaterial;
	mode?: FrameMutationMode;
	onError?: (report: SpektralErrorReport) => void;
	onErrorHistory?: (history: readonly SpektralErrorReport[]) => void;
	errorHistoryLimit?: number;
	showErrorOverlay?: boolean;
}) {
	return (
		<FragCanvas
			material={material}
			showErrorOverlay={showErrorOverlay}
			{...(onError ? { onError } : {})}
			{...(onErrorHistory ? { onErrorHistory } : {})}
			{...(errorHistoryLimit !== undefined ? { errorHistoryLimit } : {})}
		>
			<FrameMutationProbe mode={mode} />
		</FragCanvas>
	);
}

describe('React FragCanvas runtime', () => {
	beforeEach(() => {
		rafQueue = [];
		retryTimers = [];
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn((callback: FrameRequestCallback) => {
				rafQueue.push(callback);
				return rafQueue.length;
			})
		);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		createRendererMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('rebuilds renderer when color outputEncoding changes', async () => {
		const created: Array<{ renderer: MockRenderer; options: { color?: unknown } }> = [];
		createRendererMock.mockImplementation(async (options: { color?: unknown }) => {
			const renderer: MockRenderer = {
				render: vi.fn(),
				destroy: vi.fn()
			};
			created.push({ renderer, options });
			return renderer;
		});

		const view = render(<FragCanvas material={material} showErrorOverlay={false} />);

		await flushFrame(16);
		await waitFor(() => {
			expect(createRendererMock).toHaveBeenCalledTimes(1);
		});
		expect(createRendererMock.mock.calls[0]?.[0]).toMatchObject({
			graphUpdater: {
				reset: expect.any(Function),
				setSnapshot: expect.any(Function)
			}
		});

		await flushFrame(32);
		await waitFor(() => {
			expect(created[0]?.renderer.render).toHaveBeenCalled();
		});

		view.rerender(
			<FragCanvas
				material={material}
				color={{ outputEncoding: 'linear' }}
				showErrorOverlay={false}
			/>
		);
		await flushFrame(48);
		await waitFor(() => {
			expect(createRendererMock).toHaveBeenCalledTimes(2);
		});
		expect(createRendererMock.mock.calls[1]?.[0].graphUpdater).toBe(
			createRendererMock.mock.calls[0]?.[0].graphUpdater
		);

		expect(created[1]?.options.color).toEqual({ outputEncoding: 'linear' });
		expect(created[0]?.renderer.destroy).toHaveBeenCalledTimes(1);

		await flushFrame(64);
		await waitFor(() => {
			expect(created[1]?.renderer.render).toHaveBeenCalled();
		});
	});

	it('rebuilds renderer when color pipeline changes', async () => {
		const created: Array<{ renderer: MockRenderer; options: { color?: unknown } }> = [];
		createRendererMock.mockImplementation(async (options: { color?: unknown }) => {
			const renderer: MockRenderer = {
				render: vi.fn(),
				destroy: vi.fn()
			};
			created.push({ renderer, options });
			return renderer;
		});

		const view = render(<FragCanvas material={material} showErrorOverlay={false} />);

		await flushFrame(16);
		await waitFor(() => {
			expect(createRendererMock).toHaveBeenCalledTimes(1);
		});

		view.rerender(
			<FragCanvas material={material} color={{ dynamicRange: 'hdr' }} showErrorOverlay={false} />
		);
		await flushFrame(32);
		await waitFor(() => {
			expect(createRendererMock).toHaveBeenCalledTimes(2);
		});

		expect(created[1]?.options.color).toEqual({ dynamicRange: 'hdr' });
		expect(created[0]?.renderer.destroy).toHaveBeenCalledTimes(1);
	});

	it('updates runtime context when control props change after mount', async () => {
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);
		const contexts: SpektralContext[] = [];

		const view = render(
			<SpektralWithControlProbe
				onProbe={(value) => {
					contexts[0] = value;
				}}
				autoRender={true}
				dpr={1}
				maxDelta={0.1}
			/>
		);

		await waitFor(() => {
			expect(contexts[0]).toBeDefined();
		});
		const context = contexts[0];
		if (!context) {
			throw new Error('Missing Spektral context');
		}
		expect(context?.autoRender.current).toBe(true);
		expect(context?.dpr.current).toBe(1);
		expect(context?.maxDelta.current).toBe(0.1);

		view.rerender(
			<SpektralWithControlProbe
				onProbe={(value) => {
					contexts[0] = value;
				}}
				autoRender={false}
				dpr={2}
				maxDelta={0.25}
			/>
		);

		await waitFor(() => {
			expect(context?.autoRender.current).toBe(false);
			expect(context?.dpr.current).toBe(2);
			expect(context?.maxDelta.current).toBe(0.25);
		});
		expect(rafQueue.length).toBeGreaterThan(0);
	});

	it('applies retry backoff after renderer initialization failure and recovers', async () => {
		let now = 0;
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		stubRetryTimers();

		const recoveredRenderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockRejectedValueOnce(new Error('bootstrap failed'));
		createRendererMock.mockResolvedValue(recoveredRenderer);

		const onError = vi.fn();
		render(<FragCanvas material={material} onError={onError} showErrorOverlay={false} />);

		await flushFrame(16);
		expect(createRendererMock).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: 'initialization',
				rawMessage: 'bootstrap failed'
			})
		);
		expect(retryTimers.at(-1)?.delayMs).toBe(250);
		expect(rafQueue).toHaveLength(0);

		now = 100;
		expect(createRendererMock).toHaveBeenCalledTimes(1);
		expect(rafQueue).toHaveLength(0);

		now = 300;
		flushRetryTimer();
		expect(rafQueue).toHaveLength(1);
		await flushFrame(48);
		expect(createRendererMock).toHaveBeenCalledTimes(2);

		await flushFrame(64);
		expect(recoveredRenderer.render).toHaveBeenCalled();
	});

	it('resets retry backoff immediately when material signature changes', async () => {
		let now = 0;
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		const { clearTimeoutMock } = stubRetryTimers();

		const recoveredRenderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockRejectedValueOnce(new Error('bootstrap failed'));
		createRendererMock.mockResolvedValue(recoveredRenderer);

		const view = render(<FragCanvas material={material} showErrorOverlay={false} />);

		await flushFrame(16);
		expect(createRendererMock).toHaveBeenCalledTimes(1);
		expect(retryTimers.at(-1)?.delayMs).toBe(250);

		now = 120;
		view.rerender(<FragCanvas material={alternateMaterial} showErrorOverlay={false} />);
		await flushFrame(32);
		expect(clearTimeoutMock).toHaveBeenCalledTimes(1);
		expect(createRendererMock).toHaveBeenCalledTimes(2);
	});

	it('does not enqueue duplicate renderer rebuild while previous rebuild is pending', async () => {
		let resolveRenderer!: (renderer: MockRenderer) => void;
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockImplementation(
			() =>
				new Promise<MockRenderer>((resolve) => {
					resolveRenderer = resolve;
				})
		);

		render(<FragCanvas material={material} showErrorOverlay={false} />);

		await flushFrame(16);
		expect(createRendererMock).toHaveBeenCalledTimes(1);
		expect(rafQueue).toHaveLength(0);

		resolveRenderer(renderer);
		await Promise.resolve();
		await Promise.resolve();
		expect(rafQueue.length).toBeGreaterThan(0);
		await flushFrame(32);
		await waitFor(() => {
			expect(renderer.render).toHaveBeenCalledTimes(1);
		});
	});

	it('stops scheduling frames in manual mode while idle and wakes on advance()', async () => {
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);

		const onProbe = vi.fn();
		render(<SpektralWithControlProbe onProbe={onProbe} renderMode="manual" />);

		await waitFor(() => {
			expect(onProbe).toHaveBeenCalledTimes(1);
		});
		const context = onProbe.mock.calls[0]?.[0] as SpektralContext;

		await flushFrame(16);
		await flushFrame(32);
		expect(renderer.render).toHaveBeenCalledTimes(0);
		expect(rafQueue).toHaveLength(0);

		context.advance();
		expect(rafQueue).toHaveLength(1);
		await flushFrame(48);
		expect(renderer.render).toHaveBeenCalledTimes(1);
		expect(rafQueue).toHaveLength(0);
	});

	it('stops scheduling frames in on-demand idle and wakes on invalidate()', async () => {
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);

		const onProbe = vi.fn();
		render(<SpektralWithControlProbe onProbe={onProbe} renderMode="on-demand" />);

		await waitFor(() => {
			expect(onProbe).toHaveBeenCalledTimes(1);
		});
		const context = onProbe.mock.calls[0]?.[0] as SpektralContext;

		await flushFrame(16);
		await flushFrame(32);
		expect(renderer.render).toHaveBeenCalledTimes(1);
		expect(rafQueue).toHaveLength(1);

		await flushFrame(48);
		expect(renderer.render).toHaveBeenCalledTimes(1);
		expect(rafQueue).toHaveLength(0);

		context.invalidate();
		expect(rafQueue).toHaveLength(1);
		await flushFrame(64);
		expect(renderer.render).toHaveBeenCalledTimes(2);
	});

	it('wakes frame loop when context renderMode switches to always from manual idle', async () => {
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);

		const onProbe = vi.fn();
		render(<SpektralWithControlProbe onProbe={onProbe} renderMode="manual" />);

		await waitFor(() => {
			expect(onProbe).toHaveBeenCalledTimes(1);
		});
		const context = onProbe.mock.calls[0]?.[0] as SpektralContext;

		await flushFrame(16);
		await flushFrame(32);
		expect(rafQueue).toHaveLength(0);
		expect(renderer.render).toHaveBeenCalledTimes(0);

		context.renderMode.set('always');
		expect(rafQueue).toHaveLength(1);
		await flushFrame(48);
		expect(renderer.render).toHaveBeenCalledTimes(1);
		expect(rafQueue.length).toBeGreaterThan(0);
	});

	it('stops frame processing after component unmount', async () => {
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);

		const view = render(<FragCanvas material={material} showErrorOverlay={false} />);
		await flushFrame(16);
		await flushFrame(32);
		expect(renderer.render).toHaveBeenCalledTimes(1);

		view.unmount();
		await flushFrame(48);
		expect(renderer.render).toHaveBeenCalledTimes(1);
	});

	it('shows one shader error at a time and advances after a material edit', async () => {
		const diagnosticsError = attachShaderCompilationDiagnostics(
			new Error('WGSL compilation failed:\nmissing return\nexpected ;'),
			{
				kind: 'shader-compilation',
				diagnostics: [
					{
						generatedLine: 21,
						message: 'missing return',
						linePos: 6,
						lineLength: 7,
						sourceLocation: { kind: 'fragment', line: 2 }
					},
					{
						generatedLine: 22,
						message: 'expected ;',
						sourceLocation: { kind: 'fragment', line: 3 }
					}
				],
				fragmentSource: [
					'fn frag(uv: vec2f) -> vec4f {',
					'\tlet broken = uv.x',
					'\treturn vec4f(uv, 0.0, 1.0);',
					'}'
				].join('\n'),
				includeSources: {},
				materialSource: { component: 'OverlayScene.svelte' },
				runtimeContext: {
					materialSignature: '{"fragment":"overlay-hash"}',
					passGraph: {
						passCount: 3,
						enabledPassCount: 2,
						inputs: ['source', 'fxMain'],
						outputs: ['fxA', 'canvas']
					},
					activeRenderTargets: ['fxMain', 'fxA']
				}
			}
		);
		diagnosticsError.stack = [
			`Error: ${diagnosticsError.message}`,
			'at render (Renderer.ts:42:7)'
		].join('\n');
		const throwingRenderer: MockRenderer = {
			render: vi.fn(() => {
				throw diagnosticsError;
			}),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(throwingRenderer);

		const view = render(<FragCanvas material={material} />);
		await flushFrame(16);
		await flushFrame(32);

		const overlay = await screen.findByTestId('spektral-error');
		expect(overlay.getAttribute('role')).toBe('alertdialog');
		expect(overlay.getAttribute('aria-modal')).toBe('true');
		const titleId = overlay.getAttribute('aria-labelledby');
		const descriptionId = overlay.getAttribute('aria-describedby');
		expect(titleId).toBeTruthy();
		expect(descriptionId).toBeTruthy();
		expect(document.getElementById(titleId ?? '')?.textContent).toBe(
			overlay.querySelector('h2')?.textContent
		);
		expect(document.getElementById(descriptionId ?? '')?.textContent).toContain('missing return');
		await waitFor(() => expect(document.activeElement).toBe(overlay));
		const summaries = Array.from(overlay.querySelectorAll<HTMLElement>('summary'));
		const firstSummary = summaries[0]!;
		const lastSummary = summaries[summaries.length - 1]!;
		lastSummary.focus();
		lastSummary.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(firstSummary);
		firstSummary.focus();
		firstSummary.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Tab',
				shiftKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		expect(document.activeElement).toBe(lastSummary);
		expect(overlay.querySelector('[role="tablist"]')).toBeNull();
		expect(overlay.querySelector('[role="tab"]')).toBeNull();
		expect(overlay.querySelector('.spektral-error-source-frame > figcaption')).not.toBeNull();
		expect(overlay.querySelector('.spektral-error-metadata')).toBeNull();
		expect(overlay.textContent).toContain('WGSL compilation failed');
		expect(overlay.textContent).toContain('missing return');
		expect(overlay.textContent).toContain('OverlayScene.svelte (fragment line 2');
		expect(overlay.textContent).toContain('let broken = uv.x');
		expect(overlay.textContent).not.toContain('Additional diagnostics');
		expect(overlay.textContent).not.toContain('expected ;');
		expect(overlay.textContent).toContain('Stack trace');
		expect(overlay.textContent).toContain('at render (Renderer.ts:42:7)');
		expect(overlay.querySelector('.spektral-error-code')).toBeNull();
		expect(overlay.textContent).not.toContain('WGSL_COMPILATION_FAILED');
		expect(overlay.querySelector('.spektral-error-badge-severity')?.textContent).toContain('error');
		expect(overlay.querySelector('.spektral-error-recoverable')?.textContent).toContain('yes');
		expect(overlay.querySelectorAll('.spektral-error-badge')).toHaveLength(2);
		expect(overlay.querySelectorAll('.spektral-error-badge-wrap')).toHaveLength(2);
		const detailChevrons = overlay.querySelectorAll('.spektral-error-details-chevron');
		expect(detailChevrons).toHaveLength(2);
		expect(detailChevrons[0]?.getAttribute('viewBox')).toBe('0 0 18 18');
		expect(detailChevrons[0]?.getAttribute('aria-hidden')).toBe('true');
		expect(detailChevrons[0]?.querySelector('polyline')?.getAttribute('points')).toBe(
			'15.25 6.5 9 12.75 2.75 6.5'
		);
		expect(overlay.textContent).toContain('Runtime context');
		expect(overlay.textContent).toContain('materialSignature:');
		expect(overlay.textContent).toContain('"fragment": "overlay-hash"');
		expect(overlay.textContent).toContain('passGraph:');
		expect(overlay.textContent).toContain('passCount: 3');
		expect(overlay.textContent).toContain('enabledPassCount: 2');
		expect(overlay.textContent).toContain('inputs:');
		expect(overlay.textContent).toContain('- source');
		expect(overlay.textContent).toContain('- fxMain');
		expect(overlay.textContent).toContain('outputs:');
		expect(overlay.textContent).toContain('- fxA');
		expect(overlay.textContent).toContain('- canvas');
		expect(overlay.textContent).toContain('activeRenderTargets:');
		const runtimeContextDetails = Array.from(
			overlay.querySelectorAll('.spektral-error-details')
		).find((section) => section.querySelector('summary')?.textContent?.includes('Runtime context'));
		expect(runtimeContextDetails).toBeTruthy();
		expect(runtimeContextDetails?.hasAttribute('open')).toBe(false);

		const diagnostics = getShaderCompilationDiagnostics(diagnosticsError)!;
		const nextError = attachShaderCompilationDiagnostics(
			new Error('WGSL compilation failed:\nexpected ;'),
			{ ...diagnostics, diagnostics: diagnostics.diagnostics.slice(1) }
		);
		throwingRenderer.render.mockImplementation(() => {
			throw nextError;
		});
		view.rerender(<FragCanvas material={alternateMaterial} />);
		await flushFrame(48);
		await flushFrame(64);

		await waitFor(() => {
			const nextOverlay = screen.getByTestId('spektral-error');
			expect(nextOverlay.textContent).toContain('expected ;');
			expect(nextOverlay.textContent).not.toContain('missing return');
			expect(nextOverlay.textContent).toContain('OverlayScene.svelte (fragment line 3)');
			expect(nextOverlay.querySelectorAll('.spektral-error-source-row-active')).toHaveLength(1);
		});
		document.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		await waitFor(() => expect(screen.queryByTestId('spektral-error')).toBeNull());
	});

	it('renders include diagnostics location in overlay source header', async () => {
		const diagnosticsError = attachShaderCompilationDiagnostics(
			new Error('WGSL compilation failed:\nunknown function call'),
			{
				kind: 'shader-compilation',
				diagnostics: [
					{
						generatedLine: 25,
						message: 'unknown function call',
						linePos: 4,
						lineLength: 8,
						sourceLocation: { kind: 'include', include: 'tone', line: 2 }
					}
				],
				fragmentSource: [
					'fn frag(uv: vec2f) -> vec4f {',
					'\tlet mapped = tone(uv);',
					'\treturn vec4f(mapped, 1.0);',
					'}'
				].join('\n'),
				includeSources: {
					tone: ['fn tone(uv: vec2f) -> vec3f {', '\treturn vec3f(uv, 1.0);', '}'].join('\n')
				},
				materialSource: null
			}
		);
		diagnosticsError.stack = '';
		createRendererMock.mockResolvedValue({
			render: vi.fn(() => {
				throw diagnosticsError;
			}),
			destroy: vi.fn()
		} satisfies MockRenderer);

		render(<FragCanvas material={material} />);
		await flushFrame(16);
		await flushFrame(32);

		const overlay = await screen.findByTestId('spektral-error');
		expect(overlay.textContent).toContain('#include <tone> (include <tone> line 2)');
		expect(overlay.textContent).not.toContain('#include <tone> (fragment line 2)');
	});

	it('renders diagnostics source header without column and preserves blank snippet lines', async () => {
		const diagnosticsError = attachShaderCompilationDiagnostics(
			new Error('WGSL compilation failed:\nmissing return'),
			{
				kind: 'shader-compilation',
				diagnostics: [
					{
						generatedLine: 31,
						message: 'missing return',
						sourceLocation: { kind: 'fragment', line: 3 }
					}
				],
				fragmentSource: [
					'fn frag(uv: vec2f) -> vec4f {',
					'',
					'\treturn vec4f(uv, 0.0, 1.0);',
					'}'
				].join('\n'),
				includeSources: {},
				materialSource: { component: 'NoColumnScene.svelte' }
			}
		);
		diagnosticsError.stack = '';
		createRendererMock.mockResolvedValue({
			render: vi.fn(() => {
				throw diagnosticsError;
			}),
			destroy: vi.fn()
		} satisfies MockRenderer);

		render(<FragCanvas material={material} />);
		await flushFrame(16);
		await flushFrame(32);

		const overlay = await screen.findByTestId('spektral-error');
		expect(overlay.textContent).toContain('NoColumnScene.svelte (fragment line 3)');
		expect(overlay.textContent).not.toContain(', col');
		const snippetLines = Array.from(overlay.querySelectorAll('.spektral-error-source-code'));
		expect(snippetLines.some((line) => line.textContent === ' ')).toBe(true);
	});

	it('shows only the main error when source diagnostics are unavailable', async () => {
		const genericError = new Error('top-level failure\ndetail line one');
		genericError.stack = '';
		createRendererMock.mockResolvedValue({
			render: vi.fn(() => {
				throw genericError;
			}),
			destroy: vi.fn()
		} satisfies MockRenderer);

		render(<FragCanvas material={material} />);
		await flushFrame(16);
		await flushFrame(32);

		const overlay = await screen.findByTestId('spektral-error');
		expect(overlay.textContent).toContain('top-level failure');
		expect(overlay.textContent).not.toContain('Technical details');
		expect(overlay.textContent).not.toContain('detail line one');
		expect(overlay.textContent).not.toContain('Stack trace');
	});

	it('applies frame uniform/texture writes and clears stale runtime maps after material change', async () => {
		const created: MockRenderer[] = [];
		createRendererMock.mockImplementation(async () => {
			const renderer: MockRenderer = {
				render: vi.fn(),
				destroy: vi.fn()
			};
			created.push(renderer);
			return renderer;
		});

		const view = render(
			<FragCanvasFrameMutationHarness
				material={runtimeBindingsMaterial}
				mode="valid-both"
				showErrorOverlay={false}
			/>
		);

		await flushFrame(16);
		await waitFor(() => {
			expect(createRendererMock).toHaveBeenCalledTimes(1);
		});
		await flushFrame(32);
		await waitFor(() => {
			expect(created[0]?.render).toHaveBeenCalledTimes(1);
		});
		await flushFrame(40);
		await waitFor(() => {
			expect(created[0]?.render).toHaveBeenCalledTimes(2);
		});

		const firstRenderInput = created[0]?.render.mock.calls[0]?.[0] as
			| { uniforms: Record<string, unknown>; textures: Record<string, unknown> }
			| undefined;
		expect(firstRenderInput?.uniforms['uGain']).toBe(0.75);
		expect(firstRenderInput?.textures['uTex']).toBeTruthy();

		view.rerender(
			<FragCanvasFrameMutationHarness material={material} mode="none" showErrorOverlay={false} />
		);
		await flushFrame(48);
		await waitFor(() => {
			expect(createRendererMock).toHaveBeenCalledTimes(2);
		});
		await flushFrame(64);
		await waitFor(() => {
			expect(created[1]?.render).toHaveBeenCalledTimes(1);
		});

		const secondRenderInput = created[1]?.render.mock.calls[0]?.[0] as
			| { uniforms: Record<string, unknown>; textures: Record<string, unknown> }
			| undefined;
		expect('uGain' in (secondRenderInput?.uniforms ?? {})).toBe(false);
		expect('uTex' in (secondRenderInput?.textures ?? {})).toBe(false);
	});

	it('reports render-phase error for unknown uniform writes from frame callbacks', async () => {
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);
		const onError = vi.fn();

		render(
			<FragCanvasFrameMutationHarness
				material={runtimeBindingsMaterial}
				mode="invalid-uniform"
				onError={onError}
				showErrorOverlay={false}
			/>
		);

		await flushFrame(16);
		await flushFrame(32);
		await waitFor(() => {
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					phase: 'render',
					rawMessage: expect.stringContaining('Unknown uniform "uMissing"')
				})
			);
		});
		expect(renderer.render).not.toHaveBeenCalled();
	});

	it('reports render-phase error for unknown texture writes from frame callbacks', async () => {
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);
		const onError = vi.fn();

		render(
			<FragCanvasFrameMutationHarness
				material={runtimeBindingsMaterial}
				mode="invalid-texture"
				onError={onError}
				showErrorOverlay={false}
			/>
		);

		await flushFrame(16);
		await flushFrame(32);
		await waitFor(() => {
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					phase: 'render',
					rawMessage: expect.stringContaining('Unknown texture "uMissing"')
				})
			);
		});
		expect(renderer.render).not.toHaveBeenCalled();
	});

	it('captures error history with ring-buffer limit', async () => {
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);
		const onErrorHistory = vi.fn();

		const view = render(
			<FragCanvasFrameMutationHarness
				material={runtimeBindingsMaterial}
				mode="invalid-uniform"
				onErrorHistory={onErrorHistory}
				errorHistoryLimit={2}
				showErrorOverlay={false}
			/>
		);

		await flushFrame(16);
		await flushFrame(32);
		await waitFor(() => {
			const latest = onErrorHistory.mock.calls[onErrorHistory.mock.calls.length - 1]?.[0] as
				| Array<{ rawMessage: string }>
				| undefined;
			expect(latest).toHaveLength(1);
			expect(latest?.[0]?.rawMessage).toContain('Unknown uniform "uMissing"');
		});

		view.rerender(
			<FragCanvasFrameMutationHarness
				material={runtimeBindingsMaterial}
				mode="invalid-texture"
				onErrorHistory={onErrorHistory}
				errorHistoryLimit={2}
				showErrorOverlay={false}
			/>
		);
		await flushFrame(48);
		await waitFor(() => {
			const latest = onErrorHistory.mock.calls[onErrorHistory.mock.calls.length - 1]?.[0] as
				| Array<{ rawMessage: string }>
				| undefined;
			expect(latest).toHaveLength(2);
			expect(latest?.[0]?.rawMessage).toContain('Unknown uniform "uMissing"');
			expect(latest?.[1]?.rawMessage).toContain('Unknown texture "uMissing"');
		});

		view.rerender(
			<FragCanvasFrameMutationHarness
				material={runtimeBindingsMaterial}
				mode="invalid-uniform"
				onErrorHistory={onErrorHistory}
				errorHistoryLimit={2}
				showErrorOverlay={false}
			/>
		);
		await flushFrame(64);
		await waitFor(() => {
			const latest = onErrorHistory.mock.calls[onErrorHistory.mock.calls.length - 1]?.[0] as
				| Array<{ rawMessage: string }>
				| undefined;
			expect(latest).toHaveLength(2);
			expect(latest?.[0]?.rawMessage).toContain('Unknown texture "uMissing"');
			expect(latest?.[1]?.rawMessage).toContain('Unknown uniform "uMissing"');
		});
	});

	it('continues rendering when user-provided onError callback throws', async () => {
		const renderer: MockRenderer = {
			render: vi
				.fn()
				.mockImplementationOnce(() => {
					throw new Error('frame failure');
				})
				.mockImplementation(() => {}),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);
		const onError = vi.fn(() => {
			throw new Error('user onError failure');
		});

		render(<FragCanvas material={material} onError={onError} showErrorOverlay={false} />);

		await flushFrame(16);
		await flushFrame(32);
		await waitFor(() => {
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					phase: 'render',
					rawMessage: 'frame failure'
				})
			);
		});
		await flushFrame(48);
		expect(renderer.render).toHaveBeenCalledTimes(2);
	});

	it('reports initialization error when material becomes invalid during render loop', async () => {
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);
		const onError = vi.fn();

		const invalidMaterial = {
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			uniforms: {},
			textures: {},
			defines: {}
		};

		const view = render(
			<FragCanvas material={material} onError={onError} showErrorOverlay={false} />
		);
		await flushFrame(16);
		await flushFrame(32);
		await waitFor(() => {
			expect(renderer.render).toHaveBeenCalledTimes(1);
		});

		view.rerender(
			<FragCanvas
				material={invalidMaterial as unknown as typeof material}
				onError={onError}
				showErrorOverlay={false}
			/>
		);
		await flushFrame(48);
		await waitFor(() => {
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					phase: 'initialization',
					rawMessage: expect.stringContaining('Invalid material instance')
				})
			);
		});
	});

	it('deduplicates repeated initialization errors for unchanged invalid material', async () => {
		const onError = vi.fn();
		const invalidMaterial = {
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			uniforms: {},
			textures: {},
			defines: {}
		};

		render(
			<FragCanvas
				material={invalidMaterial as unknown as typeof material}
				onError={onError}
				showErrorOverlay={false}
			/>
		);

		await waitFor(() => {
			expect(onError).toHaveBeenCalledTimes(1);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					phase: 'initialization',
					rawMessage: expect.stringContaining('Invalid material instance')
				})
			);
		});
		expect(createRendererMock).not.toHaveBeenCalled();

		expect(onError).toHaveBeenCalledTimes(1);
		expect(createRendererMock).not.toHaveBeenCalled();
	});

	it('disposes late-created renderer when component unmounts mid-initialization', async () => {
		let resolveRenderer!: (renderer: MockRenderer) => void;
		createRendererMock.mockImplementation(
			() =>
				new Promise<MockRenderer>((resolve) => {
					resolveRenderer = resolve;
				})
		);

		const lateRenderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		const view = render(<FragCanvas material={material} showErrorOverlay={false} />);

		await flushFrame(16);
		view.unmount();
		resolveRenderer(lateRenderer);
		await Promise.resolve();
		await Promise.resolve();

		expect(lateRenderer.destroy).toHaveBeenCalledTimes(1);
	});

	it('recovers when material becomes valid after initial initialization error', async () => {
		const renderer: MockRenderer = {
			render: vi.fn(),
			destroy: vi.fn()
		};
		createRendererMock.mockResolvedValue(renderer);

		const onError = vi.fn();
		const invalidMaterial = {
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			uniforms: {},
			textures: {},
			defines: {}
		};
		const view = render(
			<FragCanvas
				material={invalidMaterial as unknown as typeof material}
				onError={onError}
				showErrorOverlay={false}
			/>
		);

		await waitFor(() => {
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					phase: 'initialization',
					rawMessage: expect.stringContaining('Invalid material instance')
				})
			);
		});
		expect(createRendererMock).not.toHaveBeenCalled();

		view.rerender(<FragCanvas material={material} onError={onError} showErrorOverlay={false} />);

		await flushFrame(16);
		await waitFor(() => {
			expect(createRendererMock).toHaveBeenCalledTimes(1);
		});
		await flushFrame(32);
		await waitFor(() => {
			expect(renderer.render).toHaveBeenCalled();
		});
	});

	runErrorHistoryContract('React', async ({ historyLimit: initialLimit, onErrorHistory }) => {
		const renderer: MockRenderer = { render: vi.fn(), destroy: vi.fn() };
		createRendererMock.mockResolvedValue(renderer);
		let historyLimit = initialLimit;
		let mode: ErrorHistoryMutationMode | 'none' = 'none';
		let timestamp = 16;
		const renderHarness = () => (
			<FragCanvasFrameMutationHarness
				material={runtimeBindingsMaterial}
				mode={mode}
				onErrorHistory={onErrorHistory}
				errorHistoryLimit={historyLimit}
				showErrorOverlay={false}
			/>
		);
		const view = render(renderHarness());

		await flushFrame(timestamp);
		timestamp += 16;
		await flushFrame(timestamp);
		timestamp += 16;

		return {
			emitError: async (nextMode) => {
				mode = nextMode;
				view.rerender(renderHarness());
				await flushFrame(timestamp);
				timestamp += 16;
			},
			updateLimit: async (nextLimit) => {
				historyLimit = nextLimit;
				view.rerender(renderHarness());
				await flushFrame(timestamp);
				timestamp += 16;
			},
			unmount: () => view.unmount()
		};
	});
});
