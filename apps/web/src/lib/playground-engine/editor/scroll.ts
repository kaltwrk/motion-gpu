import { ViewPlugin, type EditorView } from '@codemirror/view';

class SynchronizedEditorScroll {
	private appliedLeft: number;
	private appliedTop: number;
	private remainderX = 0;
	private remainderY = 0;

	constructor(private readonly view: EditorView) {
		this.appliedLeft = view.scrollDOM.scrollLeft;
		this.appliedTop = view.scrollDOM.scrollTop;
		view.scrollDOM.addEventListener('wheel', this.onWheel, { passive: false });
	}

	private onWheel = (event: WheelEvent) => {
		// Ctrl+wheel includes trackpad pinch zoom. Leave browser zoom and handled events alone.
		if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey) return;

		const { scrollDOM } = this.view;
		const left = scrollDOM.scrollLeft;
		const top = scrollDOM.scrollTop;
		if (left !== this.appliedLeft) this.remainderX = 0;
		if (top !== this.appliedTop) this.remainderY = 0;

		let deltaX = event.deltaX;
		let deltaY = event.deltaY;
		if (event.shiftKey && deltaX === 0) {
			deltaX = deltaY;
			deltaY = 0;
		}
		if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
			deltaX *= this.view.defaultCharacterWidth;
			deltaY *= this.view.defaultLineHeight;
		} else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
			deltaX *= scrollDOM.clientWidth;
			deltaY *= scrollDOM.clientHeight;
		}

		const nextLeft = Math.max(
			0,
			Math.min(
				scrollDOM.scrollWidth - scrollDOM.clientWidth,
				left + (deltaX === 0 ? 0 : deltaX + this.remainderX)
			)
		);
		const nextTop = Math.max(
			0,
			Math.min(
				scrollDOM.scrollHeight - scrollDOM.clientHeight,
				top + (deltaY === 0 ? 0 : deltaY + this.remainderY)
			)
		);
		if (nextLeft === left && nextTop === top) {
			// Keep a scrollable editor's gesture at its boundary too: otherwise Chromium can
			// make the rest of the wheel sequence noncancelable, including a direction change.
			if (
				(deltaX !== 0 && scrollDOM.scrollWidth > scrollDOM.clientWidth) ||
				(deltaY !== 0 && scrollDOM.scrollHeight > scrollDOM.clientHeight)
			) {
				event.preventDefault();
			}
			return;
		}

		event.preventDefault();
		scrollDOM.scrollTo({ left: nextLeft, top: nextTop, behavior: 'instant' });
		this.appliedLeft = scrollDOM.scrollLeft;
		this.appliedTop = scrollDOM.scrollTop;
		// Preserve subpixel trackpad deltas when the browser rounds scroll offsets.
		if (deltaX !== 0) this.remainderX = nextLeft - this.appliedLeft;
		if (deltaY !== 0) this.remainderY = nextTop - this.appliedTop;

		if (this.appliedLeft !== left || this.appliedTop !== top) {
			// Native wheel scrolling can move the compositor past CodeMirror's rendered lines
			// before delivering a scroll event. Notify its scroll observer synchronously so
			// the viewport and scroll offset are committed together, as with scrollbar dragging.
			scrollDOM.dispatchEvent(new Event('scroll'));
		}
	};

	destroy() {
		this.view.scrollDOM.removeEventListener('wheel', this.onWheel);
	}
}

export const synchronizedEditorScroll = ViewPlugin.fromClass(SynchronizedEditorScroll);
