import type { ContentItem } from '$lib/site/views';

export function flattenNavigationToManifest(
	items: ContentItem[],
	parentCategory?: string
): ContentItem[] {
	const manifest: ContentItem[] = [];

	for (const item of items) {
		const effectiveCategory = item.category ?? parentCategory;

		if (item.items?.length) {
			const childCategory = effectiveCategory ?? item.name;
			manifest.push(...flattenNavigationToManifest(item.items, childCategory));
			continue;
		}

		manifest.push({
			...item,
			slug: item.slug,
			name: item.name,
			category: effectiveCategory
		});
	}

	return manifest;
}

export function getItemBySlug(items: ContentItem[], slug: string) {
	return items.find((item) => item.slug === slug);
}

export function getAdjacentItems(items: ContentItem[], slug: string) {
	const index = items.findIndex((item) => item.slug === slug);
	if (index === -1) {
		return { previous: null, next: null };
	}

	const previous = index > 0 ? items[index - 1] : null;
	const next = index < items.length - 1 ? items[index + 1] : null;
	return { previous, next };
}

export function getHref(basePath: string, slug: string) {
	return slug ? `${basePath}/${slug}` : basePath;
}
