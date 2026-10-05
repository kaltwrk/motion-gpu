<script lang="ts">
	import { useFrame, usePointer } from 'spektral/svelte';
	import { createKineticInteraction } from '../interaction';

	const interaction = createKineticInteraction();
	const pointer = usePointer(interaction.pointerOptions);
	useFrame((frame) => interaction.update(frame, pointer.state.current), { autoInvalidate: false });
</script>
