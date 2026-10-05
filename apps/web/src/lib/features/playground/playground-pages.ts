import { getContentSectionPages } from '$lib/content/sections';

/** Demo metadata belongs to its content page; the editor only projects that catalog. */
export function getPlaygroundPages() {
	const ids = new Set<string>();
	return getContentSectionPages('playground').flatMap((page) => {
		const id = page.metadata.data?.demo;
		// The section index can be an empty workspace without a demo.
		if (page.slug === '' && id === undefined) return [];
		if (typeof id !== 'string' || !id) throw new Error(`Missing data.demo in ${page.path}.`);
		if (ids.has(id)) throw new Error(`Duplicate playground demo ${id} in ${page.path}.`);
		ids.add(id);
		return [
			{
				id,
				slug: page.slug,
				title: page.metadata.title ?? page.name,
				description: page.metadata.description
			}
		];
	});
}
