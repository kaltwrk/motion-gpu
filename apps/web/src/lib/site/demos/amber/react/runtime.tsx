import { useState } from 'react';
import { useFrame, usePointer, useTexture } from 'spektral/react';
import { albedoOptions, albedoUrls, surfaceOptions, surfaceUrls } from '../assets';
import { createInspectionInteraction } from '../interaction';

export default function Runtime() {
	const albedo = useTexture(albedoUrls, albedoOptions);
	const surface = useTexture(surfaceUrls, surfaceOptions);
	const pointer = usePointer({ capturePointer: true, trackWhilePressedOutsideCanvas: true });
	const [updateInspection] = useState(createInspectionInteraction);
	useFrame((frame) => updateInspection(frame, pointer.state.current, albedo, surface), {
		autoInvalidate: false
	});
	return null;
}
