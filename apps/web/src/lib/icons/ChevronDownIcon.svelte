<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconChevronDownOutline18.js
Original name: IconChevronDownOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<polyline
		points="15.25 6.5 9 12.75 2.75 6.5"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
	/>
</IconRoot>
