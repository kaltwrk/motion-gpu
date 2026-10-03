import { describe, expect, it } from 'vitest';
import { getPlaygroundDemoVariant, type PlaygroundFramework } from './playground-demos';

describe('data-mosh playground demo', () => {
	it.each<PlaygroundFramework>(['svelte', 'react', 'vue'])(
		'uses an origin-clean blob video in the %s runtime',
		(framework) => {
			const variant = getPlaygroundDemoVariant('data-mosh', framework);
			const runtimeSource = variant?.runtimeSource;
			const videoSource = variant?.additionalFiles['video-source.ts'];
			expect(runtimeSource).toBeDefined();
			expect(videoSource).toBeDefined();

			expect(runtimeSource).toContain("from './video-source'");
			const fetchCall = videoSource?.indexOf('await fetch(source.src') ?? -1;
			const blobUrlCreation = videoSource?.indexOf('URL.createObjectURL(blob)') ?? -1;
			const sourceAssignment = videoSource?.indexOf('video.src = candidateObjectUrl') ?? -1;
			expect(fetchCall).toBeGreaterThanOrEqual(0);
			expect(blobUrlCreation).toBeGreaterThan(fetchCall);
			expect(sourceAssignment).toBeGreaterThan(blobUrlCreation);
		}
	);
});
