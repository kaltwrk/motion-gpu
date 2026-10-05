import type { TextureLoadOptions } from 'spektral';

// Resolve against the iframe's document URL; its sandbox security origin is opaque.
const assetUrl = (filename: string) =>
	new URL(`/playground-media/obsidian/${filename}`, window.location.href).href;

export const albedoUrls = () => [assetUrl('albedo.jpg')];
export const surfaceUrls = () =>
	['normal.jpg', 'roughness.jpg', 'height.png', 'ao.jpg'].map(assetUrl);

const commonOptions = {
	requestInit: { mode: 'cors', credentials: 'omit' },
	update: 'once',
	generateMipmaps: true,
	flipY: false,
	premultipliedAlpha: false
} satisfies TextureLoadOptions;

export const albedoOptions: TextureLoadOptions = {
	...commonOptions,
	colorSpace: 'srgb'
};

export const surfaceOptions: TextureLoadOptions = {
	...commonOptions,
	colorSpace: 'linear',
	decode: { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }
};
