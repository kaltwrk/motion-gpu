/** Counts delivered RAF callbacks without scheduling work in the isolated perf page. */
export function observeAnimationFrames(onFrame: () => void): () => void {
	const original = window.requestAnimationFrame;
	let active = true;
	const observed: typeof requestAnimationFrame = (callback) =>
		original.call(window, (time) => {
			if (active) onFrame();
			callback(time);
		});
	window.requestAnimationFrame = observed;
	return () => {
		active = false;
		if (window.requestAnimationFrame === observed) window.requestAnimationFrame = original;
	};
}
