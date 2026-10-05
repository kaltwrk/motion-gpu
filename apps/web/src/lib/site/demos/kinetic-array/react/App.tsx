import { useState } from 'react';
import { FragCanvas } from 'spektral/react';
import { studioColor } from '../../../demo-shared/presentation';
import { createKineticScene, reportSceneError } from '../material';
import Runtime from './runtime';

export default function App() {
	const [scene] = useState(createKineticScene);
	return (
		<FragCanvas
			material={scene.material}
			passes={scene.passes}
			renderMode="always"
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
