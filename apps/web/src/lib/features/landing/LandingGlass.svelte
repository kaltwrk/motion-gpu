<script lang="ts">
	import { glassGradient } from './glass-gradient';
</script>

<!-- The original landing used static glass optics (waveAmplitude: 0).
     Render only on resize/theme changes; there is no autoplay or frame loop. -->
<div class="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
	<div
		class="absolute inset-0 bg-radial-[ellipse_at_50%_75%] from-primary/10 via-transparent to-transparent"
	></div>
	<canvas {@attach glassGradient} class="absolute inset-0 size-full opacity-25 dark:opacity-35"
	></canvas>
</div>
