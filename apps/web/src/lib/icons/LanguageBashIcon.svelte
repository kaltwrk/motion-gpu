<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconSquareTerminalOutline18.js
Original name: IconSquareTerminalOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<rect
		x="2.75"
		y="2.75"
		width="12.5"
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
		x1="9.75"
		y1="12.25"
		x2="12.25"
		y2="12.25"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
		data-color="color-2"
	/>
	<polyline
		points="5.75 12.25 8.25 9.75 5.75 7.25"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
		data-color="color-2"
	/>
</IconRoot>
