import { describe, expect, it } from 'vitest';
import { relocateDemoImports } from './playground-source-paths';

const paths = new Map([
	['/site/demos/fluid/svelte/App.svelte', '/src/App.svelte'],
	['/site/demos/fluid/material.ts', '/src/material.ts'],
	['/site/demos/fluid/shaders/fragment.wgsl', '/src/shaders/fragment.wgsl'],
	['/site/demo-shared/studio.wgsl', '/src/shared/studio.wgsl'],
	['/site/demo-shared/camera.ts', '/src/shared/camera.ts']
]);

describe('playground source relocation', () => {
	it('keeps a flattened framework entry connected to its material and leaves packages alone', () => {
		const source = `import { FragCanvas } from 'spektral/svelte';\nimport { scene } from '../material';`;
		expect(relocateDemoImports(source, '/site/demos/fluid/svelte/App.svelte', paths)).toBe(
			`import { FragCanvas } from 'spektral/svelte';\nimport { scene } from './material.ts';`
		);
	});

	it('preserves raw shader queries and connects shared studio imports to their editor copies', () => {
		const source = `import studio from '../../demo-shared/studio.wgsl?raw';\nimport shader from './shaders/fragment.wgsl?raw';\nexport { camera } from '../../demo-shared/camera';`;
		expect(relocateDemoImports(source, '/site/demos/fluid/material.ts', paths)).toBe(
			`import studio from './shared/studio.wgsl?raw';\nimport shader from './shaders/fragment.wgsl?raw';\nexport { camera } from './shared/camera.ts';`
		);
	});

	it('relocates dynamic and side-effect imports without changing unresolved paths', () => {
		const source = `const camera = import('../../demo-shared/camera');\nimport '../../demo-shared/studio.wgsl';\nimport './local.css';`;
		expect(relocateDemoImports(source, '/site/demos/fluid/material.ts', paths)).toBe(
			`const camera = import('./shared/camera.ts');\nimport './shared/studio.wgsl';\nimport './local.css';`
		);
	});
});
