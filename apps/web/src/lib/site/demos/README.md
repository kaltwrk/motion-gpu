# Playground demos

Add a new demo by creating a folder in this directory:

- `demos/<demo-id>/svelte/App.svelte` (required, Svelte variant)
- `demos/<demo-id>/svelte/runtime.svelte` (optional, Svelte runtime helpers)
- `demos/<demo-id>/react/App.tsx` (required, React variant)
- `demos/<demo-id>/react/runtime.tsx` (optional, React runtime helpers)
- `demos/<demo-id>/vue/App.vue` (required, Vue variant)
- `demos/<demo-id>/vue/runtime.vue` (optional, Vue runtime helpers)
- `demos/<demo-id>/<any-file>` (optional shared file; loaded as `src/<any-file>`)
- `demos/<demo-id>/shaders/**/*.wgsl` (preferred shared WGSL shader/include files; import from every variant with `?raw`)
- `demos/<demo-id>/<framework>/<any-file>` (optional framework-specific file; loaded as `src/<any-file>` for that framework)
- `demos/<demo-id>/<framework>/shaders/**/*.wgsl` (optional framework-specific WGSL shader/include files; use only when variants need different shader code)

Rules:

- `<demo-id>` should be kebab-case (for example `flow-field`).
- Add `../content/playground/<slug>.svelte`, exporting the metadata shown below. Export its title, description, `order` and `data.demo` in `metadata`. Pass the demo ID and title to the shared `PlaygroundPage`. The filename defines the URL; no separate registration is needed.
- Source files are discovered at build time. Every source folder must have a matching content page.
- `index.svelte` configures the Playground view and can remain an empty workspace without `data.demo`.
- All framework variants are required for every demo (`svelte`, `react`, `vue`).
- Common camera, studio lighting and shading live in `../demo-shared/`. The loader
  includes those files as `src/shared/` in every demo; do not copy the studio into
  individual demo folders.
- Use relative imports that resolve on disk (for example `../material` from a
  framework entry, or `../../demo-shared/studio.wgsl?raw` from the demo root).
  The loader relocates those imports when constructing the editor's file tree.

Example page metadata (in a `<script module lang="ts">` block):

```ts
import type { ContentFrontmatter } from '$lib/content/types';

export const metadata = {
	title: 'Flow Field',
	description: 'Describe the API concept demonstrated here.',
	order: 10,
	data: { demo: 'flow-field' }
} satisfies ContentFrontmatter;
```

Import `PlaygroundPage` from `$lib/features/playground/PlaygroundPage.svelte` in
an instance script, then render
`<PlaygroundPage demoId={metadata.data.demo} title={metadata.title} />`.

Example directory:

```
demos/
  flow-field/
    svelte/
      App.svelte
      runtime.svelte
    react/
      App.tsx
      runtime.tsx
    vue/
      App.vue
      runtime.vue
    shaders/
      fragment.wgsl
    shader.ts
```
