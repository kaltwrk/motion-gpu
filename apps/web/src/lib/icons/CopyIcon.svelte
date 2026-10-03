<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconTasks2Outline18.js MODIFIED
Original name: IconTasks2Outline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>

	<path
		d="M13.75 5.25H7.25C6.145 5.25 5.25 6.145 5.25 7.25V13.75C5.25 14.855 6.145 15.75 7.25 15.75H13.75C14.855 15.75 15.75 14.855 15.75 13.75V7.25C15.75 6.145 14.855 5.25 13.75 5.25Z"
		stroke="currentColor"
		stroke-width={strokeWidth}
		stroke-linecap="round"
		stroke-linejoin="round"
		fill="none"
	/>
	<path
		d="M12.4012 2.74996C12.0022 2.06146 11.2151 1.64841 10.38 1.77291L3.45602 2.80196C2.36402 2.96386 1.61003 3.98093 1.77203 5.07393L2.75002 11.6547"
		stroke="currentColor"
		stroke-width={strokeWidth}
		stroke-linecap="round"
		stroke-linejoin="round"
		data-color="color-2"
		fill="none"
	/>
</IconRoot>
