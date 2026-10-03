import type { ContentSectionConfig } from '$lib/site/views';
import { flattenNavigationToManifest } from './manifest';

const reservedSections = new Set([
	'og',
	'spektral',
	'favicon.svg',
	'site.webmanifest',
	'llms.txt',
	'robots.txt',
	'sitemap.xml'
]);
const reservedPageSegments = new Set(['og', 'raw', 'embed']);

/** Fail at startup/build time, before an invalid fork publishes broken links. */
export function validateContentSections(sections: readonly ContentSectionConfig[]) {
	if (!sections.length) throw new Error('Register at least one view in site/views.ts.');
	const ids = new Set<string>();
	for (const section of sections) {
		if (!/^[a-z][a-z0-9-]*$/.test(section.id) || reservedSections.has(section.id)) {
			throw new Error(`Invalid or reserved view id: ${section.id}`);
		}
		if (ids.has(section.id)) throw new Error(`Duplicate view id: ${section.id}`);
		ids.add(section.id);
		const slugs = new Set<string>();
		for (const item of flattenNavigationToManifest(section.navigation)) {
			if (
				item.slug &&
				(!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(item.slug) ||
					reservedPageSegments.has(item.slug.split('/')[0]) ||
					item.slug === 'index')
			) {
				throw new Error(`Invalid or reserved page slug: ${section.id}/${item.slug}`);
			}
			if (slugs.has(item.slug)) throw new Error(`Duplicate page slug: ${section.id}/${item.slug}`);
			slugs.add(item.slug);
		}
		if (!slugs.has(''))
			throw new Error(
				`View ${section.id} needs a navigation item with slug '' for its index page.`
			);
	}
}
