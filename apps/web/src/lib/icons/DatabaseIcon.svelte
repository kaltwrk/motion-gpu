<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconDatabaseOutline18.js
Original name: IconDatabaseOutline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';
	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
<ellipse cx="9" cy="4.25" rx="6.25" ry="2.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} />
<path d="M2.75,4.25V13.75c0,1.243,2.798,2.25,6.25,2.25s6.25-1.007,6.25-2.25V4.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} />
<path d="M2.75,9c0,1.243,2.798,2.25,6.25,2.25s6.25-1.007,6.25-2.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} />
</IconRoot>
