import { describe, expect, it } from 'vitest';
import { parse } from 'acorn';
import { resolveMaterial } from 'spektral';
import { strip_types } from '$lib/playground-engine/workers/typescript-strip-types';
import { createKineticScene } from '$lib/site/demos/kinetic-array/material';
import { createKineticLighting } from '$lib/site/demos/kinetic-array/lighting';
import lightingSource from '$lib/site/demos/kinetic-array/lighting.ts?raw';
import materialSource from '$lib/site/demos/kinetic-array/material.ts?raw';
import simulationSource from '$lib/site/demos/kinetic-array/simulation.ts?raw';

describe('Kinetic Array lighting', () => {
	it('keeps the real modules executable after the playground removes TypeScript', () => {
		// Type checking accepts parenthesized arrow-object assertions that the
		// playground stripper cannot yet remove without breaking JavaScript.
		for (const source of [lightingSource, materialSource, simulationSource]) {
			expect(() =>
				parse(strip_types(source), { ecmaVersion: 'latest', sourceType: 'module' })
			).not.toThrow();
		}
	});

	it('publishes current-state caches with one writer per sampled texture', () => {
		const { material, passes } = createKineticScene();
		const resolved = resolveMaterial(material);
		const lighting = createKineticLighting(material.defines);
		const writtenTextures = new Set<string>();
		for (const pass of lighting.passes) {
			const resources = pass.getResources();
			expect(resources.pinState).toEqual({
				buffer: 'pinState',
				access: 'storage-read',
				version: 'current'
			});
			const output = resources.lighting;
			if (!output || !('texture' in output) || typeof output.texture !== 'string') {
				throw new Error('A lighting pass must write a material texture.');
			}
			expect(output.access).toBe('storage-write');
			expect(writtenTextures.has(output.texture)).toBe(false);
			writtenTextures.add(output.texture);
			expect(resolved.textures[output.texture as keyof typeof resolved.textures]).toMatchObject({
				storage: true,
				format: 'rgba16float'
			});
			expect(pass.getCompute().startsWith(`${resolved.defineBlockSource}\n\n`)).toBe(true);
		}
		expect([...writtenTextures].sort()).toEqual([...resolved.textureKeys].sort());
		expect(resolved.fragmentWgsl).not.toContain('#include');
		expect(passes.slice(2, 5).map((pass) => pass.label)).toEqual(
			lighting.passes.map((pass) => pass.label)
		);
	});

	it('dispatches complete atlases independently of framebuffer dimensions', () => {
		const { material } = createKineticScene();
		const { passes, textures } = createKineticLighting(material.defines);
		for (const [width, height] of [
			[1, 1],
			[736, 1255],
			[3840, 2160],
			[8192, 128],
			[128, 8192]
		]) {
			const context = {
				width: width!,
				height: height!,
				time: 0,
				delta: 1 / 60,
				workgroupSize: [8, 8, 1] as [number, number, number]
			};
			for (const [index, texture] of [textures.uPinLighting, textures.uDeckLighting].entries()) {
				const [x, y] = passes[index]!.resolveDispatch(context);
				expect(x * 8).toBeGreaterThanOrEqual(texture.width);
				expect(y * 8).toBeGreaterThanOrEqual(texture.height);
				expect(x * 8).toBeLessThan(texture.width + 8);
				expect(y * 8).toBeLessThan(texture.height + 8);
			}
			const [x, y, z] = passes[2]!.resolveDispatch(context);
			expect([x, y, z].every((value) => Number.isInteger(value) && value > 0)).toBe(true);
			expect(x * 8).toBeLessThanOrEqual(textures.uFloorLighting.width + 8);
			expect(y * 8).toBeLessThanOrEqual(textures.uFloorLighting.height + 8);
			// The fixed allocation can be larger than the active floor region.
			// Round-up workgroups and the f32 guard row must not approach a full
			// framebuffer dispatch even for extreme aspect ratios.
			expect(x * y * 64).toBeLessThan(80_000);
		}
	});
});
