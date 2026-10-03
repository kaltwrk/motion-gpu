<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconArrowRotateClockwiseOutline18.js
Original name: IconArrowRotateClockwiseOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<path
		d="M15,13.071c-1.304,1.919-3.505,3.179-6,3.179-4.004,0-7.25-3.246-7.25-7.25S4.996,1.75,9,1.75c3.031,0,5.627,1.86,6.71,4.5"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
		data-color="color-2"
	/>
	<polyline
		points="16.12 3.305 15.712 6.25 12.768 5.843"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
	/>
</IconRoot>
