<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconLayoutLeftOutline18.js
Original name: IconLayoutLeftOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<rect
		x="1.75"
		y="2.75"
		width="14.5"
		height="12.5"
		rx="2"
		ry="2"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
	/>
	<line
		x1="4.75"
		y1="5.75"
		x2="4.75"
		y2="12.25"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
		data-color="color-2"
	/>
</IconRoot>
