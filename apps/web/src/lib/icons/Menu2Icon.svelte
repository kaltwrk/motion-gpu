<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), dist/components/IconMenu2Outline18.js
Original name: IconMenu2Outline18
https://www.npmjs.com/package/nucleo-ui-outline-18/v/1.5.1
-->
<script lang="ts">
	import IconRoot from './IconRoot.svelte';
	import type { IconProps } from './types';
	let { strokeWidth = 1.5, ...props }: IconProps = $props();
</script>

<IconRoot {...props}>
<line x1="1.75" y1="5.75" x2="16.25" y2="5.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} />
<line x1="1.75" y1="12.25" x2="16.25" y2="12.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width={strokeWidth} data-color="color-2" />
</IconRoot>
