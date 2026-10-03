import { parse } from 'yaml';

export type ContentFrontmatter = { title?: string; name?: string; description?: string };
const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Parse YAML using the same syntax supported by mdsvex, including multiline descriptions. */
export function parseContentSource(rawSource: string): {
	metadata: ContentFrontmatter;
	body: string;
} {
	const match = FRONTMATTER_BLOCK_RE.exec(rawSource);
	if (!match) return { metadata: {}, body: rawSource };
	const value: unknown = parse(match[1]);
	const fields = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const text = (key: string) => (typeof fields[key] === 'string' ? fields[key] : undefined);
	return {
		metadata: { title: text('title'), name: text('name'), description: text('description') },
		body: rawSource.slice(match[0].length)
	};
}
