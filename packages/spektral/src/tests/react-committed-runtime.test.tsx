import { act, cleanup, render } from '@testing-library/react';
import { Suspense, startTransition, useLayoutEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { FragCanvas } from '../lib/react/FragCanvas';
import { useFrame } from '../lib/react/frame-context';
import { useTexture, type UseTextureResult } from '../lib/react/use-texture';
import { defineMaterial } from '../lib/core/material';
import type { SpektralRuntimeLoopOptions } from '../lib/core/runtime-loop';

const { createLoop } = vi.hoisted(() => ({
	createLoop: vi.fn((options: SpektralRuntimeLoopOptions) => {
		void options;
		return { requestFrame() {}, destroy() {} };
	})
}));
vi.mock('../lib/core/runtime-loop', () => ({ createSpektralRuntimeLoop: createLoop }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

it.each(['material', 'callback'] as const)(
	'publishes %s only after a suspended transition commits',
	async (field) => {
		const materials = [0, 1].map((value) =>
			defineMaterial({
				fragment: `fn frag(uv: vec2f) -> vec4f { return vec4f(${value}.0); }`
			})
		);
		const callbacks = [vi.fn(), vi.fn()] as const;
		let resume!: () => void;
		const pending = new Promise<void>((resolve) => {
			resume = resolve;
		});
		let blocked = true;
		function Probe({ version }: { version: 0 | 1 }) {
			useFrame(callbacks[version]);
			if (version === 1 && blocked) throw pending;
			return <span>version {version}</span>;
		}
		const tree = (version: 0 | 1) => (
			<Suspense fallback="loading">
				<FragCanvas material={materials[version]!}>
					<Probe version={version} />
				</FragCanvas>
			</Suspense>
		);
		const view = render(tree(0));
		const options = createLoop.mock.calls[0]![0];
		const runFrame = () =>
			options.registry.run({
				time: 1,
				delta: 0.016,
				canvas: options.canvas,
				setUniform: vi.fn(),
				setTexture: vi.fn(),
				writeStorageBuffer: vi.fn(),
				readStorageBuffer: async () => new ArrayBuffer(0),
				invalidate: vi.fn(),
				advance: vi.fn(),
				renderMode: 'always',
				autoRender: true
			});
		await act(async () => {
			startTransition(() => view.rerender(tree(1)));
		});
		expect(view.container.textContent).toBe('version 0');
		if (field === 'material') expect(options.getMaterial()).toBe(materials[0]);
		else {
			runFrame();
			expect(callbacks[0]).toHaveBeenCalledTimes(1);
			expect(callbacks[1]).not.toHaveBeenCalled();
		}
		await act(async () => {
			blocked = false;
			resume();
			await pending;
		});
		expect(view.container.textContent).toBe('version 1');
		expect(options.getMaterial()).toBe(materials[1]);
		runFrame();
		expect(callbacks[1]).toHaveBeenCalledTimes(1);
	}
);

it('reloads textures using committed URLs and options during Suspense', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, blob: async () => new Blob() }))
	);
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(async () => ({ width: 1, height: 1, close() {} }))
	);
	let result!: UseTextureResult;
	const pending = new Promise<void>(() => {});
	function Probe({ next }: { next: boolean }) {
		const value = useTexture([next ? '/pending.png' : '/committed.png'], {
			colorSpace: next ? 'linear' : 'srgb'
		});
		useLayoutEffect(() => {
			result = value;
		});
		if (next) throw pending;
		return <span>committed</span>;
	}
	const tree = (next: boolean) => (
		<Suspense fallback="loading">
			<Probe next={next} />
		</Suspense>
	);
	const view = render(tree(false));
	await act(async () => {
		await result.reload();
	});
	await act(async () => {
		startTransition(() => view.rerender(tree(true)));
	});
	await act(async () => {
		await result.reload();
	});
	expect(view.container.textContent).toBe('committed');
	expect(result.textures.current?.[0]?.url).toBe('/committed.png');
	expect(result.textures.current?.[0]?.colorSpace).toBe('srgb');
});
