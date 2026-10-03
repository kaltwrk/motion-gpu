<script lang="ts">
	import { onMount } from 'svelte';
	import { useFrame, useSpektral, usePointer, type ComputePass } from 'spektral/svelte';

	interface Props {
		clearDensity: ComputePass;
		simulate: ComputePass;
	}

	let { clearDensity, simulate }: Props = $props();

	const FRAME_ID_LIMIT = 16_000_000;

	const context = useSpektral();

	let targetRotateY = 0;
	let targetRotateX = 0;
	let smoothRotateY = 0;
	let smoothRotateX = 0;
	let autoRotateY = 0;
	let frameId = 0;

	const pointer = usePointer({
		onDown: () => {
			const canvas = context.canvas;
			if (canvas) {
				canvas.style.cursor = 'grabbing';
			}
		},
		onUp: () => {
			const canvas = context.canvas;
			if (canvas) {
				canvas.style.cursor = 'grab';
			}
		}
	});

	onMount(() => {
		const canvas = context.canvas;
		if (!canvas) return;

		canvas.style.cursor = 'grab';

		return () => {
			canvas.style.cursor = '';
		};
	});

	useFrame((state) => {
		frameId += 1;
		const resetDensity = frameId >= FRAME_ID_LIMIT;
		clearDensity.enabled = resetDensity;
		simulate.enabled = !resetDensity;
		if (resetDensity) frameId = 0;

		const pointerState = pointer.state.current;
		if (pointerState.pressed && pointerState.dragging) {
			targetRotateY += pointerState.deltaPx[0] * -0.005;
			targetRotateX += pointerState.deltaPx[1] * -0.005;
			targetRotateX = Math.max(-1.1, Math.min(1.1, targetRotateX));
		}

		autoRotateY += state.delta * 0.24;

		smoothRotateY += (targetRotateY - smoothRotateY) * 0.14;
		smoothRotateX += (targetRotateX - smoothRotateX) * 0.14;

		state.setUniform('uRotateY', autoRotateY + smoothRotateY);
		state.setUniform('uRotateX', smoothRotateX);
		state.setUniform('uFrameId', frameId);
	});
</script>
