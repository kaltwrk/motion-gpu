/** CPU state changed while encoding must follow the fate of the command buffer. */
export class FrameStateTransaction {
	private readonly undo: Array<() => void> = [];
	private readonly submitted: Array<() => void> = [];

	capture<T extends object>(state: T): void {
		const previous = { ...state };
		this.undo.push(() => {
			Object.assign(state, previous);
		});
	}

	afterSubmit(callback: () => void): void {
		this.submitted.push(callback);
	}

	commit(): void {
		this.undo.length = 0;
		for (const callback of this.submitted) callback();
		this.submitted.length = 0;
	}

	rollback(): void {
		for (let index = this.undo.length - 1; index >= 0; index -= 1) this.undo[index]!();
		this.undo.length = 0;
		this.submitted.length = 0;
	}
}
