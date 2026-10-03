<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconSidebarLeftOutline18.js
Original name: IconSidebarLeftOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<line
		x1="6.25"
		y1="2.75"
		x2="6.25"
		y2="15.25"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
		data-color="color-2"
	/>
	<rect
		x="1.75"
		y="2.75"
		width="14.5"
		height="12.5"
		rx="2"
		ry="2"
		transform="translate(18 18) rotate(180)"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
	/>
</IconRoot>
