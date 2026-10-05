import { useEffect, useRef, useState } from 'react';
import { useFrame, usePointer, useSpektral, useTexture } from 'spektral/react';
import { signalLabelOptions, signalLabelUrls } from '../assets';
import { createSignalRuntime } from '../interaction';

export default function Runtime() {
	const context = useSpektral();
	const contextRef = useRef(context);
	contextRef.current = context;
	const [runtime] = useState(() =>
		createSignalRuntime(
			() => contextRef.current.canvas,
			() => contextRef.current.invalidate()
		)
	);
	const labels = useTexture(signalLabelUrls, signalLabelOptions);
	const pointer = usePointer(runtime.pointerOptions);
	useEffect(runtime.mount, [runtime]);
	useFrame((frame) => runtime.update(frame, pointer.state.current, labels), {
		autoInvalidate: false
	});
	return null;
}
