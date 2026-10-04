/** Avoids joining or hashing WGSL on every frame; retains one scalar snapshot per pass. */
export class PipelineKeyCache {
	private readonly owners = new WeakMap<
		object,
		{ parts: readonly (string | number)[]; key: string }
	>();

	get(owner: object, parts: readonly (string | number)[]): string {
		const previous = this.owners.get(owner);
		if (
			previous &&
			previous.parts.length === parts.length &&
			parts.every((part, index) => part === previous.parts[index])
		)
			return previous.key;
		const key = JSON.stringify(parts);
		this.owners.set(owner, { parts: [...parts], key });
		return key;
	}
}

/** LRU history with entries pinned by the passes that currently use them. */
export class ActivePipelineCache<T> {
	private readonly entries = new Map<string, T>();
	private readonly owners = new Map<object, string>();
	private readonly activeKeys = new Set<string>();

	constructor(private readonly capacity: number) {}

	retainOwners(owners: Iterable<object>): void {
		const retained = new Set(owners);
		for (const owner of this.owners.keys()) {
			if (!retained.has(owner)) this.owners.delete(owner);
		}
		this.prune();
	}

	use(owner: object, key: string): T | undefined {
		this.owners.set(owner, key);
		const value = this.entries.get(key);
		if (value !== undefined) {
			this.entries.delete(key);
			this.entries.set(key, value);
		}
		return value;
	}

	peek(key: string): T | undefined {
		return this.entries.get(key);
	}

	isActive(key: string): boolean {
		for (const activeKey of this.owners.values()) if (activeKey === key) return true;
		return false;
	}

	set(key: string, value: T): void {
		this.entries.delete(key);
		this.entries.set(key, value);
		this.prune();
	}

	clear(): void {
		this.entries.clear();
		this.owners.clear();
		this.activeKeys.clear();
	}

	private prune(): void {
		if (this.entries.size <= this.capacity) return;
		this.activeKeys.clear();
		for (const key of this.owners.values()) this.activeKeys.add(key);
		const limit = Math.max(this.capacity, this.activeKeys.size);
		for (const key of this.entries.keys()) {
			if (this.entries.size <= limit) break;
			if (!this.activeKeys.has(key)) this.entries.delete(key);
		}
	}
}

type AsyncPipelineState<T> =
	| { kind: 'pending' }
	| { kind: 'ready'; entry: T }
	| { kind: 'error'; error: Error };

/** Bounded preparation history with no optimistic use of unvalidated pipelines. */
export class AsyncPipelineCache<T> {
	private readonly cache: ActivePipelineCache<AsyncPipelineState<T>>;
	private disposed = false;

	constructor(
		capacity: number,
		private readonly requestRender: () => void
	) {
		this.cache = new ActivePipelineCache(capacity);
	}

	retainOwners(owners: Iterable<object>): void {
		this.cache.retainOwners(owners);
	}

	get(owner: object, key: string, prepare: () => Promise<T>): T | null {
		if (this.disposed) return null;
		const cached = this.cache.use(owner, key);
		if (cached?.kind === 'ready') return cached.entry;
		if (cached?.kind === 'error') throw cached.error;
		if (cached) return null;
		const pending: AsyncPipelineState<T> = { kind: 'pending' };
		this.cache.set(key, pending);
		const settle = (state: AsyncPipelineState<T>): void => {
			if (this.disposed || this.cache.peek(key) !== pending) return;
			this.cache.set(key, state);
			if (this.cache.isActive(key)) this.requestRender();
		};
		const failure = (error: unknown): Error =>
			error instanceof Error ? error : new Error(String(error));
		let preparation: Promise<T>;
		try {
			preparation = prepare();
		} catch (error) {
			const normalized = failure(error);
			this.cache.set(key, { kind: 'error', error: normalized });
			throw normalized;
		}
		void preparation.then(
			(entry) => settle({ kind: 'ready', entry }),
			(error) => settle({ kind: 'error', error: failure(error) })
		);
		return null;
	}

	clear(): void {
		this.disposed = true;
		this.cache.clear();
	}
}
