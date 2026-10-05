import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FrameState } from 'spektral';
import { createSignalVideo } from '$lib/site/demos/signal/media';

class VideoProbe extends EventTarget {
	paused = true;
	ended = false;
	readyState = 0;
	videoWidth = 0;
	videoHeight = 0;
	currentTime = 0;
	duration = 18;
	src = '';
	crossOrigin = '';
	muted = false;
	defaultMuted = false;
	playsInline = false;
	loop = false;
	preload = '';
	error = null;
	callbacks = new Map<number, () => void>();
	nextId = 0;
	play = vi.fn(() => {
		this.paused = false;
		this.dispatchEvent(new Event('playing'));
		return Promise.resolve();
	});
	pause = vi.fn(() => {
		this.paused = true;
		this.dispatchEvent(new Event('pause'));
	});
	load = vi.fn();
	removeAttribute = vi.fn((name: string) => {
		if (name === 'src') this.src = '';
	});
	requestVideoFrameCallback = vi.fn((callback: () => void) => {
		const id = ++this.nextId;
		this.callbacks.set(id, callback);
		return id;
	});
	cancelVideoFrameCallback = vi.fn((id: number) => this.callbacks.delete(id));
	decodedFrame() {
		const [id, callback] = [...this.callbacks.entries()][0]!;
		this.callbacks.delete(id);
		callback();
	}
	ready() {
		this.readyState = 2;
		this.videoWidth = 1024;
		this.videoHeight = 768;
		this.dispatchEvent(new Event('loadeddata'));
	}
}

const frameState = () => ({
	time: 0,
	delta: 1 / 60,
	setUniform: vi.fn(),
	setTexture: vi.fn(),
	writeStorageBuffer: vi.fn(),
	readStorageBuffer: vi.fn(),
	invalidate: vi.fn(),
	advance: vi.fn(),
	renderMode: 'on-demand' as const,
	autoRender: true,
	canvas: {} as HTMLCanvasElement
});

afterEach(() => vi.unstubAllGlobals());

describe('Signal video lifecycle', () => {
	it('binds only a decoded source, then redraws decoded frames without rebinding', () => {
		const video = new VideoProbe();
		const invalidate = vi.fn();
		const source = createSignalVideo(
			'/orbit.mp4',
			invalidate,
			video as unknown as HTMLVideoElement
		);
		const frame = frameState();
		source.sync(frame as FrameState);
		expect(frame.setTexture).not.toHaveBeenCalled();
		video.readyState = 1;
		video.videoWidth = 1024;
		video.videoHeight = 768;
		video.dispatchEvent(new Event('loadeddata'));
		source.sync(frame as FrameState);
		expect(frame.setTexture).not.toHaveBeenCalled();

		video.ready();
		source.sync(frame as FrameState);
		expect(frame.setTexture).toHaveBeenCalledWith('uVideo', {
			source: video,
			colorSpace: 'srgb',
			update: 'perFrame',
			flipY: false
		});
		expect(frame.setUniform).toHaveBeenCalledWith('uReady', 1);
		const draws = invalidate.mock.calls.length;
		video.decodedFrame();
		expect(invalidate).toHaveBeenCalledTimes(draws + 1);
		source.sync(frame as FrameState);
		expect(frame.setTexture).toHaveBeenCalledTimes(1);
		expect(video.callbacks.size).toBe(1);
		source.dispose();
	});

	it('freezes a paused frame, seeks while paused, and resumes after a denied autoplay', async () => {
		const video = new VideoProbe();
		video.play.mockRejectedValueOnce(new DOMException('Autoplay denied', 'NotAllowedError'));
		const invalidate = vi.fn();
		const source = createSignalVideo(
			'/orbit.mp4',
			invalidate,
			video as unknown as HTMLVideoElement
		);
		await Promise.resolve();
		expect(source.paused).toBe(true);
		source.play();
		expect(source.paused).toBe(false);
		video.ready();
		const frame = frameState();
		source.sync(frame as FrameState);
		source.pause();
		source.sync(frame as FrameState);
		expect(video.callbacks.size).toBe(0);
		expect(frame.setUniform).toHaveBeenCalledWith('uPlaying', 0);
		expect(frame.setTexture).toHaveBeenCalledTimes(1);
		source.seek(25);
		expect(video.currentTime).toBeCloseTo(17.999);
		source.seek(-1);
		expect(video.currentTime).toBe(0);
		const draws = invalidate.mock.calls.length;
		video.dispatchEvent(new Event('seeked'));
		expect(invalidate).toHaveBeenCalledTimes(draws + 1);
		expect(source.paused).toBe(true);
		source.dispose();
	});

	it('unbinds before releasing the decoder and rejects late callbacks after disposal', () => {
		const video = new VideoProbe();
		const invalidate = vi.fn();
		const source = createSignalVideo(
			'/orbit.mp4',
			invalidate,
			video as unknown as HTMLVideoElement
		);
		const frame = frameState();
		video.ready();
		source.sync(frame as FrameState);
		const lateCallback = [...video.callbacks.values()][0]!;
		source.dispose();
		expect(frame.setTexture).toHaveBeenLastCalledWith('uVideo', null);
		expect(frame.setTexture.mock.invocationCallOrder.at(-1)).toBeLessThan(
			video.pause.mock.invocationCallOrder.at(-1)!
		);
		expect(video.src).toBe('');
		expect(video.load).toHaveBeenCalledTimes(2);
		expect(video.callbacks.size).toBe(0);
		const draws = invalidate.mock.calls.length;
		lateCallback();
		video.dispatchEvent(new Event('loadeddata'));
		source.dispose();
		expect(invalidate).toHaveBeenCalledTimes(draws);
		expect(video.load).toHaveBeenCalledTimes(2);
	});

	it('cancels the animation-frame fallback when paused', () => {
		const video = new VideoProbe();
		Object.defineProperty(video, 'requestVideoFrameCallback', { value: undefined });
		const request = vi.fn(() => 17);
		const cancel = vi.fn();
		vi.stubGlobal('requestAnimationFrame', request);
		vi.stubGlobal('cancelAnimationFrame', cancel);
		const source = createSignalVideo('/orbit.mp4', vi.fn(), video as unknown as HTMLVideoElement);
		expect(request).toHaveBeenCalledTimes(1);
		source.pause();
		expect(cancel).toHaveBeenCalledWith(17);
		source.dispose();
	});
});
