import { describe, expect, it } from 'vitest';
import { buildContentRegistry, type ContentSource } from './registry';
import { parseContentMetadata, parseContentSource } from './frontmatter';

const file = (path: string, metadata: unknown = {}): ContentSource => ({ path, metadata });

describe('file-based content registry', () => {
	it('discovers views, nested routes, folder indexes and pathless groups in author-defined order', () => {
		const sources = [
			file('examples/index.svelte', {
				view: { order: 20, layout: 'workspace', icon: 'TerminalIcon' }
			}),
			file('docs/index.mdx', { title: 'Welcome', view: { label: 'Documentation', order: 0 } }),
			file('docs/compute/storage-buffers.svx', {
				title: 'Storage buffers',
				order: 20,
				sidebar: { label: 'Buffers' }
			}),
			file('docs/compute/index.svx', {
				title: 'Compute overview',
				group: { label: 'GPU compute', order: 10 }
			}),
			file('docs/compute/setup.svx', { order: 10 }),
			file('docs/(advanced)/_meta.svx', { group: { label: 'Advanced', order: 30 } }),
			file('docs/(advanced)/profiling.svx', { title: 'Profiling' }),
			file('docs/compute/patterns/batching.md')
		];
		const views = buildContentRegistry(sources);
		expect(views.map(({ id }) => id)).toEqual(['docs', 'examples']);
		expect(views[0].label).toBe('Documentation');
		expect(views[0].pages.map(({ slug }) => slug)).toEqual([
			'',
			'compute',
			'compute/setup',
			'compute/storage-buffers',
			'compute/patterns/batching',
			'profiling'
		]);
		expect(views[0].pages.find(({ slug }) => slug === 'compute/storage-buffers')).toMatchObject({
			path: 'docs/compute/storage-buffers.svx',
			name: 'Buffers',
			category: 'GPU compute',
			sourceType: 'markdown'
		});
		expect(views[0].pages.find(({ slug }) => slug === 'compute/patterns/batching')?.category).toBe(
			'GPU compute / Patterns'
		);
		expect(views[0].pages.at(-1)?.category).toBe('Advanced');
		expect(views[1]).toMatchObject({ layout: 'workspace', icon: 'TerminalIcon' });
		expect(buildContentRegistry([...sources].reverse())).toEqual(views);
	});

	it('keeps pages together and distinguishes folders with the same display label', () => {
		const [view] = buildContentRegistry([
			file('docs/index.svx', { group: { label: 'Guides' } }),
			file('docs/later.svx', { order: 100 }),
			file('docs/nested/index.svx', { group: { label: 'Guides', order: 0 } }),
			file('docs/nested/setup.svx')
		]);
		expect(view.pages.map(({ slug }) => slug)).toEqual(['', 'later', 'nested', 'nested/setup']);
		expect(view.pages[0].category).toBe(view.pages[2].category);
		expect(view.pages[0].categoryId).not.toBe(view.pages[2].categoryId);
	});

	it('keeps hidden pages routable and uses one schema for Markdown and Svelte metadata', () => {
		const { metadata } = parseContentSource(
			'---\ntitle: Hidden example\nsidebar:\n  hidden: true\nshowPagination: false\ndata:\n  demo: diamond\n---\n'
		);
		const views = buildContentRegistry([
			file('examples/index.svx'),
			file('examples/hidden.svelte', metadata)
		]);
		expect(views[0].pages[1]).toMatchObject({
			slug: 'hidden',
			sidebarHidden: true,
			showPagination: false,
			metadata: { data: { demo: 'diamond' } }
		});
	});

	it.each([
		[
			'same route from file and directory',
			[file('docs/index.svx'), file('docs/guide.svx'), file('docs/guide/index.md')],
			'Duplicate route'
		],
		['two source formats', [file('docs/index.mdx'), file('docs/index.svelte')], 'Duplicate page'],
		[
			'pathless route collision',
			[file('docs/index.svx'), file('docs/topic.md'), file('docs/(group)/topic.svx')],
			'Duplicate route'
		],
		['reserved view', [file('og/index.svx')], 'reserved view'],
		['reserved page', [file('docs/index.svx'), file('docs/raw/setup.svx')], 'reserved page'],
		['missing landing page', [file('examples/setup.svx')], 'root index'],
		[
			'misplaced view',
			[file('docs/index.svx'), file('docs/setup.svx', { view: {} })],
			'root index'
		],
		[
			'misplaced group',
			[file('docs/index.svx'), file('docs/setup.svx', { group: {} })],
			'index or _meta'
		],
		[
			'ambiguous group',
			[file('docs/index.svx', { group: {} }), file('docs/_meta.svx', { group: {} })],
			'only once'
		],
		[
			'metadata with page fields',
			[file('docs/index.svx'), file('docs/_meta.svx', { title: 'Hidden content' })],
			'Only group'
		]
	])('rejects %s with a useful error', (_name, sources, error) => {
		expect(() => buildContentRegistry(sources)).toThrow(error);
	});

	it.each([
		[{ order: 'first' }, 'order must be a number'],
		[{ sidebar: { hidden: 'false' } }, 'sidebar.hidden must be a boolean'],
		[{ name: 'Old alias' }, 'Unknown metadata field'],
		[{ view: { layout: 'full' } }, 'layout must be article or workspace'],
		[{ view: { ui: { toc: { enabled: false } } } }, 'Unknown metadata field'],
		[{ view: { ui: { search: { enabled: 'yes' } } } }, 'enabled must be a boolean'],
		[{ view: { ui: { toc: { selectorOverrides: [{ selector: 'h2' }] } } } }, 'slugPrefix'],
		[{ data: { callback: () => true } }, 'serializable data']
	])('validates metadata and UI override types', (metadata, error) => {
		expect(() => parseContentMetadata(metadata, 'examples/index.svx')).toThrow(error);
	});

	it('retains multiline YAML, nested UI overrides and custom page data', () => {
		const parsed = parseContentSource(
			'---\ntitle: "A: guide"\ndescription: >-\n  First line\n  second line.\nview:\n  ui:\n    search:\n      label: Find patterns\ndata:\n  tags: [gpu, shader]\n---\n\n## Heading'
		);
		expect(parsed.metadata).toMatchObject({
			title: 'A: guide',
			description: 'First line second line.',
			view: { ui: { search: { label: 'Find patterns' } } },
			data: { tags: ['gpu', 'shader'] }
		});
		expect(parsed.body).toBe('\n## Heading');
	});
});
