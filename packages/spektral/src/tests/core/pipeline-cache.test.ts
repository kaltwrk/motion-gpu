import { expect, it, vi } from 'vitest';
import { ActivePipelineCache, PipelineKeyCache } from '../../lib/core/renderer/pipeline-cache';

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
