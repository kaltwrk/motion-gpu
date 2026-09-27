# Contributing

## Local setup

Spektral uses the pnpm version declared in `package.json`.

```sh
corepack enable
pnpm install
pnpm --dir packages/spektral exec playwright install chromium
```

`pnpm install` configures the tracked pre-commit hook for this checkout. The hook checks the generated changelog, formatting, and lint rules:

```sh
pnpm run precommit
```

Run the full local gate before opening a pull request:

```sh
pnpm run ci
```

That command checks the generated changelog, formatting, lint rules, builds, package and application types, unit tests, and all Playwright/WebGPU scenarios for Svelte, React, and Vue.

The hook is a local safety net and can be bypassed. Pull requests use the deterministic `quality` check as the authoritative code-quality gate, together with dependency review and CodeQL for JavaScript and TypeScript.

WebGPU end-to-end tests require a real, compatible graphics environment. Standard GitHub-hosted runners do not provide one reliably, so E2E runs locally through `pnpm run ci:e2e`, which is included in `pnpm run ci`.

## Releases

1. Bump `packages/spektral/package.json`, move the `Unreleased` notes into a dated version section in `CHANGELOG.md`, update its comparison links, and run `pnpm run docs:changelog`.
2. Run `pnpm run audit:dependencies`, `pnpm run ci`, and the local hardware release gates described below.
3. Open a pull request to `master` and merge it through the repository's review and required-check rules.
4. Publish a stable GitHub Release with a `vX.Y.Z` tag pointing to the merged commit. The tag version must match the package manifest.

The `release` workflow starts when the GitHub Release is published; pushing a tag alone does not publish the package. It verifies the tag's ancestry on `master` and that the npm version is unused, then audits dependencies and runs `ci:quality`. It packs one tarball, tests it with current and minimum peer versions, and publishes that same artifact through npm trusted publishing in the `npm-production` environment. Registry integrity, the `latest` tag, provenance, signatures, and installed-package consumer tests are checked afterward.

The `release:candidate:*` commands are specific to the historical 0.17.0 candidate process and are not called by the release workflow.

## Performance benchmarks

Performance checks are kept separate from the required PR gate. Their baselines depend on the CPU, browser version, and power mode, so compare them on the same class of machine:

```sh
pnpm run perf:spektral:core:check
pnpm run perf:spektral:check
pnpm run perf:spektral:gpu:check
pnpm run perf:spektral:renderer:check
pnpm run bundle:spektral:check
```

The strict GPU and real-renderer checks are local release gates, not GitHub-hosted checks. Run them
on the reference Apple M4 Pro/Metal machine against baselines with the same GPU, backend, driver,
macOS, Chromium major, and benchmark-suite fingerprint. Create those baselines with
`pnpm run perf:spektral:gpu:baseline` and `pnpm run perf:spektral:renderer:baseline`. The hardware
commands reject SwiftShader and other software adapters.
