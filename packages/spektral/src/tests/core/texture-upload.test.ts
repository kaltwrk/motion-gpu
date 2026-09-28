import { expect, it, vi } from 'vitest';
import { uploadTextureBaseLevel } from '../../lib/core/renderer/resource-synchronization';

it.each([true, false])(
	'uploads premultipliedAlpha=%s using the destination descriptor',
	(premultipliedAlpha) => {
		const copyExternalImageToTexture = vi.fn();
		const device = { queue: { copyExternalImageToTexture } } as unknown as GPUDevice;
		const source = document.createElement('canvas');
		const texture = {} as GPUTexture;
		for (const flipY of [true, false]) {
			uploadTextureBaseLevel(device, texture, { flipY, premultipliedAlpha }, source, 8, 4);
			const [input, destination, size] = copyExternalImageToTexture.mock.calls.at(-1)!;
			expect(input.source).toBe(source);
			expect(input.flipY ?? false).toBe(flipY);
			expect(input).not.toHaveProperty('premultipliedAlpha');
			expect(destination.texture).toBe(texture);
			expect(destination.mipLevel).toBe(0);
			expect(destination.premultipliedAlpha ?? false).toBe(premultipliedAlpha);
			expect(size).toEqual({ width: 8, height: 4, depthOrArrayLayers: 1 });
		}
	}
);
