<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconCircleWarningOutline18.js
Original name: IconCircleWarningOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<path
		d="M9 16.25C13.0041 16.25 16.25 13.004 16.25 9C16.25 4.996 13.0041 1.75 9 1.75C4.9959 1.75 1.75 4.996 1.75 9C1.75 13.004 4.9959 16.25 9 16.25Z"
		stroke="currentColor"
		stroke-width={strokeWidth}
		stroke-linecap="round"
		stroke-linejoin="round"
		fill="none"
	/>
	<path
		d="M9 5.431V9.5"
		stroke="currentColor"
		stroke-width={strokeWidth}
		stroke-linecap="round"
		stroke-linejoin="round"
		data-color="color-2"
		fill="none"
	/>
	<path
		d="M9 13.417C8.448 13.417 8 12.968 8 12.417C8 11.866 8.448 11.417 9 11.417C9.552 11.417 10 11.866 10 12.417C10 12.968 9.552 13.417 9 13.417Z"
		fill="currentColor"
		data-color="color-2"
		data-stroke="none"
	/>
</IconRoot>
