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

## CI prerequisites

- `npm-publish.yml` carry behavior:
  - Runs only on `v*-ike*` tags.
  - npm dist-tag from tag:
    - `-ike.N` -> `ike`
    - `-ike.beta.N` -> `beta`
    - `-ike.rc.N` -> `rc`
    - `-ike.dev.N` -> `dev`
  - Publishes the plain `@locusai/openclaw` package artifact to GitHub Packages.
- Release lineage gate must confirm tagged commit reachability from both:
  - `origin/carry/publish`
  - `origin/integration/ikentic`

## Extra validation gates

- `pnpm build`
- `pnpm release:check`
- `npm pack --dry-run --json --ignore-scripts`
- If manifests changed, `pnpm install` must update `pnpm-lock.yaml`, and
  `pnpm install --frozen-lockfile` must pass before tagging.

## Publish and tagging order

- Follow branch promotion order:
  - `topic/release-* -> carry/publish -> integration/ikentic -> tag`
- Tag from the promoted `integration/ikentic` head.
- Confirm lineage gate context in workflow logs includes reachable refs for both
  `origin/carry/publish` and `origin/integration/ikentic`.

## Required publish evidence

- `Using npm dist-tag: dev`
- `+ @locusai/openclaw@<version>`
- lineage gate logs showing reachability from both promotion refs

## Scope boundary

- This repo no longer owns Ikentic runtime composition, compose files, or Docker images.
- Downstream Ikentic runtime and sandbox overlays are owned outside this repo.
