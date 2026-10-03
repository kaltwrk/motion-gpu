<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconArrowLeftOutline18.js
Original name: IconArrowLeftOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<line
		x1="2.75"
		y1="9"
		x2="15.25"
		y2="9"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
		data-color="color-2"
	/>
	<polyline
		points="7 13.25 2.75 9 7 4.75"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
	/>
</IconRoot>
