import type { RenderMode } from '../../src/lib/core/types.js';

export interface RuntimeControls {
	setRenderMode: (mode: RenderMode) => void;
	invalidate: () => void;
	advance: () => void;
	setTaskActive: (active: boolean) => void;
}
