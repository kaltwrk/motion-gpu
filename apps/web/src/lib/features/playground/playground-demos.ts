import { getPlaygroundPages } from './playground-pages';
import { relocateDemoImports } from './playground-source-paths';

const playgroundPages = getPlaygroundPages();

export type PlaygroundFramework = 'svelte' | 'react' | 'vue';

type PlaygroundDemoVariant = {
	appSource: string;
	runtimeSource?: string;
	additionalFiles: Record<string, string>;
};

type PlaygroundDemoDefinition = {
	id: string;
	name: string;
	variants: Record<PlaygroundFramework, PlaygroundDemoVariant>;
};

const demoFileModules = import.meta.glob('/src/lib/site/demos/**/*', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

// The same studio source is editable in each demo, but maintained once in the repository.
const sharedFileModules = import.meta.glob('/src/lib/site/demo-shared/**/*', {
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

const buildVariant = (
	demoId: string,
	files: Record<string, string>,
	framework: PlaygroundFramework
): PlaygroundDemoVariant => {
	const sourceFiles = new Map<string, string>();
	const outputPaths = new Map<string, string>();
	const { appPath, runtimePath } = frameworkFiles[framework];
	const frameworkPrefix = `${framework}/`;
	const demoPrefix = `/src/lib/site/demos/${demoId}/`;
	const addFile = (path: string, source: string, outputPath: string) => {
		sourceFiles.set(path, source);
		outputPaths.set(path, `/src/${outputPath}`);
	};

	for (const [path, source] of Object.entries(sharedFileModules)) {
		const relativePath = path.slice('/src/lib/site/demo-shared/'.length);
		if (relativePath === 'README.md') continue;
		addFile(path, source, `shared/${relativePath}`);
	}

	for (const [relativePath, source] of Object.entries(files)) {
		if (relativePath === 'README.md') {
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

			addFile(`${demoPrefix}${relativePath}`, source, frameworkRelativePath);
			continue;
		}

		addFile(`${demoPrefix}${relativePath}`, source, relativePath);
	}

	const additionalFiles: Record<string, string> = {};
	let appSource = '';
	let runtimeSource: string | undefined;
	for (const [path, source] of sourceFiles) {
		const relocated = relocateDemoImports(source, path, outputPaths);
		if (path === `${demoPrefix}${appPath}`) appSource = relocated;
		else if (path === `${demoPrefix}${runtimePath}`) runtimeSource = relocated;
		else additionalFiles[outputPaths.get(path)!.slice('/src/'.length)] = relocated;
	}
	return { appSource, runtimeSource, additionalFiles };
};

const missingFrameworkVariants: string[] = [];

for (const id of Object.keys(demoFilesById)) {
	if (!playgroundPages.some((page) => page.id === id)) {
		throw new Error(`Add a content/playground page with data.demo: ${id}.`);
	}
}

export const playgroundDemos = playgroundPages
	.map<PlaygroundDemoDefinition | null>(({ id, title }) => {
		const files = demoFilesById[id] ?? {};
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
				buildVariant(id, files, framework)
			])
		) as Record<PlaygroundFramework, PlaygroundDemoVariant>;

		return {
			id,
			name: title,
			variants
		};
	})
	.filter((entry): entry is PlaygroundDemoDefinition => entry !== null);

if (missingFrameworkVariants.length > 0) {
	throw new Error(
		`Missing framework demo variants:\n${missingFrameworkVariants
			.map((entry) => `- ${entry}`)
			.join('\n')}`
	);
}

const playgroundDemosById = Object.fromEntries(
	playgroundDemos.map((demo) => [demo.id, demo])
) as Record<string, PlaygroundDemoDefinition>;

const defaultPlaygroundDemoId = playgroundDemos[0]?.id ?? '';

export const resolvePlaygroundDemoId = (value: string | null | undefined) =>
	value && value in playgroundDemosById ? value : defaultPlaygroundDemoId;

export const getPlaygroundDemoById = (id: string) => playgroundDemosById[id] ?? null;

export const getPlaygroundDemoVariant = (demoId: string, framework: PlaygroundFramework) => {
	const demo = getPlaygroundDemoById(demoId);
	if (!demo) return null;
	return demo.variants[framework] ?? null;
};
