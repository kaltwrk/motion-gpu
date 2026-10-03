<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconDarkLightOutline18.js
Original name: IconDarkLightOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';

	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
	<path
		d="M9,6v6c1.657,0,3-1.343,3-3s-1.343-3-3-3Z"
		fill="currentColor"
		data-color="color-2"
		data-stroke="none"
	/>
	<path
		d="M9,12c-1.657,0-3-1.343-3-3s1.343-3,3-3V1.75C4.996,1.75,1.75,4.996,1.75,9s3.246,7.25,7.25,7.25v-4.25Z"
		fill="currentColor"
		data-color="color-2"
		data-stroke="none"
	/>
	<circle
		cx="9"
		cy="9"
		r="7.25"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width={strokeWidth}
	/>
</IconRoot>
