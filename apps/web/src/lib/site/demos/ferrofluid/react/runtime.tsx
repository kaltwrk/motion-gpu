import { useState } from 'react';
import { useFrame, usePointer } from 'spektral/react';
import { createMagnetInteraction } from '../interaction';

export default function Runtime() {
	const pointer = usePointer({ capturePointer: true, trackWhilePressedOutsideCanvas: true });
	const [updateMagnet] = useState(createMagnetInteraction);
	useFrame((frame) => updateMagnet(frame, pointer.state.current));
	return null;
}
