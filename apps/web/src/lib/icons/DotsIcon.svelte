<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconDotsOutline18.js
Original name: IconDotsOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<circle
		cx="9"
		cy="9"
		r=".5"
		fill="currentColor"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
		data-color="color-2"
	/>
	<circle
		cx="3.25"
		cy="9"
		r=".5"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
		fill="currentColor"
	/>
	<circle
		cx="14.75"
		cy="9"
		r=".5"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
		fill="currentColor"
	/>
</IconRoot>
