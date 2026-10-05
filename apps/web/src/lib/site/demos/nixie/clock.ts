export type NixieDigits = [number, number, number, number, number, number];
export type NixieMode = 'time' | 'date';

export function readNixieDigits(date: Date, mode: NixieMode): NixieDigits {
	const values =
		mode === 'time'
			? [date.getHours(), date.getMinutes(), date.getSeconds()]
			: [date.getDate(), date.getMonth() + 1, date.getFullYear() % 100];
	return values.flatMap((value) => [Math.floor(value / 10), value % 10]) as NixieDigits;
}

/** Local wall time selects cathodes; frame delta only controls their 120 ms crossfade. */
export function createNixieClock(date = new Date()) {
	let mode: NixieMode = 'time';
	let digits = readNixieDigits(date, mode);
	let previous: NixieDigits = [...digits];
	const progress: NixieDigits = [1, 1, 1, 1, 1, 1];
	const sample = (date: Date) => {
		const next = readNixieDigits(date, mode);
		let changed = false;
		for (let index = 0; index < 6; index++) {
			if (next[index] === digits[index]) continue;
			// A fast mode reversal starts from the cathode that is currently brighter.
			previous[index] = progress[index]! < 0.5 ? previous[index]! : digits[index]!;
			progress[index] = 0;
			changed = true;
		}
		digits = next;
		return changed;
	};
	return {
		get mode() {
			return mode;
		},
		get animating() {
			return progress.some((value) => value < 1);
		},
		get state() {
			return {
				digits: [...digits] as NixieDigits,
				previous: [...previous] as NixieDigits,
				mix: progress.map((value) => value * value * (3 - 2 * value)) as NixieDigits
			};
		},
		sample,
		toggleMode(date: Date) {
			mode = mode === 'time' ? 'date' : 'time';
			return sample(date);
		},
		advance(delta: number) {
			const step = Math.max(0, Number.isFinite(delta) ? delta : 0) / 0.12;
			for (let index = 0; index < 6; index++)
				progress[index] = Math.min(1, progress[index]! + step);
		}
	};
}
