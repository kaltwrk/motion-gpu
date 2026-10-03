import { useEffect, useRef } from 'react';
import { useFrame } from 'spektral/react';
import { createOriginCleanVideo, type OriginCleanVideo } from './video-source';

/**
 * Streams decoded video frames into the Data Mosh material with CORS-safe settings.
 */
export default function Runtime() {
	const videoHandleRef = useRef<OriginCleanVideo | null>(null);
	const lastVideoTime = useRef(0);
	const resetNextFrame = useRef(true);

	useEffect(() => {
		const handle = createOriginCleanVideo();
		videoHandleRef.current = handle;
		void handle.ready.catch((error) => console.error('[Data Mosh] Unable to load video.', error));

		return () => {
			handle.dispose();
			if (videoHandleRef.current === handle) videoHandleRef.current = null;
		};
	}, []);

	useFrame((frame) => {
		const video = videoHandleRef.current?.video;
		if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

		const looped = video.currentTime + 0.25 < lastVideoTime.current;
		frame.setUniform('uReset', resetNextFrame.current || looped || video.seeking ? 1 : 0);
		frame.setTexture('video', {
			source: video,
			update: 'perFrame',
			flipY: true,
			colorSpace: 'srgb'
		});
		lastVideoTime.current = video.currentTime;
		resetNextFrame.current = false;
	});

	return null;
}
