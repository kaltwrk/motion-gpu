export type PlaygroundFramework = 'svelte' | 'react' | 'vue';

export type PlaygroundDemoVariant = {
	appSource: string;
	runtimeSource?: string;
	additionalFiles: Record<string, string>;
};

export type PlaygroundDemoDefinition = {
	id: string;
	name: string;
	variants: Record<PlaygroundFramework, PlaygroundDemoVariant>;
};

const demoFileModules = import.meta.glob('/src/lib/site/demos/**/*', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const frameworkFiles: Record<
	PlaygroundFramework,
	{
		appPath: string;
		runtimePath: string;
	}
> = {
	svelte: {
		appPath: 'svelte/App.svelte',
		runtimePath: 'svelte/runtime.svelte'
	},
	react: {
		appPath: 'react/App.tsx',
		runtimePath: 'react/runtime.tsx'
	},
	vue: {
		appPath: 'vue/App.vue',
		runtimePath: 'vue/runtime.vue'
	}
};

const variantRoots = new Set(Object.keys(frameworkFiles));

const toStartCase = (value: string) =>
	value
		.split('-')
		.filter(Boolean)
		.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
		.join(' ');

const getDemoFileInfoFromPath = (path: string) => {
	const match = path.match(/\/demos\/([^/]+)\/(.+)$/);
	if (!match) return null;
	return {
		id: match[1] ?? null,
		relativePath: match[2] ?? null
	};
};

const demoFilesById = Object.entries(demoFileModules).reduce<
	Record<string, Record<string, string>>
>((acc, [path, source]) => {
	const info = getDemoFileInfoFromPath(path);
	if (!info?.id || !info.relativePath) {
		return acc;
	}

	const existing = acc[info.id] ?? {};
	existing[info.relativePath] = source;
	acc[info.id] = existing;
	return acc;
}, {});

const buildVariantAdditionalFiles = (
	files: Record<string, string>,
	framework: PlaygroundFramework
): Record<string, string> => {
	const output: Record<string, string> = {};
	const { appPath, runtimePath } = frameworkFiles[framework];
	const frameworkPrefix = `${framework}/`;

	for (const [relativePath, source] of Object.entries(files)) {
		if (relativePath === appPath || relativePath === runtimePath || relativePath === 'README.md') {
			continue;
		}

		const [firstSegment] = relativePath.split('/');
		if (firstSegment && variantRoots.has(firstSegment)) {
			if (!relativePath.startsWith(frameworkPrefix)) {
				continue;
			}

			const frameworkRelativePath = relativePath.slice(frameworkPrefix.length);
			if (!frameworkRelativePath) {
				continue;
			}

			output[frameworkRelativePath] = source;
			continue;
		}

		output[relativePath] = source;
	}

	return output;
};

const missingFrameworkVariants: string[] = [];

const playgroundDemosUnsorted = Object.entries(demoFilesById)
	.map<PlaygroundDemoDefinition | null>(([id, files]) => {
		const missingForDemo: PlaygroundFramework[] = [];
		for (const framework of Object.keys(frameworkFiles) as PlaygroundFramework[]) {
			if (!(frameworkFiles[framework].appPath in files)) {
				missingForDemo.push(framework);
			}
		}

		if (missingForDemo.length > 0) {
			missingFrameworkVariants.push(`${id}: ${missingForDemo.join(', ')}`);
			return null;
		}

		const variants = Object.fromEntries(
			(Object.keys(frameworkFiles) as PlaygroundFramework[]).map((framework) => [
				framework,
				{
					appSource: files[frameworkFiles[framework].appPath]!,
					runtimeSource: files[frameworkFiles[framework].runtimePath],
					additionalFiles: buildVariantAdditionalFiles(files, framework)
				}
			])
		) as Record<PlaygroundFramework, PlaygroundDemoVariant>;

		return {
			id,
			name: toStartCase(id),
			variants
		};
	})
	.filter((entry): entry is PlaygroundDemoDefinition => entry !== null);

export const playgroundDemos = playgroundDemosUnsorted.sort((left, right) =>
	left.name.localeCompare(right.name)
);

if (missingFrameworkVariants.length > 0) {
	throw new Error(
		`Missing framework demo variants:\n${missingFrameworkVariants
			.map((entry) => `- ${entry}`)
			.join('\n')}`
	);
}

if (playgroundDemos.length === 0) {
	throw new Error('No playground demos found in ./demos/**');
}

const playgroundDemosById = Object.fromEntries(
	playgroundDemos.map((demo) => [demo.id, demo])
) as Record<string, PlaygroundDemoDefinition>;

export const defaultPlaygroundDemoId = playgroundDemos[0]!.id;

export const resolvePlaygroundDemoId = (value: string | null | undefined) =>
	value && value in playgroundDemosById ? value : defaultPlaygroundDemoId;

export const getPlaygroundDemoById = (id: string) => playgroundDemosById[id] ?? null;

export const getPlaygroundDemoVariant = (demoId: string, framework: PlaygroundFramework) => {
	const demo = getPlaygroundDemoById(demoId);
	if (!demo) return null;
	return demo.variants[framework] ?? null;
};
