import { ComputePass, type MaterialDefines, type TextureDefinitionMap } from 'spektral';
import studioShader from '../../demo-shared/studio.wgsl?raw';
import geometryShader from './shaders/geometry.wgsl?raw';
import layoutShader from './shaders/lighting-layout.wgsl?raw';
import pinShader from './shaders/pin-lighting.wgsl?raw';
import deckShader from './shaders/deck-lighting.wgsl?raw';
import floorShader from './shaders/floor-lighting.wgsl?raw';
import { GRID_COLUMNS, GRID_ROWS, withSimulationConstants } from './simulation';

export const kineticLightingDefines = {
	PIN_LIGHTING_COLUMNS: { type: 'u32', value: GRID_COLUMNS },
	PIN_LIGHTING_ROWS: { type: 'u32', value: GRID_ROWS },
	PIN_LIGHTING_TILE_WIDTH: { type: 'u32', value: 16 },
	PIN_LIGHTING_TILE_HEIGHT: { type: 'u32', value: 32 },
	PIN_LIGHTING_TOP_SIZE: { type: 'u32', value: 12 },
	PIN_LIGHTING_TOP_RADIUS: 0.0575,
	DECK_LIGHTING_WIDTH: { type: 'u32', value: 256 },
	DECK_LIGHTING_HEIGHT: { type: 'u32', value: 208 },
	DECK_LIGHTING_HALF_X: 1.325,
	DECK_LIGHTING_HALF_Z: 1.045,
	DECK_LIGHTING_Y: 0.294,
	FLOOR_LIGHTING_CAPACITY: { type: 'u32', value: 512 },
	FLOOR_LIGHTING_BUDGET: 65536
} satisfies MaterialDefines;

export function createKineticLighting(defines: Readonly<MaterialDefines>) {
	const constants = { ...defines, ...kineticLightingDefines };
	const preamble = `${studioShader}\n${geometryShader}\n${layoutShader}`;
	const shader = (kernel: string) => withSimulationConstants(`${preamble}\n${kernel}`, constants);
	function texture(width: number, height: number) {
		return {
			storage: true,
			format: 'rgba16float',
			width,
			height,
			filter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		} as const;
	}
	const textures = {
		uPinLighting: texture(GRID_COLUMNS * 16, GRID_ROWS * 32),
		uDeckLighting: texture(256, 208),
		uFloorLighting: texture(512, 512)
	} satisfies TextureDefinitionMap;
	const pinState = { buffer: 'pinState', access: 'storage-read', version: 'current' } as const;
	const pins = new ComputePass({
		label: 'Cache current pin surface visibility',
		compute: shader(pinShader),
		resources: {
			pinState,
			lighting: { texture: 'uPinLighting', access: 'storage-write' }
		},
		dispatch: [Math.ceil((GRID_COLUMNS * 16) / 8), Math.ceil((GRID_ROWS * 32) / 8)]
	});
	const deck = new ComputePass({
		label: 'Cache current deck visibility',
		compute: shader(deckShader),
		resources: {
			pinState,
			lighting: { texture: 'uDeckLighting', access: 'storage-write' }
		},
		dispatch: [32, 26]
	});
	const floor = new ComputePass({
		label: 'Cache studio floor visibility',
		compute: shader(floorShader),
		resources: {
			pinState,
			lighting: { texture: 'uFloorLighting', access: 'storage-write' }
		},
		dispatch: ({ width, height }) => {
			const scale = Math.min(0.5, 512 / width, 512 / height, Math.sqrt(65536 / (width * height)));
			// One guard texel covers f32 rounding in the matching WGSL size calculation.
			return [
				Math.ceil((Math.max(1, Math.floor(width * scale)) + 1) / 8),
				Math.ceil((Math.max(1, Math.floor(height * scale)) + 1) / 8),
				1
			];
		}
	});
	return { textures, passes: [pins, deck, floor] };
}
