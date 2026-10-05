import type { TextureLoadOptions } from 'spektral';

const assetUrl = (filename: string) =>
	new URL(`/playground-media/signal/${filename}`, window.location.href).href;

export const signalVideoUrl = () => assetUrl('orbit.mp4');
export const signalLabelUrls = () => [assetUrl('faceplate.png')];
export const signalLabelOptions: TextureLoadOptions = {
	colorSpace: 'linear',
	generateMipmaps: true,
	update: 'once',
	flipY: false,
	premultipliedAlpha: false,
	requestInit: { mode: 'cors', credentials: 'omit' },
	decode: { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }
};
