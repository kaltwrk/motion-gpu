import { expect, it } from 'vitest';
import { ActivePipelineCache } from '../../lib/core/renderer/pipeline-cache';

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
