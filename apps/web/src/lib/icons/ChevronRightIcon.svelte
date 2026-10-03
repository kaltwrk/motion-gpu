<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconChevronRightOutline18.js
Original name: IconChevronRightOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<polyline
		points="6.5 2.75 12.75 9 6.5 15.25"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
	/>
</IconRoot>
