# Configure a fork

This folder owns the website's identity, interface copy, views, content and demos.
Start with `site.ts` and `views.ts`. The runtime in `lib/content`, `lib/features`
and `lib/components` reads these files; there is no second configuration layer.

| File or folder          | What to change                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `site.ts`               | Name, canonical URL, author, SEO description, social links, package name, home link, app icons, legacy redirects and preview origin |
| `views.ts`              | Views in the sidebar dropdown, their routes, icons, descriptions, navigation and UI overrides                                       |
| `content-ui.ts`         | Search labels and limits, sidebar links, TOC, page actions, pagination, preference defaults and storage keys                        |
| `labels.ts`             | Shared labels, tooltips, copy feedback and playground hints                                                                         |
| `actions.ts`            | Assistant/IDE/builder links, icons, labels, prompts and URL templates                                                               |
| `keyboard-shortcuts.ts` | Shortcuts and their displayed/accessibility labels                                                                                  |
| `playground.ts`         | Playground demo labels, sidebar order, routes and page metadata                                                                     |
| `theme.css`             | Font, colors, spacing tokens, radii and shadows; OG images read the same color tokens                                               |
| `assets/`               | Logo, app icons and their source notices                                                                                            |
| `content/<view>/`       | Markdown and Svelte pages                                                                                                           |
| `demos/<demo>/`         | Editable playground examples and their source files                                                                                 |

Use distinct storage keys in a fork. This keeps theme, framework and package-manager
preferences separate from another site on the same origin. The script that runs
before hydration receives these settings from `hooks.server.ts`; there are no
second defaults to edit in `app.html`.

## Add a view

Add an entry to `contentSections` in `views.ts`. The `id` is both its URL segment
and its content directory. For example:

```ts
{
  id: 'examples',
  label: 'Examples',
  description: 'Patterns you can adapt',
  icon: BookOpenIcon,
  navigation: [
    { slug: '', name: 'Overview' },
    { slug: 'first-example', name: 'First example' }
  ],
  ui: {
    search: { label: 'Search examples', placeholder: 'Search examples…' },
    pageActions: { enabled: false }
  }
}
```

Create `content/examples/index.mdx` and `content/examples/first-example.mdx`.
They become `/examples` and `/examples/first-example`. Nested slugs such as
`guides/setup` work with either `guides/setup.mdx` or `guides/setup/index.mdx`.
Navigation groups can contain nested `items`; leaf entries identify pages.
Every view must have a leaf with `slug: ''` for its dropdown destination.

The shared `[section]/[...slug]` route renders every registered view. Registering
a view also adds its pages to the sitemap and creates their OG endpoints. The
dropdown disappears when there is only one view. Search and previous/next links
stay inside the active view. Article views always include a TOC: sticky beside the
article on wide screens, or a sticky heading/progress bar with a dropdown on
phones, following Fumadocs. The article and TOC share a viewport with the scrollbar
at its outer edge. TOC visibility has no configuration switch or keyboard shortcut.

UI overrides merge with the defaults in `content-ui.ts`; arrays replace defaults.
Use `showPagination: false` on an individual navigation leaf to hide its pager.
Duplicate view IDs, reserved routes, duplicate slugs and missing content fail
during development/build rather than becoming broken links after deployment.

## Write Markdown with components

The app accepts `.mdx`, `.md` and `.svx` through mdsvex. Files use Svelte syntax
for embedded components and expressions. React JSX/MDX imports are not supported.
The docs overview is a working `.mdx` page.

```mdx
---
title: First example
description: >-
  A short explanation that also appears in search results
  and the generated social preview.
---

<script>import InstallationTabs from '$lib/features/docs/InstallationTabs.svelte';</script>

Start with the package:

<InstallationTabs />

## Usage

Write the explanation here.
```

Use `title` (or the older `name`) and `description` in YAML frontmatter. The shell
renders the page's H1, so start the body at H2. H2/H3 headings populate the TOC.
Override `toc.defaultSelector` or `toc.selectorOverrides` for other heading levels.
Code fences receive syntax highlighting and copy controls. Markdown pages expose
their original source at `/<view>/raw/<slug>`; the index uses `raw/index`.

Place reusable custom components outside `content`, for example in
`site/components`. Content files are page entries, and every Svelte page exports
`metadata`. Do not create two source files for the same route.

## Add a custom Svelte page

Create `content/examples/interactive.svelte`, register the `interactive` slug,
and export metadata from a module script:

```svelte
<script module lang="ts">
	export const metadata = {
		title: 'Interactive example',
		description: 'Try the example in your browser.'
	};
</script>

<script lang="ts">
	let count = $state(0);
</script>

<h1>Interactive example</h1>
<button onclick={() => (count += 1)}>Count: {count}</button>
```

Custom pages own their H1 and body. The shell still supplies navigation, metadata
and an OG image. They have no raw Markdown endpoint or Markdown actions and are
omitted from the Markdown search index and `llms.txt`.

For an editor, canvas or dashboard that must fill the available pane, set
`layout: 'workspace'` on its view. The default `article` layout adds a scroll
container and a readable content width. Each playground content page renders
the shared `PlaygroundPage` component.
It loads the editor on mount and disposes its controller when navigating away.
The controller, editor and preview UI live in `lib/features/playground`.

## Actions and social previews

Add or reorder action groups and providers in `actions.ts`. A provider needs a
unique `id`, label, icon, `hrefTemplate` and `enabled` flag. Set
`opensNewTab: false` for an application protocol such as `zed://`.
Prompt templates accept `{product}`, `{title}` and `{url}`. URL templates accept
those values and `{prompt}`; values are URL-encoded before interpolation.

The build generates 1200 × 630 PNGs at `/og` and `/<view>/og/<slug>`, using the
index alias `og/index`. Titles and descriptions come from page metadata. Branding
comes from `site.ts` and `assets/logo.svg`, with colors read from `theme.css`.
Changing metadata regenerates the PNGs during the next build. Canonical, Open
Graph, Twitter and structured-data URLs use `site.url`.

The SVG favicon uses the same logo. Replace the PNG app icons in `assets/` when
rebranding; the generated `/site.webmanifest` reads their URLs from `site.ts`.
Keep `themeColor` in `site.ts` aligned with your CSS browser background colors.

## Playground and hosting

`/playground` is a registered view, rendered through the shared content route.
Its sidebar lists the demos in `playground.ts`. Spektral Logo uses the index URL;
other demos use `/playground/<slug>`. Each entry has a Svelte page under
`content/playground` that passes its demo ID to `PlaygroundPage`. Adding a demo
also gives it page metadata, a sitemap entry and an OG image.

The framework switcher sits over the preview's top-right corner. The selected
framework is saved between demos and included in shared URLs. Existing
`/playground?demo=<id>` links navigate to the corresponding demo page.

`/playground/embed` remains a separate server endpoint for the sandboxed iframe.
It is infrastructure, not a second application shell. Renaming a view does not
require renaming the iframe endpoint.

Production uses `site.preview.origin`, overridable with
`PUBLIC_PLAYGROUND_PREVIEW_ORIGIN`. The preview host accepts the explicit parent
origins in `PLAYGROUND_PREVIEW_PARENT_ORIGINS`. Keep that allowlist configured on
the preview deployment. Development pairs `localhost` and `127.0.0.1` on the same
port. The iframe sandbox and session-bound messaging remain enabled.

The website config does not provision domains. For a fork's deployment, update
the worker names/domain bindings in `apps/web/wrangler*.jsonc` and the preview
environment variables. The playground still demonstrates the Spektral package;
replacing its compiler integration is application code, beyond rebranding.

The changelog page is generated from the repository's `CHANGELOG.md` by
`scripts/generate-changelog-docs.mjs`. Update or remove that generation step if
your fork does not use the `docs/changelog` page.

## Verify changes

From the repository root:

```sh
pnpm --dir apps/web check
pnpm --dir apps/web lint
pnpm --dir apps/web test
pnpm --dir apps/web build
pnpm --dir apps/web test:e2e
```

Interface icons live only in `lib/icons`. Reuse the licensed Nucleo UI Outline 18
components and record new npm sources in its `NOTICE.md`. Preserve the documented
sources and original names of brand logos.
