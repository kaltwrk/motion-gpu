import { describe, expect, it } from 'vitest';
import { defineMaterial, resolveMaterial } from 'spektral';
import {
	createInitialPinState,
	createKineticSimulation,
	GRID_COLUMNS,
	GRID_ROWS,
	KINETIC_DYNAMICS,
	MAX_DISPLACEMENT,
	MAX_SIMULATION_STEP,
	MIN_DISPLACEMENT,
	PIN_COUNT
} from '$lib/site/demos/kinetic-array/simulation';

describe('Kinetic Array simulation', () => {
	it('starts from a broad bounded disturbance with no initial velocity', () => {
		const state = createInitialPinState();
		expect(state.byteLength).toBe(PIN_COUNT * 16);
		let highest = -Infinity;
		let lowest = Infinity;
		for (let index = 0; index < PIN_COUNT; index += 1) {
			const height = state[index * 4]!;
			highest = Math.max(highest, height);
			lowest = Math.min(lowest, height);
			expect(Number.isFinite(height)).toBe(true);
			expect(height).toBeGreaterThan(MIN_DISPLACEMENT);
			expect(height).toBeLessThan(MAX_DISPLACEMENT);
			expect(state[index * 4 + 1]).toBe(0);
			if ((index % GRID_COLUMNS) + 1 < GRID_COLUMNS) {
				expect(Math.abs(height - state[(index + 1) * 4]!)).toBeLessThan(0.08);
			}
			if (index + GRID_COLUMNS < PIN_COUNT) {
				expect(Math.abs(height - state[(index + GRID_COLUMNS) * 4]!)).toBeLessThan(0.08);
			}
		}
		expect(highest).toBeGreaterThan(0.15);
		expect(lowest).toBeLessThan(0);
	});

	it('declares both buffer dependencies in the same direction, without an in-place neighbor update', () => {
		const { passes } = createKineticSimulation();
		expect(passes).toHaveLength(2);
		const forceResources = passes[0]!.getResources();
		const integrationResources = passes[1]!.getResources();
		// The initial state read precedes its writer. Current forces follow theirs.
		// Omitting initial here would introduce the reverse edge and a graph cycle.
		expect(forceResources).toEqual({
			pinState: { buffer: 'pinState', access: 'storage-read', version: 'initial' },
			interaction: { buffer: 'interaction', access: 'storage-read' },
			pinForces: { buffer: 'pinForces', access: 'storage-read-write' }
		});
		expect(integrationResources).toEqual({
			pinForces: { buffer: 'pinForces', access: 'storage-read', version: 'current' },
			pinState: { buffer: 'pinState', access: 'storage-read-write' }
		});
	});

	it('dispatches the complete pin array independently of canvas dimensions', () => {
		const { passes } = createKineticSimulation();
		for (const pass of passes) {
			const workgroupSize = pass.getWorkgroupSize();
			for (const [width, height] of [
				[1, 1],
				[390, 844],
				[3840, 2160]
			]) {
				const dispatch = pass.resolveDispatch({
					width: width!,
					height: height!,
					time: 0,
					delta: 1 / 60,
					workgroupSize
				});
				expect(dispatch[0] * workgroupSize[0]).toBeGreaterThanOrEqual(PIN_COUNT);
				expect((dispatch[0] - 1) * workgroupSize[0]).toBeLessThan(PIN_COUNT);
				expect(dispatch.slice(1)).toEqual([1, 1]);
			}
		}
	});

	it('explicitly gives both compute shaders the same typed constants as the material', () => {
		const { defines, passes } = createKineticSimulation();
		const resolved = resolveMaterial(
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				defines
			})
		);
		// Compare against the public material resolver instead of reproducing
		// our WGSL serializer. Material defines do not propagate to ComputePass.
		expect(resolved.defineBlockSource).toContain('const PIN_COUNT: u32 = 221u;');
		for (const pass of passes) {
			const compute = pass.getCompute();
			expect(compute.startsWith(`${resolved.defineBlockSource}\n\n`)).toBe(true);
			for (const declaration of resolved.defineBlockSource.split('\n')) {
				expect(compute.split(declaration)).toHaveLength(2);
			}
		}
	});

	it('creates independent resource data accepted by the public material API', () => {
		const first = createKineticSimulation();
		const second = createKineticSimulation();
		first.storageBuffers.pinState.initialData[0] = 99;
		expect(second.storageBuffers.pinState.initialData[0]).not.toBe(99);
		expect(second.storageBuffers.pinState.size).toBe(PIN_COUNT * 16);
		expect(second.storageBuffers.pinForces.size).toBe(PIN_COUNT * 16);
		expect(second.storageBuffers.interaction.initialData).toEqual(new Float32Array(4));
		expect(() =>
			resolveMaterial(
				defineMaterial({
					fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
					storageBuffers: second.storageBuffers,
					defines: second.defines,
					uniforms: { uStep: 1 / 60 }
				})
			)
		).not.toThrow();
	});

	it('keeps every free-boundary lattice mode inside the damped stability region', () => {
		// Analyze the exact spectrum of the grid Laplacian rather than copying
		// the per-pin WGSL update. This includes high-frequency checkerboard modes
		// that an attractive smooth startup state would never exercise.
		const { restStiffness, neighborStiffness, damping } = KINETIC_DYNAMICS;
		for (const dt of [1 / 240, 1 / 120, 1 / 60, MAX_SIMULATION_STEP]) {
			const decay = Math.exp(-damping * dt);
			for (let rowMode = 0; rowMode < GRID_ROWS; rowMode += 1) {
				for (let columnMode = 0; columnMode < GRID_COLUMNS; columnMode += 1) {
					const laplacianEigenvalue =
						4 -
						2 * Math.cos((Math.PI * rowMode) / GRID_ROWS) -
						2 * Math.cos((Math.PI * columnMode) / GRID_COLUMNS);
					const stiffness = restStiffness + neighborStiffness * laplacianEigenvalue;
					const trace = 1 + decay - decay * dt * dt * stiffness;
					const discriminant = trace * trace - 4 * decay;
					const spectralRadius =
						discriminant < 0 ? Math.sqrt(decay) : (Math.abs(trace) + Math.sqrt(discriminant)) / 2;
					expect(spectralRadius).toBeLessThan(1);
					// Six seconds without forcing reduces each mode to below 1%.
					expect(spectralRadius ** (6 / dt)).toBeLessThan(0.01);
				}
			}
		}
	});
});
