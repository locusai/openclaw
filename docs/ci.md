---
title: CI Pipeline
description: How the OpenClaw CI pipeline works
---

# CI Pipeline

The CI runs on every push to `main` and every pull request. It uses smart scoping to skip expensive jobs when only docs or native code changed.

## Job Overview

| Job               | Purpose                                         | When it runs              |
| ----------------- | ----------------------------------------------- | ------------------------- |
| `docs-scope`      | Detect docs-only changes                        | Always                    |
| `changed-scope`   | Detect which areas changed (node/macos/android) | Non-docs PRs              |
| `check`           | TypeScript types, lint, format                  | Non-docs changes          |
| `check-docs`      | Markdown lint + broken link check               | Docs changed              |
| `code-analysis`   | LOC threshold check (1000 lines)                | PRs only                  |
| `secrets`         | Detect leaked secrets                           | Always                    |
| `build-artifacts` | Build dist once, share with other jobs          | Non-docs, node changes    |
| `release-check`   | Validate npm pack contents                      | After build               |
| `checks`          | Node/Bun tests + protocol check                 | Non-docs, node changes    |
| `checks-windows`  | Windows-specific tests                          | Non-docs, node changes    |
| `macos`           | Swift lint/build/test + TS tests                | PRs with macos changes    |
| `android`         | Gradle build + tests                            | Non-docs, android changes |

## Fail-Fast Order

Jobs are ordered so cheap checks fail before expensive ones run:

1. `docs-scope` + `code-analysis` + `check` (parallel, ~1-2 min)
2. `build-artifacts` (blocked on above)
3. `checks`, `checks-windows`, `macos`, `android` (blocked on build)

## Runners

| Runner                          | Jobs                          |
| ------------------------------- | ----------------------------- |
| `blacksmith-4vcpu-ubuntu-2404`  | Most Linux jobs               |
| `blacksmith-4vcpu-windows-2025` | `checks-windows`              |
| `macos-latest`                  | `macos`, `ios`                |
| `ubuntu-latest`                 | Scope detection (lightweight) |

## Local Equivalents

```bash
pnpm check          # types + lint + format
pnpm test           # vitest tests
pnpm check:docs     # docs format + lint + broken links
pnpm release:check  # validate npm pack
```

## Ikentic Fork Release Workflow Notes

Ikentic branch governance is defined in
[`/ikentic/branch-governance-spec`](/ikentic/branch-governance-spec).
This CI page only covers workflow execution behavior.

Release workflows bundle IKENTIC before build (not at runtime):

- `pnpm bundle:ikentic` runs before `pnpm build` in `npm-publish.yml` and `docker-release.yml`.
- Required CI inputs:
  - `IKENTIC_READ_PACKAGES_TOKEN` (repo secret, read access for `npm.pkg.github.com` for IKENTIC and its transitive `@locusai/*` runtime deps)
  - `NPM_CONFIG_USERCONFIG=${{ github.workspace }}/.npmrc` for bundle steps (ensures `@locusai` scope uses GitHub Packages when install runs inside `extensions/...`)
- IKENTIC npm publish workflow runs only on tags matching `v*-ike*`.
- In `npm-publish.yml`, plugin spec is derived from release tag:
  - `-ike.N` -> `@locusai/openclaw-ikentic-plugin@latest`
  - `-ike.beta.N` -> `@locusai/openclaw-ikentic-plugin@beta`
  - `-ike.rc.N` -> `@locusai/openclaw-ikentic-plugin@rc`
  - `-ike.dev.N` -> `@locusai/openclaw-ikentic-plugin@dev`
- In `npm-publish.yml`, npm dist-tag is derived from release tag:
  - `-ike.N` -> `ike`
  - `-ike.beta.N` -> `beta`
  - `-ike.rc.N` -> `rc`
  - `-ike.dev.N` -> `dev`
- Release tag lineage gate enforces that `GITHUB_SHA` is reachable from both `origin/carry/publish` and `origin/integration/ikentic` before publish/build steps proceed.
- Release workflows also run smoke checks without `NODE_AUTH_TOKEN` and fail if the token value appears in npm tarballs or Docker image filesystem/history.
- Tokens are used only in CI bundle/security-check steps and are not passed into Docker build args/layers.

If Docker release is not used:

- Disable `docker-release.yml` in GitHub Actions settings/API.
- Do not modify workflow YAML only to disable it operationally.
- Keep npm publish flow (`npm-publish.yml`) as the required release gate.
