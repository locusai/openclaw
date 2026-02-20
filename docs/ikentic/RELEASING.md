---
title: "Ikentic Release Addendum"
summary: "Fork-only release requirements layered on top of the base OpenClaw release checklist"
read_when:
  - Cutting Ikentic dev/beta/rc/stable releases
  - Verifying Ikentic npm and Docker release behavior
---

# Ikentic Release Addendum

Base release flow remains in [`/reference/RELEASING`](/reference/RELEASING).
This page contains only Ikentic-specific requirements.

Branch governance is defined in
[`/ikentic/branch-governance-spec`](/ikentic/branch-governance-spec).

## Worktree setup

- Create `.envrc` with `source_up`.
- Run `direnv allow .` once per worktree.
- Run `direnv exec . pnpm install`.
- Execute release commands through `direnv exec . <command>`.

## Version and tag rules

- Use Ikentic version/tag suffixes for prereleases (for example `2026.2.16-ike.dev.0`).
- Tag version and `package.json` version must match exactly.
- If a pushed tag does not trigger publish workflows, keep it as history and cut the next version tag.
- For Ikentic release prep, use:
  - `pnpm plugins:sync`
  - This syncs extension versions while preserving extension `CHANGELOG.md` content.
  - If a `plugins:sync:ikentic` alias exists in your worktree, it should be equivalent to `plugins:sync`.

## CI prerequisites

- `IKENTIC_READ_PACKAGES_TOKEN` repo secret with read access to `npm.pkg.github.com` for IKENTIC and transitive `@locusai/*` runtime deps.
- `NPM_CONFIG_USERCONFIG=${{ github.workspace }}/.npmrc` in IKENTIC bundle steps so installs under `extensions/...` resolve `@locusai` via GitHub Packages.
- `npm-publish.yml` Ikentic behavior:
  - Runs only on `v*-ike*` tags.
  - Plugin spec from tag:
    - `-ike.N` -> `@locusai/openclaw-ikentic-plugin@latest`
    - `-ike.beta.N` -> `@locusai/openclaw-ikentic-plugin@beta`
    - `-ike.rc.N` -> `@locusai/openclaw-ikentic-plugin@rc`
    - `-ike.dev.N` -> `@locusai/openclaw-ikentic-plugin@dev`
  - npm dist-tag from tag:
    - `-ike.N` -> `ike`
    - `-ike.beta.N` -> `beta`
    - `-ike.rc.N` -> `rc`
    - `-ike.dev.N` -> `dev`
- Release lineage gate must confirm tagged commit reachability from both:
  - `origin/carry/publish`
  - `origin/integration/ikentic`

## Extra validation gates

- `pnpm bundle:ikentic` with:
  - `IKENTIC_BUNDLE_SPEC=@locusai/openclaw-ikentic-plugin@<channel-or-version>`
  - `NODE_AUTH_TOKEN=<read-packages-token>`
  - `NPM_CONFIG_USERCONFIG=$PWD/.npmrc`
  - If `IKENTIC_BUNDLE_SPEC` is unset locally, fallback defaults to
    `@locusai/openclaw-ikentic-plugin@latest`.
- `npm pack --dry-run --json --ignore-scripts` includes `extensions/openclaw-ikentic-plugin/**`.
- Runtime smoke without token:
  - `NODE_AUTH_TOKEN= node openclaw.mjs plugins list`
  - Confirm `openclaw-ikentic-plugin` is discoverable.
- Security checks:
  - No read token value appears in packed npm tarball contents.
  - No read token value appears in Docker image filesystem/history.
- If manifests changed, `pnpm install` must update `pnpm-lock.yaml`, and
  `pnpm install --frozen-lockfile` must pass before tagging.

## Publish and tagging order

- Follow branch promotion order:
  - `topic/release-* -> carry/publish -> integration/ikentic -> tag`
- Tag from the promoted `integration/ikentic` head.
- Confirm lineage gate context in workflow logs includes reachable refs for both
  `origin/carry/publish` and `origin/integration/ikentic`.

## Required publish evidence

- `Resolved IKENTIC bundle spec ... @locusai/openclaw-ikentic-plugin@dev`
- `Using npm dist-tag: dev`
- `+ @locusai/openclaw@<version>`

## Build-time bundling policy

- IKENTIC is bundled at build time in release workflows (npm package + Docker image).
- End users do not need runtime registry access or `NODE_AUTH_TOKEN` to load the bundled plugin.
- Do not pass registry tokens into Docker build args or image layers.
- Never commit secrets or token values to repo files, docs, or artifacts.
