<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconGrid2x2Outline18.js
Original name: IconGrid2x2Outline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';
	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
<line x1="15.75" y1="9" x2="2.25" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} data-color="color-2" />
<line x1="9" y1="15.75" x2="9" y2="2.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} />
</IconRoot>
