<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconTableRowsOutline18.js
Original name: IconTableRowsOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<line
		x1="15.25"
		y1="9"
		x2="2.75"
		y2="9"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
		data-color="color-2"
	/>
	<rect
		x="2.75"
		y="2.75"
		width="12.5"
		height="12.5"
		rx="2"
		ry="2"
		transform="translate(18) rotate(90)"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
	/>
</IconRoot>
