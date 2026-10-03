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
- Add `../content/playground/<slug>.svelte`, following `diamond.svelte`. Export its title, description, `order` and `data.demo` in `metadata`. Pass the demo ID and title to the shared `PlaygroundPage`. The filename defines the URL; no separate registration is needed.
- Source files are discovered at build time. Every source folder must have a matching content page.
- Name the index demo's page `index.svelte`; its metadata also configures the Playground view.
- All framework variants are required for every demo (`svelte`, `react`, `vue`).

Example:

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
