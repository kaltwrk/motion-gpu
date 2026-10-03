/*
 * Created by Marek Jóźwiak @madebyhex
 *
 * License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
 * SPDX-License-Identifier: CC-BY-NC-SA-4.0
 *
 * You are free to share and adapt this work under the terms of the license.
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */
import { FragCanvas, defineMaterial } from 'spektral/react';
import { fragment } from '../shader';

const material = defineMaterial({
	fragment
});

export default function App() {
	return (
		<FragCanvas
			material={material}
			color={{ outputEncoding: 'linear', dynamicRange: 'auto', canvasColorSpace: 'display-p3' }}
		/>
	);
}
