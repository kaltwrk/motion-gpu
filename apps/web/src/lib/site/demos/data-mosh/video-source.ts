// “Dancer under neon lights”, Mixkit Stock Video Free License.
// https://mixkit.co/free-stock-video/dancer-under-neon-lights-50431/
const VIDEO_SOURCES = [
	{ src: '/playground-media/data-mosh-neon-dancer.webm', type: 'video/webm; codecs="vp9"' },
	{ src: '/playground-media/data-mosh-neon-dancer.mp4', type: 'video/mp4' }
] as const;

const VIDEO_LOAD_TIMEOUT_MS = 8_000;

export type OriginCleanVideo = {
	video: HTMLVideoElement;
	ready: Promise<void>;
	dispose: () => void;
};

const getMediaError = (video: HTMLVideoElement): Error => {
	const code = video.error?.code;
	const message = video.error?.message;
	return new Error(
		`Video decoding failed${code ? ` (media error ${code})` : ''}${message ? `: ${message}` : '.'}`
	);
};

const waitForCurrentData = (video: HTMLVideoElement, signal: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		const cleanup = () => {
			video.removeEventListener('loadeddata', handleLoadedData);
			video.removeEventListener('error', handleError);
			signal.removeEventListener('abort', handleAbort);
			if (timeoutId !== undefined) clearTimeout(timeoutId);
		};
		const settle = (callback: () => void) => {
			cleanup();
			callback();
		};
		const handleLoadedData = () => settle(resolve);
		const handleError = () => settle(() => reject(getMediaError(video)));
		const handleAbort = () =>
			settle(() => reject(new DOMException('Video loading was aborted.', 'AbortError')));

		if (signal.aborted) {
			handleAbort();
			return;
		}
		if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			handleLoadedData();
			return;
		}

		video.addEventListener('loadeddata', handleLoadedData, { once: true });
		video.addEventListener('error', handleError, { once: true });
		signal.addEventListener('abort', handleAbort, { once: true });
		timeoutId = setTimeout(
			() => settle(() => reject(new Error('Timed out while decoding the video source.'))),
			VIDEO_LOAD_TIMEOUT_MS
		);
	});

/**
 * Fetches video bytes through CORS and remaps them to this sandbox's opaque origin.
 * WebKit can then use the resulting video as an origin-clean WebGPU external image.
 */
export const createOriginCleanVideo = (): OriginCleanVideo => {
	const abortController = new AbortController();
	const video = document.createElement('video');
	video.muted = true;
	video.playsInline = true;
	video.autoplay = true;
	video.loop = true;
	video.preload = 'auto';

	let activeObjectUrl: string | null = null;
	const ready = (async () => {
		let lastError: unknown = new Error('No supported video source is available.');

		for (const source of VIDEO_SOURCES) {
			if (abortController.signal.aborted) return;
			if (video.canPlayType(source.type) === '') continue;

			let candidateObjectUrl: string | null = null;
			try {
				const response = await fetch(source.src, {
					credentials: 'omit',
					mode: 'cors',
					signal: abortController.signal
				});
				if (!response.ok) {
					throw new Error(`Video request failed with HTTP ${response.status}.`);
				}

				const blob = await response.blob();
				if (abortController.signal.aborted) return;

				candidateObjectUrl = URL.createObjectURL(blob);
				video.src = candidateObjectUrl;
				video.load();
				await waitForCurrentData(video, abortController.signal);
				await video.play();
				if (abortController.signal.aborted) {
					video.pause();
					URL.revokeObjectURL(candidateObjectUrl);
					return;
				}

				activeObjectUrl = candidateObjectUrl;
				candidateObjectUrl = null;
				return;
			} catch (error) {
				if (candidateObjectUrl) URL.revokeObjectURL(candidateObjectUrl);
				video.pause();
				video.removeAttribute('src');
				video.load();

				if (abortController.signal.aborted) return;
				lastError = error;
			}
		}

		throw new Error('Unable to load a playable Data Mosh video source.', { cause: lastError });
	})();

	return {
		video,
		ready,
		dispose: () => {
			abortController.abort();
			video.pause();
			video.removeAttribute('src');
			video.load();
			if (activeObjectUrl) {
				URL.revokeObjectURL(activeObjectUrl);
				activeObjectUrl = null;
			}
		}
	};
};
