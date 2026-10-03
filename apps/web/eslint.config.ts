import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import path from 'node:path';
import prettier from 'eslint-config-prettier';
import { includeIgnoreFile } from 'eslint/config';
import { defineConfig } from 'eslint/config';
import {
	createSharedBaseLanguageConfig,
	createSharedPrettierConfigs,
	createSharedRecommendedConfigs,
	createSharedSvelteLanguageConfig,
	createSharedSvelteRecommendedConfigs
} from '../../scripts/eslint/shared-preset.mjs';
import svelteConfig from './svelte.config';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');
const lintSvelteConfig = {
	...svelteConfig,
	kit: svelteConfig.kit
		? {
				...svelteConfig.kit,
				typescript: undefined
			}
		: undefined
};

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	createSharedRecommendedConfigs({
		js,
		typescriptConfigs: [ts.configs.strictTypeChecked, ts.configs.stylisticTypeChecked]
	}),
	createSharedSvelteRecommendedConfigs({ svelte }),
	createSharedPrettierConfigs({ prettier, svelte }),
	createSharedBaseLanguageConfig({
		globals,
		projectService: true,
		tsconfigRootDir: import.meta.dirname
	}),
	createSharedSvelteLanguageConfig({
		svelteConfig: lintSvelteConfig,
		ts,
		tsconfigRootDir: import.meta.dirname
	}),
	{
		...ts.configs.disableTypeChecked,
		// Keep imported Godsend components and official CLI output unchanged;
		// svelte-check validates their types with the rest of the application.
		files: [
			'src/lib/components/ui/*/**',
			'src/lib/hooks/**',
			'src/lib/icons/**',
			'src/lib/features/docs/**',
			'src/lib/components/action-tooltip/**',
			'src/lib/components/code-block/**',
			'src/lib/components/copy-feedback/**',
			'src/lib/components/icon-transition/**',
			'src/lib/components/theme-toggle/**',
			'src/lib/components/app-sidebar.svelte',
			'src/lib/components/nav-*.svelte',
			'src/lib/components/layout/**',
			'src/lib/site/actions.ts',
			'src/lib/site/keyboard-shortcuts.ts',
			'src/lib/utils.ts'
		],
		rules: {
			...ts.configs.disableTypeChecked.rules,
			'@typescript-eslint/array-type': 'off',
			'@typescript-eslint/consistent-indexed-object-style': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-empty-function': 'off',
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		...ts.configs.disableTypeChecked,
		files: ['scripts/**/*.mjs']
	},
	{
		ignores: [
			'src/lib/playground-engine/**',
			'src/playground-demo-shims.d.ts',
			'src/lib/site/demos/**',
			'src/lib/features/playground/runtime-template/**'
		]
	},
	{
		...ts.configs.disableTypeChecked,
		files: [
			'src/lib/features/playground/**',
			'src/lib/site/content/playground/index.svelte',
			'src/routes/playground/**'
		],
		rules: {
			...ts.configs.disableTypeChecked.rules,
			'@typescript-eslint/array-type': 'off',
			'@typescript-eslint/consistent-indexed-object-style': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/prefer-for-of': 'off',
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['@lucide/*', 'lucide', 'lucide-*', 'lucide-*/**'],
							message:
								'Use vendored Nucleo UI Outline 18 icons from $lib/icons. Lucide is not allowed.'
						}
					]
				}
			],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_'
				}
			],
			'@typescript-eslint/consistent-type-definitions': ['warn', 'type']
		}
	}
);
