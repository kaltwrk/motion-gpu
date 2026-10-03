<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconChevronExpandYOutline18.js
Original name: IconChevronExpandYOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';
	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<polyline points="12.5 6.25 9 2.75 5.5 6.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} />
	<polyline points="12.5 11.75 9 15.25 5.5 11.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} data-color="color-2" />
</IconRoot>
