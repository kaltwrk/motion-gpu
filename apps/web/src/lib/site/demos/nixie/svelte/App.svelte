<script lang="ts">
	import { FragCanvas } from 'spektral/svelte';
	import { studioColor } from '../../../demo-shared/presentation';
	import { createNixieScene, reportSceneError } from '../material';
	import Runtime from './runtime.svelte';

	const { material, passes, renderTargets } = createNixieScene();
</script>

<FragCanvas
	{material}
	{passes}
	{renderTargets}
	renderMode="on-demand"
	dpr={1.5}
	maxDelta={1 / 30}
	color={studioColor}
	showErrorOverlay={false}
	onError={reportSceneError}
	style="display:block;width:100%;height:100%;touch-action:none"
>
	<Runtime />
</FragCanvas>
