import { useEffect, useRef, useState } from 'react';
import { useFrame, usePointer, useSpektral, useTexture } from 'spektral/react';
import {
	nixieCathodeOptions,
	nixieCathodeUrls,
	nixieWoodColorOptions,
	nixieWoodColorUrls,
	nixieWoodSurfaceOptions,
	nixieWoodSurfaceUrls
} from '../assets';
import { createNixieRuntime } from '../interaction';

export default function Runtime() {
	const context = useSpektral();
	const contextRef = useRef(context);
	contextRef.current = context;
	const [runtime] = useState(() =>
		createNixieRuntime(
			() => contextRef.current.canvas,
			() => contextRef.current.invalidate()
		)
	);
	const cathodes = useTexture(nixieCathodeUrls, nixieCathodeOptions);
	const woodColor = useTexture(nixieWoodColorUrls, nixieWoodColorOptions);
	const woodSurface = useTexture(nixieWoodSurfaceUrls, nixieWoodSurfaceOptions);
	const pointer = usePointer(runtime.pointerOptions);
	useEffect(runtime.mount, [runtime]);
	useFrame(
		(frame) => runtime.update(frame, pointer.state.current, cathodes, woodColor, woodSurface),
		{
			autoInvalidate: false
		}
	);
	return null;
}
