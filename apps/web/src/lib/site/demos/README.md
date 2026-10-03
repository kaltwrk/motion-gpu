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
- Register the demo ID, URL slug and title in `../playground.ts`. Its order there is its sidebar order.
- Add `../content/playground/<slug>.svelte`, following an existing entry such as `diamond.svelte`. Each page renders the shared `PlaygroundPage`; the editor is implemented once.
- Source files are discovered at build time. Every source folder must have a matching registration.
- Use an empty slug for the index demo and name its content page `index.svelte`.
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
