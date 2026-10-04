<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { observeAnimationFrames } from '../observe-animation-frames';
	import { useFrame } from '../../src/lib/svelte/frame-context';
	import { useSpektral } from '../../src/lib/svelte/spektral-context';
	import type { RenderMode } from '../../src/lib/core/types';

	export interface RuntimeControls {
		setRenderMode: (mode: RenderMode) => void;
		invalidate: () => void;
		advance: () => void;
		setTaskActive: (active: boolean) => void;
	}

	interface Props {
		passive?: boolean;
		onFrame: (count: number) => void;
		onReady: (controls: RuntimeControls) => void;
	}

	let { onFrame, onReady, passive = false }: Props = $props();
	const context = useSpektral();
	let frameCount = 0;

	const countFrame = () => {
		frameCount += 1;
		onFrame(frameCount);
	};
	const task = useFrame(
		() => {
			if (!passive) countFrame();
		},
		{ autoInvalidate: false, autoStart: untrack(() => !passive) }
	);

	onMount(() => {
		onReady({
			setRenderMode: (mode) => context.renderMode.set(mode),
			invalidate: context.invalidate,
			advance: context.advance,
			setTaskActive: (active) => (active ? task.start() : task.stop())
		});
		return passive ? observeAnimationFrames(countFrame) : undefined;
	});
</script>
