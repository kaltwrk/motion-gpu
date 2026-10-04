import { expect, it, vi } from 'vitest';
import {
	ActivePipelineCache,
	AsyncPipelineCache,
	PipelineKeyCache
} from '../../lib/core/renderer/pipeline-cache';

it('deduplicates asynchronous preparations, wakes active owners and caches failures', async () => {
	const wake = vi.fn();
	const cache = new AsyncPipelineCache<object>(2, wake);
	const owner = {};
	const entry = {};
	const build = vi.fn(async () => entry);
	expect(cache.get(owner, 'a', build)).toBeNull();
	expect(cache.get({}, 'a', build)).toBeNull();
	expect(build).toHaveBeenCalledOnce();
	await Promise.resolve();
	expect(wake).toHaveBeenCalledOnce();
	expect(cache.get(owner, 'a', build)).toBe(entry);
	const failure = new Error('compile failed');
	expect(
		cache.get(owner, 'b', async () => {
			throw failure;
		})
	).toBeNull();
	await Promise.resolve();
	expect(() => cache.get(owner, 'b', build)).toThrow(failure);
	expect(wake).toHaveBeenCalledTimes(2);
});

it.each(['removed', 'replaced', 'evicted', 'disposed'] as const)(
	'ignores late preparation notifications for %s owners',
	async (reason) => {
		const wake = vi.fn();
		const cache = new AsyncPipelineCache<object>(reason === 'replaced' ? 2 : 1, wake);
		const owner = {};
		let finish!: (value: object) => void;
		cache.get(
			owner,
			'old',
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		if (reason === 'removed') cache.retainOwners([]);
		if (reason === 'replaced' || reason === 'evicted')
			cache.get(owner, 'new', () => new Promise(() => {}));
		if (reason === 'disposed') cache.clear();
		finish({});
		await Promise.resolve();
		expect(wake).not.toHaveBeenCalled();
		cache.clear();
		const build = vi.fn(async () => ({}));
		expect(cache.get(owner, 'new', build)).toBeNull();
		expect(build).not.toHaveBeenCalled();
	}
);

it('does not let an evicted preparation overwrite a newer preparation of the same key', async () => {
	const wake = vi.fn();
	const cache = new AsyncPipelineCache<object>(1, wake);
	const owner = {};
	const pending: Array<(entry: object) => void> = [];
	const build = () => new Promise<object>((resolve) => pending.push(resolve));
	cache.get(owner, 'a', build);
	cache.get(owner, 'b', build);
	cache.get(owner, 'a', build);
	pending[0]!({ stale: true });
	await Promise.resolve();
	expect(wake).not.toHaveBeenCalled();
	expect(cache.get(owner, 'a', build)).toBeNull();
	const fresh = {};
	pending[2]!(fresh);
	await Promise.resolve();
	expect(wake).toHaveBeenCalledOnce();
	expect(cache.get(owner, 'a', build)).toBe(fresh);
});

it.each(['synchronous', 'asynchronous'] as const)(
	'normalizes and retains %s preparation errors',
	async (kind) => {
		const cache = new AsyncPipelineCache<object>(1, vi.fn());
		const owner = {};
		const build = vi.fn(() => {
			if (kind === 'synchronous') throw 'invalid pipeline';
			return Promise.reject('invalid pipeline');
		});
		if (kind === 'synchronous')
			expect(() => cache.get(owner, 'a', build)).toThrow('invalid pipeline');
		else expect(cache.get(owner, 'a', build)).toBeNull();
		await Promise.resolve();
		expect(() => cache.get(owner, 'a', build)).toThrow('invalid pipeline');
		expect(build).toHaveBeenCalledOnce();
	}
);

it('serializes pipeline keys only when scalar inputs change, with unambiguous boundaries', () => {
	const cache = new PipelineKeyCache();
	const owner = {};
	const parts = ['shader', 'x'.repeat(128 * 1024), 1];
	const stringify = vi.spyOn(JSON, 'stringify');
	try {
		const first = cache.get(owner, parts);
		for (let i = 0; i < 100; i++) expect(cache.get(owner, [...parts])).toBe(first);
		expect(stringify).toHaveBeenCalledOnce();
		parts[2] = 2;
		expect(cache.get(owner, parts)).not.toBe(first);
		expect(cache.get({}, ['a|b', 'c'])).not.toBe(cache.get({}, ['a', 'b|c']));
		expect(cache.get({}, ['1'])).not.toBe(cache.get({}, [1]));
		expect(cache.get(owner, ['shader'])).not.toBe(first);
	} finally {
		stringify.mockRestore();
	}
});

it('pins shared and oversized active sets while pruning inactive LRU history', () => {
	const cache = new ActivePipelineCache<object>(2);
	const owners = [{}, {}, {}];
	const values = [{}, {}, {}];
	for (let index = 0; index < owners.length; index += 1) {
		cache.use(owners[index]!, String(index));
		cache.set(String(index), values[index]!);
	}
	for (let index = 0; index < values.length; index += 1)
		expect(cache.peek(String(index))).toBe(values[index]);
	cache.retainOwners([owners[0]!, owners[1]!]);
	expect(cache.peek('2')).toBeUndefined();
	cache.use(owners[1]!, '0'); // two owners share one pipeline
	for (const key of ['3', '4', '5']) {
		cache.use(owners[2]!, key);
		cache.set(key, {});
	}
	expect(cache.peek('0')).toBe(values[0]);
	expect(cache.peek('1')).toBeUndefined();
	expect(cache.peek('3')).toBeUndefined();
	expect(cache.peek('4')).toBeUndefined();
	expect(cache.peek('5')).toBeDefined();
	cache.clear();
	expect(cache.peek('0')).toBeUndefined();
});

it('keeps recently used inactive entries within the history budget', () => {
	const cache = new ActivePipelineCache<number>(2);
	const owner = {};
	cache.use(owner, 'a');
	cache.set('a', 1);
	cache.use(owner, 'b');
	cache.set('b', 2);
	expect(cache.use(owner, 'a')).toBe(1);
	cache.use(owner, 'c');
	cache.set('c', 3);
	expect(cache.peek('a')).toBe(1);
	expect(cache.peek('b')).toBeUndefined();
	cache.retainOwners([]);
	cache.set('d', 4);
	expect(cache.peek('a')).toBeUndefined();
});
