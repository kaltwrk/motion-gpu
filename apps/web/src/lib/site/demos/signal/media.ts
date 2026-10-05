import type { FrameState } from 'spektral';

/** Own the browser decoder separately from Spektral's per-frame GPU upload. */
export function createSignalVideo(
	sourceUrl: string,
	invalidate: () => void,
	video = document.createElement('video')
) {
	let disposed = false;
	let ready = false;
	let bound = false;
	let publishedPlaying = 0;
	let videoFrame: number | null = null;
	let fallbackFrame: number | null = null;
	let lastFallbackTime = -1;
	let lastFrame: FrameState | null = null;

	video.crossOrigin = 'anonymous';
	video.muted = true;
	video.defaultMuted = true;
	video.playsInline = true;
	video.loop = true;
	video.preload = 'auto';

	const cancelFrame = () => {
		if (videoFrame !== null) video.cancelVideoFrameCallback(videoFrame);
		if (fallbackFrame !== null) cancelAnimationFrame(fallbackFrame);
		videoFrame = null;
		fallbackFrame = null;
	};

	const scheduleFrame = () => {
		if (disposed || video.paused || video.ended || videoFrame !== null || fallbackFrame !== null)
			return;
		if (typeof video.requestVideoFrameCallback === 'function') {
			videoFrame = video.requestVideoFrameCallback(() => {
				videoFrame = null;
				if (disposed) return;
				invalidate();
				scheduleFrame();
			});
		} else {
			fallbackFrame = requestAnimationFrame(() => {
				fallbackFrame = null;
				if (disposed) return;
				if (lastFallbackTime !== video.currentTime) {
					lastFallbackTime = video.currentTime;
					invalidate();
				}
				scheduleFrame();
			});
		}
	};

	const onData = () => {
		if (disposed) return;
		// HAVE_CURRENT_DATA is enough for copyExternalImageToTexture; metadata alone is not.
		if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) ready = true;
		invalidate();
	};
	const onPlay = () => {
		if (disposed) return;
		onData();
		scheduleFrame();
	};
	const onPause = () => {
		cancelFrame();
		if (!disposed) invalidate();
	};
	const onError = () => {
		if (disposed) return;
		ready = false;
		cancelFrame();
		console.error('Signal video', video.error?.message || 'The video could not be decoded.');
		invalidate();
	};
	const listeners = [
		['loadeddata', onData],
		['seeked', onData],
		['playing', onPlay],
		['pause', onPause],
		['ended', onPause],
		['error', onError]
	] as const;
	for (const [name, handler] of listeners) video.addEventListener(name, handler);

	const play = () => {
		if (disposed) return;
		void video.play().catch((error: unknown) => {
			if (disposed) return;
			// A later screen gesture retries play synchronously when autoplay is denied.
			if (
				!(error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name))
			)
				console.error('Signal playback', error);
			invalidate();
		});
	};

	video.src = sourceUrl;
	video.load();
	play();

	return {
		get ready() {
			return ready;
		},
		get currentTime() {
			return video.currentTime;
		},
		get duration() {
			return Number.isFinite(video.duration) ? video.duration : 0;
		},
		get paused() {
			return video.paused;
		},
		play,
		pause() {
			if (!disposed) video.pause();
		},
		seek(time: number) {
			if (disposed || !Number.isFinite(video.duration) || video.duration <= 0) return;
			video.currentTime = Math.max(0, Math.min(video.duration - 0.001, time));
		},
		sync(frame: FrameState) {
			if (disposed) return;
			lastFrame = frame;
			if (ready !== bound) {
				frame.setTexture(
					'uVideo',
					ready ? { source: video, colorSpace: 'srgb', update: 'perFrame', flipY: false } : null
				);
				frame.setUniform('uReady', ready ? 1 : 0);
				bound = ready;
				frame.invalidate('signal-video-ready');
			}
			const playing = ready && !video.paused && !video.ended ? 1 : 0;
			if (playing !== publishedPlaying) {
				publishedPlaying = playing;
				frame.setUniform('uPlaying', playing);
				frame.invalidate('signal-playback');
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			cancelFrame();
			for (const [name, handler] of listeners) video.removeEventListener(name, handler);
			// Unbind before releasing the decoder so a later upload cannot see a cleared source.
			if (bound) {
				lastFrame?.setTexture('uVideo', null);
				lastFrame?.setUniform('uReady', 0);
				lastFrame?.setUniform('uPlaying', 0);
			}
			video.pause();
			video.removeAttribute('src');
			video.load();
		}
	};
}
