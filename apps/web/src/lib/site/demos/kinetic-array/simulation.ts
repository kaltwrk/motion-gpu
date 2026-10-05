import { ComputePass, type MaterialDefines, type StorageBufferDefinitionMap } from 'spektral';
import forcesShader from './shaders/forces.wgsl?raw';
import integrateShader from './shaders/integrate.wgsl?raw';

export const GRID_COLUMNS = 17;
export const GRID_ROWS = 13;
export const GRID_PITCH = 0.145;
export const PIN_COUNT = GRID_COLUMNS * GRID_ROWS;
export const PIN_REST_HEIGHT = 0.64;
export const MIN_DISPLACEMENT = -0.27;
export const MAX_DISPLACEMENT = 0.28;
export const MAX_SIMULATION_STEP = 1 / 30;

export const KINETIC_DYNAMICS = Object.freeze({
	restStiffness: 18,
	neighborStiffness: 60,
	damping: 1.8,
	pressGain: 10,
	pressRadius: 0.32,
	impulseGain: 1.15,
	impulseRadius: 0.2
});

export function withSimulationConstants(
	shader: string,
	constants: Readonly<MaterialDefines>
): string {
	// Material defines are injected into fragment shaders only. ComputePass
	// receives complete WGSL, so publish the same numeric constants explicitly.
	const declarations = Object.keys(constants)
		.sort()
		.map((name) => {
			const constant = constants[name]!;
			const float = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`);
			if (typeof constant === 'boolean') return `const ${name}: bool = ${constant};`;
			if (typeof constant === 'number') return `const ${name}: f32 = ${float(constant)};`;
			if (constant.type === 'bool') return `const ${name}: bool = ${constant.value};`;
			if (typeof constant.value === 'number') {
				const literal =
					constant.type === 'f32'
						? float(constant.value)
						: `${constant.value}${constant.type === 'u32' ? 'u' : 'i'}`;
				return `const ${name}: ${constant.type} = ${literal};`;
			}
			return `const ${name}: ${constant.type} = ${constant.type}(${constant.value.map(float).join(', ')});`;
		});
	return `${declarations.join('\n')}\n\n${shader}`;
}

/** A single initial disturbance. With no input the array returns to rest. */
export function createInitialPinState(): Float32Array {
	const state = new Float32Array(PIN_COUNT * 4);
	for (let row = 0; row < GRID_ROWS; row += 1) {
		for (let column = 0; column < GRID_COLUMNS; column += 1) {
			const x = (column - (GRID_COLUMNS - 1) * 0.5) * GRID_PITCH;
			const z = (row - (GRID_ROWS - 1) * 0.5) * GRID_PITCH;
			const envelope = Math.exp(-(x * x + z * z) / 1.65);
			const displacement = 0.18 * Math.cos(x * 2.3 - z * 1.7) * envelope;
			state[(row * GRID_COLUMNS + column) * 4] = displacement;
		}
	}
	return state;
}

export function createKineticSimulation() {
	const storageBuffers = {
		// x: displacement, y: velocity, z: local pressure, w: reserved.
		pinState: {
			size: PIN_COUNT * 16,
			type: 'array<vec4f>',
			access: 'read-write',
			initialData: createInitialPinState()
		},
		// x: driving force, y: stiffness, z: velocity impulse, w: pressure.
		pinForces: { size: PIN_COUNT * 16, type: 'array<vec4f>', access: 'read-write' },
		// CPU writes [worldX, worldZ, pressure, one-frame impulse].
		interaction: {
			size: 16,
			type: 'array<vec4f>',
			access: 'read',
			initialData: new Float32Array(4)
		}
	} satisfies StorageBufferDefinitionMap;

	const defines = {
		GRID_COLUMNS: { type: 'u32', value: GRID_COLUMNS },
		GRID_ROWS: { type: 'u32', value: GRID_ROWS },
		GRID_PITCH,
		PIN_COUNT: { type: 'u32', value: PIN_COUNT },
		PIN_REST_HEIGHT,
		MIN_DISPLACEMENT,
		MAX_DISPLACEMENT,
		MAX_SIMULATION_STEP,
		REST_STIFFNESS: KINETIC_DYNAMICS.restStiffness,
		NEIGHBOR_STIFFNESS: KINETIC_DYNAMICS.neighborStiffness,
		DAMPING: KINETIC_DYNAMICS.damping,
		PRESS_GAIN: KINETIC_DYNAMICS.pressGain,
		PRESS_RADIUS: KINETIC_DYNAMICS.pressRadius,
		IMPULSE_GAIN: KINETIC_DYNAMICS.impulseGain,
		IMPULSE_RADIUS: KINETIC_DYNAMICS.impulseRadius
	} satisfies MaterialDefines;

	const forces = new ComputePass({
		label: 'Read initial pin positions and evaluate forces',
		compute: withSimulationConstants(forcesShader, defines),
		dispatch: [Math.ceil(PIN_COUNT / 64)],
		resources: {
			pinState: { buffer: 'pinState', access: 'storage-read', version: 'initial' },
			interaction: { buffer: 'interaction', access: 'storage-read' },
			pinForces: { buffer: 'pinForces', access: 'storage-read-write' }
		}
	});
	const integrate = new ComputePass({
		label: 'Integrate pin positions from current forces',
		compute: withSimulationConstants(integrateShader, defines),
		dispatch: [Math.ceil(PIN_COUNT / 64)],
		resources: {
			pinForces: { buffer: 'pinForces', access: 'storage-read', version: 'current' },
			pinState: { buffer: 'pinState', access: 'storage-read-write' }
		}
	});

	// initial pinState -> forces -> current pinForces -> integrate -> scene.
	// Each integration invocation reads and writes only its own pinState element.
	return { storageBuffers, defines, passes: [forces, integrate] };
}
