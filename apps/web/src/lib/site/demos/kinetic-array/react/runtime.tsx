import { useState } from 'react';
import { useFrame, usePointer } from 'spektral/react';
import { createKineticInteraction } from '../interaction';

export default function Runtime() {
	const [interaction] = useState(createKineticInteraction);
	const pointer = usePointer(interaction.pointerOptions);
	useFrame((frame) => interaction.update(frame, pointer.state.current), { autoInvalidate: false });
	return null;
}
