import { describe, expect, it, vi } from 'vitest';
import { posix } from 'node:path';

vi.mock('./playground-pages', () => ({
	getPlaygroundPages: () => [{ id: 'ferrofluid', title: 'Ferrofluid', slug: 'ferrofluid' }]
}));

import { getPlaygroundDemoVariant } from './playground-demos';

describe('shared studio in playground demos', () => {
	for (const framework of ['svelte', 'react', 'vue'] as const) {
		it(`includes a self-contained source tree for ${framework}`, () => {
			const variant = getPlaygroundDemoVariant('ferrofluid', framework)!;
			const appName = framework === 'react' ? 'App.tsx' : `App.${framework}`;
			const runtimeName = framework === 'react' ? 'runtime.tsx' : `runtime.${framework}`;
			const sources = {
				[appName]: variant.appSource,
				[runtimeName]: variant.runtimeSource!,
				...variant.additionalFiles
			};
			expect(Object.keys(sources)).toEqual(
				expect.arrayContaining([
					'shared/camera.ts',
					'shared/studio.wgsl',
					'shared/presentation.ts',
					'shared/presentation.wgsl',
					'shaders/fragment.wgsl',
					'shaders/simulate.wgsl'
				])
			);
			for (const [file, source] of Object.entries(sources)) {
				for (const match of source.matchAll(/\bfrom\s*['"](\.[^'"\n]+)['"]/g)) {
					const imported = match[1]!.split('?')[0]!;
					const resolved = posix.normalize(posix.join(posix.dirname(file), imported));
					expect(sources, `${file} imports missing ${resolved}`).toHaveProperty(resolved);
				}
			}
		});
	}
});
