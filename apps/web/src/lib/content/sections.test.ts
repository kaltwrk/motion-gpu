import { describe, expect, it } from 'vitest';
import { getNavigationGroups } from './docs';
import { parseContentSource } from './frontmatter';
import { flattenNavigationToManifest } from './manifest';
import { validateContentSections } from './validate';
import { contentSections } from '$lib/site/views';
import { playgroundPages } from '$lib/site/playground';
import { mergeSectionUiConfig, sectionUiDefaults } from '$lib/site/content-ui';
import {
	getContentSectionMetadata,
	getContentSectionModule,
	getContentSectionRawSource,
	getContentSectionByPathname,
	getContentSectionTocHeadings
} from './sections';

describe('configured content views', () => {
	it('keeps navigation, metadata and raw Markdown scoped to each view', () => {
		expect(
			getNavigationGroups('docs')
				.flatMap((group) => group.items)
				.every((item) => item.href.startsWith('/docs'))
		).toBe(true);
		expect(
			getNavigationGroups('playground')
				.flatMap((group) => group.items)
				.map((item) => item.href)
		).toEqual(playgroundPages.map(({ slug }) => (slug ? `/playground/${slug}` : '/playground')));
		expect(getContentSectionMetadata('docs', '/docs')?.sourceType).toBe('markdown');
		expect(getContentSectionMetadata('playground', '/playground')?.sourceType).toBe('svelte');
		expect(getContentSectionRawSource('playground', '')).toBeNull();
		expect(getContentSectionRawSource('docs', '')).toContain('title:');
	});

	it('loads MDX and custom Svelte pages and rejects unknown routes safely', async () => {
		expect((await getContentSectionModule('docs', ''))?.default).toBeTypeOf('function');
		for (const demo of playgroundPages) {
			expect((await getContentSectionModule('playground', demo.slug))?.default).toBeTypeOf(
				'function'
			);
			const href = demo.slug ? `/playground/${demo.slug}` : '/playground';
			expect(getContentSectionMetadata('playground', href)).toMatchObject({
				title: demo.title,
				description: demo.description,
				sourceType: 'svelte'
			});
		}
		expect(await getContentSectionModule('constructor', '')).toBeNull();
		expect(await getContentSectionModule('docs', 'missing')).toBeNull();
		expect(getContentSectionMetadata('constructor', '/constructor')).toBeNull();
		expect(getContentSectionByPathname('/docs-other')).toBeNull();
		expect(getContentSectionTocHeadings('docs', '', 'h2').length).toBeGreaterThan(0);
	});

	it('accepts new views and rejects route collisions before publishing', () => {
		const view = {
			...contentSections[0],
			id: 'examples',
			navigation: [{ slug: '', name: 'Examples' }]
		};
		expect(() => {
			validateContentSections([...contentSections, view]);
		}).not.toThrow();
		expect(() => {
			validateContentSections([view, view]);
		}).toThrow('Duplicate view id');
		expect(() => {
			validateContentSections([{ ...view, id: 'og' }]);
		}).toThrow('reserved view id');
		expect(() => {
			validateContentSections([{ ...view, navigation: [{ slug: 'raw/index', name: 'Reserved' }] }]);
		}).toThrow('reserved page slug');
		expect(() => {
			validateContentSections([{ ...view, navigation: [{ slug: 'example', name: 'No index' }] }]);
		}).toThrow('index page');
	});

	it('supports nested navigation and per-view overrides without mutating defaults', () => {
		const manifest = flattenNavigationToManifest([
			{
				slug: 'group',
				name: 'Guides',
				items: [
					{
						slug: 'nested',
						name: 'Nested',
						items: [{ slug: '', name: 'Start', showPagination: false }]
					}
				]
			}
		]);
		expect(manifest[0]).toMatchObject({ slug: '', category: 'Guides', showPagination: false });
		const ui = mergeSectionUiConfig({
			toc: { selectorOverrides: [] },
			search: { label: 'Find examples' }
		});
		expect(ui.toc.selectorOverrides).toEqual([]);
		expect(ui.search.label).toBe('Find examples');
		expect(ui.search.placeholder).toBe(sectionUiDefaults.search.placeholder);
		expect(sectionUiDefaults.toc.selectorOverrides).not.toEqual([]);
	});

	it('reads multiline YAML descriptions and quoted punctuation used by MDX authors', () => {
		const parsed = parseContentSource(
			'---\ntitle: "A: guide"\ndescription: >-\n  First line\n  second line.\n---\n\n## Heading'
		);
		expect(parsed.metadata).toMatchObject({
			title: 'A: guide',
			description: 'First line second line.'
		});
		expect(parsed.body).toBe('\n## Heading');
	});
});
