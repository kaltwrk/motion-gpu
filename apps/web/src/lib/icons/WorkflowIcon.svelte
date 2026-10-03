<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconWorkflowOutline18.js
Original name: IconWorkflowOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';
	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
<path d="m8.25,4.75c1.1046,0,2,.8954,2,2v4.5c0,1.1046.8954,2,2,2h3.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} />
<circle cx="3.75" cy="4.75" r="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} data-color="color-2" />
<polyline points="13.5 10.5 16.25 13.25 13.5 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} />
</IconRoot>
