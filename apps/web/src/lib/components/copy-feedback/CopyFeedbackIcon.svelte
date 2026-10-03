<!--
Source: nucleo-ui-outline-18@1.5.1 (npm), via $lib/icons/CheckIcon.svelte
Original name: IconCheckOutline18. The caller supplies the idle icon and its provenance.
-->
<script lang="ts">
	import { IconTransition } from '$lib/components/icon-transition';
	import { CheckIcon, type IconComponent } from '$lib/icons';

	type Props = {
		copied: boolean;
		idleIcon: IconComponent;
	};

	let { copied, idleIcon }: Props = $props();
</script>

<IconTransition
	active={copied}
	inactiveIcon={idleIcon}
	activeIcon={CheckIcon}
	activeClass="text-emerald-500"
/>
