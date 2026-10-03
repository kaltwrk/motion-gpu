#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), '..');

const sourcePath = path.join(repoRoot, 'CHANGELOG.md');
const targetPath = path.join(
	repoRoot,
	'apps',
	'web',
	'src',
	'lib',
	'site',
	'content',
	'docs',
	'changelog.svx'
);
const checkOnly = process.argv.includes('--check');

function normalizeMarkdown(input) {
	return input.replace(/\r\n?/g, '\n').trim();
}

function stripTopHeading(markdown) {
	const lines = markdown.split('\n');
	if (lines[0]?.trim().toLowerCase() === '# changelog') {
		return lines.slice(1).join('\n').trimStart();
	}
	return markdown;
}

function markdownInlineToPlainText(value) {
	return value
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
}

function extractLeadDescription(markdown) {
	const lines = markdown.split('\n');
	const lead = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index].trim();
		if (line.length === 0) {
			index += 1;
			if (lead.length > 0) break;
			continue;
		}
		if (line.startsWith('## ')) break;
		lead.push(line);
		index += 1;
	}

	const description = markdownInlineToPlainText(lead.join(' '));
	const body = lines.slice(index).join('\n').trimStart();
	return { description, body };
}

async function main() {
	const rawSource = await readFile(sourcePath, 'utf8');
	const normalized = stripTopHeading(normalizeMarkdown(rawSource));
	const { description, body } = extractLeadDescription(normalized);
	const effectiveDescription =
		description.length > 0
			? description
			: 'Spektral release notes generated from the repository changelog.';

	const output = [
		'---',
		'title: Changelog',
		`description: ${effectiveDescription}`,
		'---',
		'',
		'> This page is auto-generated from `CHANGELOG.md` in the repository root.',
		'',
		body,
		''
	].join('\n');

	await mkdir(path.dirname(targetPath), { recursive: true });

	let current = null;
	try {
		current = await readFile(targetPath, 'utf8');
	} catch {
		// File does not exist yet.
	}

	if (current === output) {
		console.log('Changelog docs are up to date.');
		return;
	}

	if (checkOnly) {
		console.error('Changelog docs are stale. Run `pnpm run docs:changelog` and commit the result.');
		process.exitCode = 1;
		return;
	}

	await writeFile(targetPath, output, 'utf8');
	console.log(`Generated ${path.relative(repoRoot, targetPath)} from CHANGELOG.md`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
