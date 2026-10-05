const normalizePath = (path: string) => {
	const parts: string[] = [];
	for (const part of path.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}
	return `/${parts.join('/')}`;
};

const relativePath = (fromFile: string, toFile: string) => {
	const from = fromFile.split('/').slice(0, -1);
	const to = toFile.split('/');
	while (from.length && to.length && from[0] === to[0]) {
		from.shift();
		to.shift();
	}
	const path = [...from.map(() => '..'), ...to].join('/');
	return path.startsWith('.') ? path : `./${path}`;
};

/** Preserve normal repository imports when framework entries move into the editor's src/. */
export function relocateDemoImports(
	source: string,
	filePath: string,
	outputPaths: ReadonlyMap<string, string>
) {
	const destination = outputPaths.get(filePath);
	if (!destination) return source;
	return source.replace(
		/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.[^'"\n]+)\2/g,
		(full, prefix: string, quote: string, specifier: string) => {
			const queryStart = specifier.indexOf('?');
			const path = queryStart < 0 ? specifier : specifier.slice(0, queryStart);
			const query = queryStart < 0 ? '' : specifier.slice(queryStart);
			const absolutePath = normalizePath(`${filePath.slice(0, filePath.lastIndexOf('/'))}/${path}`);
			const resolved = [absolutePath, ...['.ts', '.tsx', '.js'].map((ext) => absolutePath + ext)]
				.map((candidate) => outputPaths.get(candidate))
				.find(Boolean);
			if (!resolved) return full;
			return `${prefix}${quote}${relativePath(destination, resolved)}${query}${quote}`;
		}
	);
}
