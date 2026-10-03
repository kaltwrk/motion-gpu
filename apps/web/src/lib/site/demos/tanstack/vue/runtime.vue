<script setup lang="ts">
import { useFrame, usePointer } from 'spektral/vue';

const START_TIME = 0;
const END_TIME = 24;
const FOLLOW_STRENGTH = 10;

let targetTimeOfDay = 12;
let timeOfDay = targetTimeOfDay;

usePointer({
	onMove: (state) => {
		if (!state.inside) {
			return;
		}

		const horizontalPosition = Math.max(0, Math.min(1, state.uv[0]));
		targetTimeOfDay = START_TIME + horizontalPosition * (END_TIME - START_TIME);
	}
});

useFrame((frame) => {
	const smoothing = 1 - Math.exp(-FOLLOW_STRENGTH * frame.delta);
	timeOfDay += (targetTimeOfDay - timeOfDay) * smoothing;
	frame.setUniform('uTimeOfDay', timeOfDay);
});
</script>
