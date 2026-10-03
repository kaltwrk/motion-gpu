import { describe, expect, it } from 'vitest';
import { getNavigationGroups } from './docs';
import { getPlaygroundPages } from '$lib/features/playground/playground-pages';
import { mergeSectionUiConfig, sectionUiDefaults } from '$lib/site/content-ui';
import {
	contentSections,
	getContentSectionPages,
	getContentSectionManifest,
	getContentSectionMetadata,
	getContentSectionModule,
	getContentSectionRawSource,
	getContentSectionByPathname,
	getContentSectionTocHeadings,
	getContentSectionAdjacentItems
} from './sections';

describe('discovered content views', () => {
	it('preserves existing docs URLs, groups and order after moving files', () => {
		expect(contentSections.map(({ id }) => id)).toEqual(['docs', 'playground']);
		expect(getNavigationGroups('docs').map(({ title }) => title)).toEqual([
			'Getting Started',
			'Core Concepts',
			'Rendering',
			'Compute',
			'Shaders & Textures',
			'Integrations',
			'API Reference',
			'Advanced'
		]);
		const pages = getContentSectionManifest('docs');
		expect(pages).toHaveLength(27);
		expect(pages.slice(0, 3).map(({ slug }) => slug)).toEqual([
			'',
			'getting-started',
			'concepts-and-architecture'
		]);
		expect(pages.every(({ slug }) => !slug.includes('(') && !slug.includes('_meta'))).toBe(true);
		expect(getContentSectionAdjacentItems('docs', 'storage-buffers')).toMatchObject({
			previous: { slug: 'compute-shaders' },
			next: { slug: 'writing-shaders' }
		});
		expect(getContentSectionMetadata('docs', '/docs/storage-buffers')?.title).toBeTruthy();
	});

	it('derives every playground entry from its Svelte page metadata', () => {
		const demos = getPlaygroundPages();
		expect(demos).toHaveLength(11);
		expect(demos[0]).toMatchObject({ id: 'spektral-logo', slug: '', title: 'Spektral Logo' });
		expect(
			getNavigationGroups('playground')
				.flatMap((group) => group.items)
				.map(({ href }) => href)
		).toEqual(demos.map(({ slug }) => (slug ? `/playground/${slug}` : '/playground')));
		expect(contentSections.find(({ id }) => id === 'playground')).toMatchObject({
			layout: 'workspace',
			ui: { search: { enabled: false } }
		});
	});

	it('loads all discovered modules and raw sources with their actual source paths', async () => {
		for (const section of contentSections)
			for (const page of getContentSectionPages(section.id)) {
				expect((await getContentSectionModule(section.id, page.slug))?.default).toBeTypeOf(
					'function'
				);
				const href = `/${section.id}${page.slug ? `/${page.slug}` : ''}`;
				expect(getContentSectionMetadata(section.id, href)).toMatchObject({
					title: page.metadata.title,
					sourceType: page.sourceType
				});
				if (page.sourceType === 'markdown')
					expect(getContentSectionRawSource(section.id, page.slug)).toContain('title:');
				else expect(getContentSectionRawSource(section.id, page.slug)).toBeNull();
			}
		expect(getContentSectionTocHeadings('docs', '', 'h2').length).toBeGreaterThan(0);
	});

	it('rejects unknown paths, cross-view metadata lookups and metadata-only files', async () => {
		expect(await getContentSectionModule('constructor', '')).toBeNull();
		expect(await getContentSectionModule('docs', 'missing')).toBeNull();
		expect(await getContentSectionModule('docs', '(compute)/_meta')).toBeNull();
		expect(getContentSectionMetadata('constructor', '/constructor')).toBeNull();
		expect(getContentSectionMetadata('docs', '/playground')).toBeNull();
		expect(getContentSectionByPathname('/docs-other')).toBeNull();
	});

	it('merges per-view UI overrides without mutating defaults', () => {
		const ui = mergeSectionUiConfig({
			toc: { selectorOverrides: [] },
			search: { label: 'Find examples' }
		});
		expect(ui.toc.selectorOverrides).toEqual([]);
		expect(ui.search.label).toBe('Find examples');
		expect(ui.search.placeholder).toBe(sectionUiDefaults.search.placeholder);
		expect(sectionUiDefaults.toc.selectorOverrides).not.toEqual([]);
	});
});
