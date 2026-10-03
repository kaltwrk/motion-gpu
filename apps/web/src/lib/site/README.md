# Configure a fork

This folder owns the website's identity, interface copy, views, content and demos.
Start with `site.ts` and `content/`. The runtime in `lib/content`, `lib/features`
and `lib/components` discovers views and pages from the content files.

| File or folder          | What to change                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `site.ts`               | Name, canonical URL, author, SEO description, social links, package name, home link, app icons, legacy redirects and preview origin |
| `content-ui.ts`         | Search labels and limits, sidebar links, TOC, page actions, pagination, preference defaults and storage keys                        |
| `labels.ts`             | Shared labels, tooltips, copy feedback and playground hints                                                                         |
| `actions.ts`            | Assistant/IDE/builder links, icons, labels, prompts and URL templates                                                               |
| `keyboard-shortcuts.ts` | Shortcuts and their displayed/accessibility labels                                                                                  |
| `theme.css`             | Font, colors, spacing tokens, radii and shadows; OG images read the same color tokens                                               |
| `assets/`               | Logo, app icons and their source notices                                                                                            |
| `content/<view>/`       | Pages, view settings, sidebar groups, labels and order                                                                              |
| `demos/<demo>/`         | Editable playground examples and their source files                                                                                 |

Use distinct storage keys in a fork. This keeps theme, framework and package-manager
preferences separate from another site on the same origin. The script that runs
before hydration receives these settings from `hooks.server.ts`; there are no
second defaults to edit in `app.html`.

## Add a view

Create `content/<view>/index.svx`. The top-level folder defines the view's URL
and the index defines its dropdown entry. No route file or registration array is needed.
For example, `content/examples/index.svx`:

```mdx
---
title: Examples
description: Patterns you can adapt.
view:
  label: Examples
  icon: BookOpenIcon
  order: 20
  layout: article
  ui:
    search:
      label: Search examples
      placeholder: Search examples…
    pageActions:
      enabled: false
---

## First example

Add your content here.
```

`view` is allowed only on the root index. The label defaults to the folder name,
icon to `BookOpenIcon`, layout to `article`, and order to `0`. Icon names are
exports from `lib/icons`. UI overrides merge with `content-ui.ts`; arrays replace
defaults. Use `layout: workspace` for an editor, canvas or dashboard that fills
the shell pane.

Every view needs an index page. The shared route renders all discovered views,
including their sitemap entries and OG images. The dropdown disappears when
there is only one view. Search and previous/next links stay inside the active view.

### Files, URLs and sidebar groups

| Content file                           | URL                                 |
| -------------------------------------- | ----------------------------------- |
| `examples/index.svx`                   | `/examples`                         |
| `examples/setup.svx`                   | `/examples/setup`                   |
| `examples/compute/index.svx`           | `/examples/compute`                 |
| `examples/compute/storage-buffers.svx` | `/examples/compute/storage-buffers` |
| `examples/(advanced)/profiling.svx`    | `/examples/profiling`               |

Folders become sidebar groups. Parentheses make a group **pathless**: it groups
pages without adding a segment to their URLs. The existing docs use this
convention to preserve their published links. Nested groups appear with labels
such as `Compute / Patterns`.

Set a folder's label and order in its `index.svx`:

```yaml
---
title: Compute overview
group:
  label: GPU compute
  order: 20
---
```

If the folder has no landing page, put only that `group` block in `_meta.svx`.
This optional file contains frontmatter only and does not create a route,
search result, sitemap entry or OG image. Define `group` in either the index or
`_meta`, never both. Omitting both uses the folder name and order `0`.
The root index can also set `group.label` for pages directly inside the view.

Pages within a folder sort by ascending `order`, then filename. Child groups follow
those pages and sort separately by their order and folder name. A folder
uses `group.order`, falling back to its index's `order`, then `0`. An index page
defaults to order `-1`; other pages default to `0`. View order is separate,
set by `view.order`.

Article views always include a TOC: sticky beside the article on wide screens,
or a sticky heading/progress bar with a dropdown on phones, following Fumadocs.
The article and TOC share a viewport with the scrollbar at its outer edge.
TOC visibility has no configuration switch or keyboard shortcut.

Invalid metadata, unknown icons, duplicate routes, reserved paths and missing
view indexes fail during development/build with a source-file error. Keep reusable
components outside `content`: every `.svx`, `.mdx`, `.md` or `.svelte` file there
is a page, except `_meta` files.

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
order: 20
sidebar:
  label: First example
  hidden: false
---

<script>import InstallationTabs from '$lib/features/docs/InstallationTabs.svelte';</script>

Start with the package:

<InstallationTabs />

## Usage

Write the explanation here.
```

Use `title` and `description` in YAML frontmatter. Optional `sidebar.label`
changes only the navigation label. `sidebar.hidden: true` omits a page from
navigation, search and previous/next links; its URL, raw source, sitemap entry
and OG image remain available. Use `showPagination: false` to hide a page's pager.
Custom component data belongs in the `data` object; all fields must be serializable.

The shell renders a Markdown page's H1, so start the body at H2. H2/H3 headings populate the TOC.
Override `toc.defaultSelector` or `toc.selectorOverrides` for other heading levels.
Code fences receive syntax highlighting and copy controls. Markdown pages expose
their original source at `/<view>/raw/<slug>`; the index uses `raw/index`.

Place reusable custom components outside `content`, for example in
`site/components`. Content files are page entries, and every Svelte page exports
`metadata`. Do not create two source files for the same route.

## Add a custom Svelte page

Create `content/examples/interactive.svelte` and export metadata from a module
script. It accepts the same fields as Markdown frontmatter:

```svelte
<script module lang="ts">
	import type { ContentFrontmatter } from '$lib/content/types';
	export const metadata = {
		title: 'Interactive example',
		description: 'Try the example in your browser.',
		order: 10
	} satisfies ContentFrontmatter;
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
`view.layout: workspace` in its root index metadata. The default `article` layout adds a scroll
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
Its sidebar comes from the files under `content/playground`. Spektral Logo uses
`index.svelte`; other filenames define their URLs. Each page holds its title,
description, order and `data.demo` ID, then passes the ID and title to
`PlaygroundPage`. See `content/playground/diamond.svelte` for a complete example.
There is no separate demo registration list. Add the matching framework sources
under `demos/<data.demo>/`; the editor derives its catalog from the content metadata.
A new page also gets a sitemap entry and an OG image.

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
