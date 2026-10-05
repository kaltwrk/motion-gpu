import type { TextureLoadOptions } from 'spektral';

const assetUrl = (filename: string) =>
	new URL(`/playground-media/nixie/${filename}`, window.location.href).href;
export const nixieCathodeUrls = () => [assetUrl('cathodes.png'), assetUrl('stamp.png')];
export const nixieWoodColorUrls = () => [assetUrl('wood-albedo.jpg')];
export const nixieWoodSurfaceUrls = () => [
	assetUrl('wood-normal.jpg'),
	assetUrl('wood-roughness.jpg')
];
export const nixieCathodeOptions = {
	colorSpace: 'linear',
	update: 'once',
	generateMipmaps: true,
	flipY: false,
	premultipliedAlpha: false,
	requestInit: { mode: 'cors', credentials: 'omit' },
	decode: { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }
} satisfies TextureLoadOptions;

export const nixieWoodSurfaceOptions = nixieCathodeOptions;
export const nixieWoodColorOptions = {
	...nixieCathodeOptions,
	colorSpace: 'srgb'
} satisfies TextureLoadOptions;
