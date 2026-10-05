import { useState } from 'react';
import { FragCanvas } from 'spektral/react';
import { studioColor } from '../../../demo-shared/presentation';
import { createSignalScene, reportSceneError } from '../material';
import Runtime from './runtime';

export default function App() {
	const [scene] = useState(createSignalScene);
	return (
		<FragCanvas
			material={scene.material}
			passes={scene.passes}
			renderMode="on-demand"
			dpr={1.5}
			maxDelta={1 / 30}
			color={studioColor}
			showErrorOverlay={false}
			onError={reportSceneError}
			style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
		>
			<Runtime />
		</FragCanvas>
	);
}
