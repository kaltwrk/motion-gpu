import { describe, expect, it, vi } from 'vitest';
import {
	applyMaterialDefines,
	buildDefinesBlock,
	defineMaterial,
	hasSameStorageBufferInitialData,
	resolveMaterial
} from '../../lib/core/material';
import type { StorageBufferDefinition, TypedUniform } from '../../lib/core/types';

function assertType<T>(value: T): void {
	void value;
}

describe('material', () => {
	function withMockedStack<T>(stack: string, run: () => T): T {
		const OriginalError = globalThis.Error;
		class MockError extends OriginalError {
			constructor(message?: string) {
				super(message);
				this.stack = stack;
			}
		}

		vi.stubGlobal('Error', MockError);
		try {
			return run();
		} finally {
			vi.unstubAllGlobals();
		}
	}

	it('creates immutable material snapshots with normalized defaults', () => {
		const input = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			uniforms: { uMix: 0.5 },
			defines: { USE_MIX: true }
		});

		expect(input.uniforms).toEqual({ uMix: 0.5 });
		expect(input.textures).toEqual({});
		expect(input.defines).toEqual({ USE_MIX: true });
		expect(Object.isFrozen(input)).toBe(true);
		expect(Object.isFrozen(input.uniforms)).toBe(true);
		expect(Object.isFrozen(input.textures)).toBe(true);
		expect(Object.isFrozen(input.defines)).toBe(true);
	});

	it('preserves uniform and texture key unions on defined materials', () => {
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			uniforms: { uMix: 0.5 },
			textures: { uMain: {} }
		});

		type UniformKeys = keyof typeof material.uniforms;
		type TextureKeys = keyof typeof material.textures;

		const uniformKey: UniformKeys = 'uMix';
		const textureKey: TextureKeys = 'uMain';
		expect(uniformKey).toBe('uMix');
		expect(textureKey).toBe('uMain');
		expect(material.uniforms.uMix).toBe(0.5);
		expect(material.textures.uMain).toEqual({});

		// @ts-expect-error unknown uniform key should not be allowed
		assertType<UniformKeys>('uOther');
		// @ts-expect-error unknown texture key should not be allowed
		assertType<TextureKeys>('uOther');
	});

	it('clones mutable uniform and texture inputs to avoid external mutation side effects', () => {
		const matrix = new Float32Array(16);
		matrix[0] = 1;
		const tint: [number, number, number, number] = [1, 0.5, 0.25, 1];
		const canvas = document.createElement('canvas');
		canvas.width = 16;
		canvas.height = 8;
		const texturePayload: {
			source: HTMLCanvasElement;
			width: number;
			height: number;
			colorSpace: 'srgb' | 'linear';
			flipY: boolean;
			premultipliedAlpha: boolean;
			generateMipmaps: boolean;
			update: 'once' | 'onInvalidate' | 'perFrame';
		} = {
			source: canvas,
			width: 16,
			height: 8,
			colorSpace: 'linear',
			flipY: false,
			premultipliedAlpha: true,
			generateMipmaps: true,
			update: 'onInvalidate'
		};
		const textureDefinition: {
			source: typeof texturePayload;
			filter: GPUFilterMode;
			addressModeU: GPUAddressMode;
		} = {
			source: texturePayload,
			filter: 'linear',
			addressModeU: 'repeat'
		};
		const transform: { type: 'mat4x4f'; value: Float32Array } = {
			type: 'mat4x4f',
			value: matrix
		};
		const uniforms = { uTint: tint, uTransform: transform };
		const textures = { uMain: textureDefinition };

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			uniforms,
			textures
		});

		tint[0] = 0;
		matrix[0] = 9;
		texturePayload.width = 2;
		texturePayload.colorSpace = 'srgb';
		texturePayload.flipY = true;
		texturePayload.premultipliedAlpha = false;
		texturePayload.generateMipmaps = false;
		texturePayload.update = 'once';
		textureDefinition.filter = 'nearest';
		textureDefinition.addressModeU = 'clamp-to-edge';
		transform.value = new Float32Array(16).fill(12);
		uniforms.uTint = [9, 9, 9, 9];
		textures.uMain = {
			...textureDefinition,
			source: { ...texturePayload, width: 4 }
		};

		expect(material.uniforms.uTint).toEqual([1, 0.5, 0.25, 1]);
		expect(
			(material.uniforms.uTransform as { type: 'mat4x4f'; value: Float32Array }).value[0]
		).toBe(1);
		expect(
			(material.textures.uMain?.source as { source: HTMLCanvasElement; width?: number }).width
		).toBe(16);
		expect(
			(
				material.textures.uMain?.source as {
					colorSpace?: 'srgb' | 'linear';
					flipY?: boolean;
					premultipliedAlpha?: boolean;
					generateMipmaps?: boolean;
					update?: 'once' | 'onInvalidate' | 'perFrame';
				}
			).colorSpace
		).toBe('linear');
		expect(
			(material.textures.uMain?.source as { flipY?: boolean; premultipliedAlpha?: boolean }).flipY
		).toBe(false);
		expect(
			(material.textures.uMain?.source as { premultipliedAlpha?: boolean }).premultipliedAlpha
		).toBe(true);
		expect((material.textures.uMain?.source as { generateMipmaps?: boolean }).generateMipmaps).toBe(
			true
		);
		expect((material.textures.uMain?.source as { update?: string }).update).toBe('onInvalidate');
		expect(material.textures.uMain?.filter).toBe('linear');
		expect(material.textures.uMain?.addressModeU).toBe('repeat');

		const storedTint = material.uniforms.uTint as readonly number[];
		const storedTransform = material.uniforms.uTransform as TypedUniform<'mat4x4f'>;
		const storedDefinition = material.textures.uMain;
		const storedPayload = storedDefinition?.source as {
			readonly source: HTMLCanvasElement;
			readonly width?: number;
		};

		expect(Object.isFrozen(storedTint)).toBe(true);
		expect(Object.isFrozen(storedTransform)).toBe(true);
		expect(Object.isFrozen(storedTransform.value)).toBe(true);
		expect(Object.isFrozen(storedDefinition)).toBe(true);
		expect(Object.isFrozen(storedPayload)).toBe(true);
		expect(Object.isFrozen(canvas)).toBe(false);

		expect(() => {
			(material as { fragment: string }).fragment = '';
		}).toThrow();
		expect(() => {
			(material.uniforms as { uTint: unknown }).uTint = 0;
		}).toThrow();
		expect(() => {
			(storedTint as number[])[0] = 9;
		}).toThrow();
		expect(() => {
			(storedTransform as { type: string }).type = 'vec4f';
		}).toThrow();
		expect(() => {
			(storedTransform.value as number[])[0] = 9;
		}).toThrow();
		expect(() => {
			(material.textures as { uMain: unknown }).uMain = {};
		}).toThrow();
		expect(() => {
			(storedDefinition as { filter?: GPUFilterMode }).filter = 'nearest';
		}).toThrow();
		expect(() => {
			(storedPayload as { width?: number }).width = 2;
		}).toThrow();

		canvas.width = 32;
		expect(storedPayload.source.width).toBe(32);
		expect(storedTint[0]).toBe(1);
		expect(storedTransform.value[0]).toBe(1);
		expect(storedDefinition?.filter).toBe('linear');
		expect(storedPayload.width).toBe(16);
	});

	it('normalizes Float32Array mat4x4f material defaults into frozen snapshots', () => {
		const matrix = new Float32Array(16);
		matrix[0] = 1;
		matrix[5] = 1;
		matrix[10] = 1;
		matrix[15] = 1;

		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			uniforms: {
				uTransform: { type: 'mat4x4f', value: matrix }
			}
		});
		const stored = material.uniforms.uTransform as TypedUniform<'mat4x4f'>;

		expect(Array.isArray(stored.value)).toBe(true);
		expect(Object.isFrozen(stored.value)).toBe(true);
		expect(stored.value[0]).toBe(1);

		expect(() => {
			(stored.value as number[])[0] = 9;
		}).toThrow();
		expect(stored.value[0]).toBe(1);
	});

	it('builds and applies define blocks', () => {
		const block = buildDefinesBlock({
			USE_FOG: true,
			INTENSITY: 2,
			ITERATIONS: { type: 'i32', value: 4 },
			CENTER: { type: 'vec2f', value: [0.5, 0.25] }
		});

		expect(block).toContain('const USE_FOG: bool = true;');
		expect(block).toContain('const INTENSITY: f32 = 2.0;');
		expect(block).toContain('const ITERATIONS: i32 = 4;');
		expect(block).toContain('const CENTER: vec2f = vec2f(0.5, 0.25);');

		const withDefines = applyMaterialDefines(
			'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			{ USE_FOG: false }
		);

		expect(withDefines).toContain('const USE_FOG: bool = false;');
		expect(withDefines).toContain('fn frag(uv: vec2f) -> vec4f');
	});

	it('clones and freezes vector define values', () => {
		const center: [number, number] = [0.5, 0.25];
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			defines: {
				CENTER: { type: 'vec2f', value: center }
			}
		});

		center[0] = 0;

		expect(material.defines.CENTER).toEqual({ type: 'vec2f', value: [0.5, 0.25] });
		expect(Object.isFrozen(material.defines.CENTER)).toBe(true);
		expect(Object.isFrozen((material.defines.CENTER as { value: readonly number[] }).value)).toBe(
			true
		);
	});

	it('resolves material and tracks signature', () => {
		const resolved = resolveMaterial(
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				uniforms: { b: 1, a: 0 },
				textures: { z: {}, x: {} }
			})
		);

		expect(resolved.uniformLayout.entries.map((entry) => entry.name)).toEqual(['a', 'b']);
		expect(resolved.textureKeys).toEqual(['x', 'z']);
		expect(resolved.signature).toContain('"uniforms":["a:f32","b:f32"]');
	});

	it('publishes an immutable resolved snapshot without exposing mutable cache state', () => {
		const canvas = document.createElement('canvas');
		const material = withMockedStack(
			['Error', '    at createMaterial (/app/Scene.svelte:12:4)'].join('\n'),
			() =>
				defineMaterial({
					fragment: '#include <tone>\nfn frag(uv: vec2f) -> vec4f { return tone(uv) * GAIN; }',
					uniforms: { uMix: [0.25, 0.75] },
					textures: {
						uMain: { source: { source: canvas, width: 16, height: 8 } },
						uStorage: {
							storage: true,
							format: 'rgba8unorm',
							width: 8,
							height: 8
						}
					},
					defines: { GAIN: 1 },
					includes: {
						tone: 'fn tone(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
					},
					storageBuffers: {
						particles: { size: 16, type: 'array<f32>' }
					}
				})
		);
		const resolved = resolveMaterial(material);
		const mappedLine = resolved.fragmentLineMap.find((entry) => entry !== null);
		const textureSource = resolved.textures.uMain?.source as { width?: number };

		expect(mappedLine).not.toBeNull();
		expect(resolved.source).not.toBeNull();
		expect(
			[
				resolved,
				resolved.fragmentLineMap,
				mappedLine,
				resolved.uniforms,
				resolved.textures,
				resolved.textures.uMain,
				textureSource,
				resolved.uniformLayout,
				resolved.uniformLayout.entries,
				resolved.uniformLayout.entries[0],
				resolved.uniformLayout.byName,
				resolved.textureKeys,
				resolved.includeSources,
				resolved.source,
				resolved.storageBufferKeys,
				resolved.storageTextureKeys
			].every((value) => Object.isFrozen(value))
		).toBe(true);

		expect(() => {
			(resolved as { signature: string }).signature = 'corrupted';
		}).toThrow();
		expect(() => {
			(resolved.fragmentLineMap as Array<unknown>)[1] = null;
		}).toThrow();
		expect(() => {
			(mappedLine as { line: number }).line = 999;
		}).toThrow();
		expect(() => {
			(resolved.uniformLayout.entries as Array<unknown>).push({});
		}).toThrow();
		expect(() => {
			(resolved.uniformLayout.byName as Record<string, unknown>).corrupted = {};
		}).toThrow();
		expect(() => {
			(resolved.textureKeys as string[]).push('corrupted');
		}).toThrow();
		expect(() => {
			textureSource.width = 1;
		}).toThrow();
		expect(() => {
			(resolved.source as { line: number }).line = 999;
		}).toThrow();

		const cached = resolveMaterial(material);
		expect(cached).toBe(resolved);
		expect(cached.signature).not.toBe('corrupted');
		expect(cached.textureKeys).toEqual(['uMain', 'uStorage']);
		expect(cached.storageBufferKeys).toEqual(['particles']);
		expect(cached.storageTextureKeys).toEqual(['uStorage']);
		expect(cached.uniformLayout.byName.uMix?.offset).toBe(0);
		expect((cached.textures.uMain?.source as { width?: number }).width).toBe(16);
	});

	it('changes signature when defines change', () => {
		const baseFragment = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const a = resolveMaterial(
			defineMaterial({
				fragment: baseFragment,
				defines: { USE_GRAIN: true }
			})
		);
		const b = resolveMaterial(
			defineMaterial({
				fragment: baseFragment,
				defines: { USE_GRAIN: false }
			})
		);

		expect(a.signature).not.toEqual(b.signature);
	});

	it('changes signature when texture sampler config changes', () => {
		const baseFragment = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const a = resolveMaterial(
			defineMaterial({
				fragment: baseFragment,
				textures: {
					uMain: { filter: 'linear', addressModeU: 'clamp-to-edge' }
				}
			})
		);
		const b = resolveMaterial(
			defineMaterial({
				fragment: baseFragment,
				textures: {
					uMain: { filter: 'nearest', addressModeU: 'repeat' }
				}
			})
		);

		expect(a.signature).not.toEqual(b.signature);
	});

	it('distinguishes automatic texture format from an explicit matching format', () => {
		const fragment = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const automatic = resolveMaterial(defineMaterial({ fragment, textures: { photo: {} } }));
		const explicit = resolveMaterial(
			defineMaterial({ fragment, textures: { photo: { format: 'rgba8unorm-srgb' } } })
		);
		expect(automatic.signature).not.toEqual(explicit.signature);
	});

	it('changes signature when texture allocation config changes', () => {
		const baseFragment = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const rgba8 = resolveMaterial(
			defineMaterial({
				fragment: baseFragment,
				textures: {
					uMain: { format: 'rgba8unorm', update: 'once' }
				}
			})
		);
		const rgba16 = resolveMaterial(
			defineMaterial({
				fragment: baseFragment,
				textures: {
					uMain: { format: 'rgba16float', update: 'once' }
				}
			})
		);
		const perFrame = resolveMaterial(
			defineMaterial({
				fragment: baseFragment,
				textures: {
					uMain: { format: 'rgba8unorm', update: 'perFrame' }
				}
			})
		);

		expect(rgba8.signature).not.toEqual(rgba16.signature);
		expect(rgba8.signature).not.toEqual(perFrame.signature);
	});

	it('changes signature when storage texture dimensions change', () => {
		const baseFragment = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const small = resolveMaterial(
			defineMaterial({
				fragment: baseFragment,
				textures: {
					sim: {
						storage: true,
						format: 'rgba8unorm',
						width: 16,
						height: 16,
						fragmentVisible: false
					}
				}
			})
		);
		const large = resolveMaterial(
			defineMaterial({
				fragment: baseFragment,
				textures: {
					sim: {
						storage: true,
						format: 'rgba8unorm',
						width: 32,
						height: 16,
						fragmentVisible: false
					}
				}
			})
		);

		expect(small.signature).not.toEqual(large.signature);
	});

	it('rejects invalid fragment contracts and define values', () => {
		expect(() =>
			defineMaterial({
				fragment: 'fn nope() -> vec4f { return vec4f(0.0); }'
			})
		).toThrow(/fn frag\(uv: vec2f\) -> vec4f/);

		expect(() =>
			defineMaterial({
				fragment: 'fn frag(coords: vec2f) -> vec4f { return vec4f(coords, 0.0, 1.0); }'
			})
		).toThrow(/\(uv: vec2f\).+coords: vec2f/);

		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec3f { return vec3f(uv, 0.0); }'
			})
		).toThrow(/expected return type `vec4f`, received `vec3f`/);

		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				defines: { BROKEN: Number.NaN }
			})
		).toThrow(/Define numbers must be finite/);

		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				defines: { BROKEN: { type: 'u32', value: -1 } }
			})
		).toThrow(/u32 define must be >= 0/);
	});

	it('rejects an incomplete fragment signature with long whitespace in bounded time', () => {
		const fragment = `fn frag(uv: vec2f) -> vec4f${' \t'.repeat(10_000)}!`;

		expect(() => defineMaterial({ fragment })).toThrow(/fragment contract mismatch/i);
	}, 250);

	it('expands includes and preserves source mapping metadata', () => {
		const resolved = resolveMaterial(
			defineMaterial({
				fragment: `
#include <colorize>
fn frag(uv: vec2f) -> vec4f {
	return colorize(uv);
}
`,
				includes: {
					colorize: `
fn colorize(uv: vec2f) -> vec4f {
	return vec4f(uv, 0.0, 1.0);
}
`
				}
			})
		);

		expect(resolved.fragmentWgsl).toContain('fn colorize(uv: vec2f) -> vec4f');
		expect(resolved.fragmentWgsl).toContain('fn frag(uv: vec2f) -> vec4f');
		const includeLine = resolved.fragmentLineMap.find((entry) => entry?.kind === 'include');
		expect(includeLine).toMatchObject({
			kind: 'include',
			include: 'colorize'
		});
	});

	it('rejects unknown or circular include references', () => {
		expect(() =>
			defineMaterial({
				fragment: '#include <missing>\nfn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
			})
		).toThrow(/Unknown include "missing"/);

		expect(() =>
			defineMaterial({
				fragment: '#include <a>\nfn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				includes: {
					a: '#include <b>',
					b: '#include <a>'
				}
			})
		).toThrow(/Circular include detected/);
	});

	it('reuses resolved material snapshot for immutable material instances', () => {
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			uniforms: { uMix: 0.25 }
		});

		const first = resolveMaterial(material);
		const second = resolveMaterial(material);
		expect(first).toBe(second);
	});

	it('skips assertDefinedMaterial on cache hits — Object.isFrozen is not called after first resolution', () => {
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
		});

		// Warm the cache.
		resolveMaterial(material);

		// Any subsequent call must return the cached result without re-validating.
		const isFrozenSpy = vi.spyOn(Object, 'isFrozen');
		resolveMaterial(material);
		resolveMaterial(material);

		expect(isFrozenSpy).not.toHaveBeenCalled();
		isFrozenSpy.mockRestore();
	});

	it('captures source metadata from chrome-like stack traces', () => {
		const resolved = withMockedStack(
			[
				'Error',
				'    at resolveSourceMetadata (/workspace/src/lib/core/material.ts:249:15)',
				'    at createOceanMaterial (/app/routes/Ocean.svelte:48:9)'
			].join('\n'),
			() =>
				resolveMaterial(
					defineMaterial({
						fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
					})
				)
		);

		expect(resolved.source).toMatchObject({
			component: 'Ocean.svelte',
			file: '/app/routes/Ocean.svelte',
			line: 48,
			column: 9,
			functionName: 'createOceanMaterial'
		});
	});

	it('captures source metadata from firefox-like stack traces', () => {
		const resolved = withMockedStack(
			[
				'Error',
				'resolveSourceMetadata@http://localhost/src/lib/core/material.ts:249:15',
				'buildScene@http://localhost/src/routes/+page.svelte:88:12'
			].join('\n'),
			() =>
				resolveMaterial(
					defineMaterial({
						fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
					})
				)
		);

		expect(resolved.source).toMatchObject({
			component: '+page.svelte',
			file: 'http://localhost/src/routes/+page.svelte',
			line: 88,
			column: 12,
			functionName: 'buildScene'
		});
	});

	it('throws when resolving non-normalized material objects', () => {
		const rawMaterial = {
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			uniforms: {},
			textures: {},
			defines: {}
		};

		expect(() => resolveMaterial(rawMaterial as Parameters<typeof resolveMaterial>[0])).toThrow(
			/defineMaterial/
		);
	});

	// --- Storage buffer tests ---

	it('creates material with frozen storageBuffers', () => {
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			storageBuffers: {
				particles: { size: 1024, type: 'array<vec4f>' }
			}
		});

		expect(material.storageBuffers).toBeDefined();
		expect(Object.isFrozen(material.storageBuffers)).toBe(true);
		expect(material.storageBuffers.particles?.size).toBe(1024);
	});

	it('defaults to empty storageBuffers when not provided', () => {
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }'
		});

		expect(material.storageBuffers).toEqual({});
	});

	it('keeps storage buffer snapshots and canonical initialData isolated from mutation', () => {
		const initialData = new Float32Array([1, 2, 3, 4]);
		const definition: {
			size: number;
			type: StorageBufferDefinition['type'];
			access: NonNullable<StorageBufferDefinition['access']>;
			initialData: Float32Array;
		} = {
			size: 16,
			type: 'array<f32>',
			access: 'read',
			initialData
		};
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			storageBuffers: {
				buf: definition
			}
		});

		initialData[0] = 999;
		definition.size = 32;
		definition.access = 'read-write';

		const storedDefinition = material.storageBuffers.buf;
		const firstRead = storedDefinition?.initialData as Float32Array;
		firstRead[0] = 777;
		firstRead.set([888, 999], 1);

		const secondRead = storedDefinition?.initialData as Float32Array;
		const resolved = resolveMaterial(material);
		const pristine = resolveMaterial(
			defineMaterial({
				fragment: material.fragment,
				storageBuffers: {
					buf: {
						size: 16,
						type: 'array<f32>',
						access: 'read',
						initialData: new Float32Array([1, 2, 3, 4])
					}
				}
			})
		);
		expect(Object.isFrozen(material.storageBuffers)).toBe(true);
		expect(Object.isFrozen(storedDefinition)).toBe(true);
		expect(storedDefinition?.size).toBe(16);
		expect(storedDefinition?.access).toBe('read');
		expect(firstRead).not.toBe(secondRead);
		expect(Array.from(secondRead)).toEqual([1, 2, 3, 4]);
		expect(resolved.signature).toBe(pristine.signature);
		expect(() => {
			(material.storageBuffers as { buf: unknown }).buf = {
				size: 16,
				type: 'array<f32>'
			};
		}).toThrow();
		expect(() => {
			(storedDefinition as { size: number }).size = 64;
		}).toThrow();
		expect(() => {
			(storedDefinition as unknown as { initialData?: Float32Array }).initialData =
				new Float32Array([9]);
		}).toThrow();
		expect(storedDefinition?.size).toBe(16);
		expect(Array.from(storedDefinition?.initialData ?? [])).toEqual([1, 2, 3, 4]);
	});

	it('rejects invalid storage buffer name', () => {
		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				storageBuffers: {
					'123bad': { size: 16, type: 'array<f32>' }
				}
			})
		).toThrow(/Invalid uniform name/);
	});

	it('rejects storage buffer with size 0', () => {
		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				storageBuffers: {
					buf: { size: 0, type: 'array<f32>' }
				}
			})
		).toThrow(/greater than 0/);
	});

	it('resolves storageBufferKeys in sorted order', () => {
		const resolved = resolveMaterial(
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				storageBuffers: {
					zBuf: { size: 16, type: 'array<f32>' },
					aBuf: { size: 32, type: 'array<vec4f>' }
				}
			})
		);

		expect(resolved.storageBufferKeys).toEqual(['aBuf', 'zBuf']);
	});

	it('includes storageBufferKeys in material signature', () => {
		const resolved = resolveMaterial(
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				storageBuffers: {
					particles: { size: 1024, type: 'array<vec4f>' }
				}
			})
		);

		expect(resolved.signature).toContain('storageBufferKeys');
		expect(resolved.signature).toContain('particles');
	});

	it('changes signature when storage buffer type changes', () => {
		const base = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const a = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: { buf: { size: 64, type: 'array<f32>' } }
			})
		);
		const b = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: { buf: { size: 64, type: 'array<vec4f>' } }
			})
		);

		expect(a.signature).not.toEqual(b.signature);
	});

	it('changes signature when storage buffer size changes', () => {
		const base = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const a = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: { buf: { size: 64, type: 'array<f32>' } }
			})
		);
		const b = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: { buf: { size: 128, type: 'array<f32>' } }
			})
		);

		expect(a.signature).not.toEqual(b.signature);
	});

	it('changes signature when storage buffer access mode changes', () => {
		const base = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const readOnly = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: { buf: { size: 64, type: 'array<f32>', access: 'read' } }
			})
		);
		const readWrite = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: { buf: { size: 64, type: 'array<f32>', access: 'read-write' } }
			})
		);

		expect(readOnly.signature).not.toEqual(readWrite.signature);
	});

	it('changes signature when storage buffer initialData bytes change', () => {
		const base = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const a = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: {
					buf: { size: 16, type: 'array<f32>', initialData: new Float32Array([1]) }
				}
			})
		);
		const b = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: {
					buf: { size: 16, type: 'array<f32>', initialData: new Float32Array([2]) }
				}
			})
		);

		expect(a.signature).not.toEqual(b.signature);
	});

	it('compares canonical storage bytes without copying or exposing them', () => {
		const source = new Uint32Array([99, 1, 2, 99]);
		const make = (initialData?: Uint32Array | Float32Array) =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(1.0); }',
				storageBuffers: {
					data: { size: 8, type: 'array<u32>', ...(initialData ? { initialData } : {}) }
				}
			}).storageBuffers;
		const a = make(source.subarray(1, 3));
		const b = make(new Uint32Array([1, 2]));
		const different = make(new Uint32Array([1, 3]));
		const short = make(new Uint32Array([1]));
		const otherType = make(new Float32Array([1, 2]));
		const absent = make();
		const alsoAbsent = make();
		const empty = make(new Uint32Array());
		source[1] = 7;
		(a.data!.initialData as Uint32Array)[0] = 9;
		const copies = vi.spyOn(Uint32Array.prototype, 'slice');
		try {
			expect(hasSameStorageBufferInitialData(a, a, ['data'])).toBe(true);
			expect(hasSameStorageBufferInitialData({ data: a.data! }, a, ['data'])).toBe(true);
			expect(hasSameStorageBufferInitialData(a, b, ['data'])).toBe(true);
			for (const next of [different, short, otherType, absent, {}]) {
				expect(hasSameStorageBufferInitialData(a, next, ['data'])).toBe(false);
			}
			expect(hasSameStorageBufferInitialData(absent, alsoAbsent, ['data'])).toBe(true);
			expect(hasSameStorageBufferInitialData(absent, empty, ['data'])).toBe(false);
			expect(copies).not.toHaveBeenCalled();
		} finally {
			copies.mockRestore();
		}
	});

	it('keeps storage buffer initialData signatures deterministic for identical content', () => {
		const base = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const a = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: {
					buf: { size: 16, type: 'array<f32>', initialData: new Float32Array([1, 2, 3, 4]) }
				}
			})
		);
		const b = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: {
					buf: { size: 16, type: 'array<f32>', initialData: new Float32Array([1, 2, 3, 4]) }
				}
			})
		);

		expect(a.signature).toEqual(b.signature);
	});

	it('distinguishes storage buffer initialData typed array constructors', () => {
		const base = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const floats = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: {
					buf: { size: 16, type: 'array<f32>', initialData: new Float32Array([1]) }
				}
			})
		);
		const uints = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: { buf: { size: 16, type: 'array<u32>', initialData: new Uint32Array([1]) } }
			})
		);

		expect(floats.signature).not.toEqual(uints.signature);
	});

	it('distinguishes missing initialData from explicit zero-length initialData', () => {
		const base = 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }';
		const missing = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: { buf: { size: 16, type: 'array<f32>' } }
			})
		);
		const empty = resolveMaterial(
			defineMaterial({
				fragment: base,
				storageBuffers: { buf: { size: 16, type: 'array<f32>', initialData: new Float32Array(0) } }
			})
		);

		expect(missing.signature).not.toEqual(empty.signature);
	});

	it('accepts texture with storage:true and valid format', () => {
		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				textures: {
					storageTex: { storage: true, format: 'rgba8unorm', width: 16, height: 16 }
				}
			})
		).not.toThrow();
	});

	it('rejects texture with storage:true but no format', () => {
		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				textures: {
					storageTex: { storage: true, width: 16, height: 16 }
				}
			})
		).toThrow(/requires a `format` field/);
	});

	it('rejects texture with storage:true but missing explicit dimensions', () => {
		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				textures: {
					storageTex: { storage: true, format: 'rgba8unorm', height: 16 }
				}
			})
		).toThrow(/requires an explicit positive integer `width` field/);

		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				textures: {
					storageTex: { storage: true, format: 'rgba8unorm', width: 16 }
				}
			})
		).toThrow(/requires an explicit positive integer `height` field/);
	});

	it('rejects texture with storage:true and source payload', () => {
		const canvas = document.createElement('canvas');
		canvas.width = 16;
		canvas.height = 16;

		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				textures: {
					storageTex: {
						storage: true,
						format: 'rgba8unorm',
						width: 16,
						height: 16,
						source: canvas
					}
				}
			})
		).toThrow(/must not define a `source` field/);
	});

	it('rejects texture with storage:true and invalid format', () => {
		expect(() =>
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				textures: {
					storageTex: { storage: true, format: 'rgba8unorm-srgb', width: 16, height: 16 }
				}
			})
		).toThrow(/storage-compatible format/);
	});

	it('preserves backward compatibility (no storageBuffers field)', () => {
		const material = defineMaterial({
			fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
			uniforms: { uMix: 0.5 }
		});

		expect(material.storageBuffers).toEqual({});
		const resolved = resolveMaterial(material);
		expect(resolved.storageBufferKeys).toEqual([]);
		expect(resolved.storageTextureKeys).toEqual([]);
	});

	it('resolves storageTextureKeys for textures with storage:true', () => {
		const resolved = resolveMaterial(
			defineMaterial({
				fragment: 'fn frag(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }',
				textures: {
					normalTex: {},
					storageTex: { storage: true, format: 'rgba8unorm', width: 16, height: 16 }
				}
			})
		);

		expect(resolved.storageTextureKeys).toEqual(['storageTex']);
	});
});
