# First Local Sync Run Log (IKENTIC)

Date: 2026-02-18
Repo root: `/path/to/openclaw`
Common bare repo (optional): `/path/to/shared-bare-repo-store/openclaw`

## Scope

In:

- `main`
- `integration/ikentic`
- `carry/publish`

Abeyance:

- `carry/docs`
- `integration/ikentic-legacy-20260217`

Retired:

- `rebuild/ikentic-e2e-parity`
- `overlay/consolidated-internal-commits`
- `integration/ikentic-v2` (prior attempt)

## Plan vs actual execution

1. Remote naming

- Plan draft used `source` for local path remote.
- Actual kept local path remote as `shared` (required for shared-bare-repo workflows).

2. Carry-first implementation flow

- Created topic branch `codex/ikentic-tag-gated-publish` from `carry/publish`.
- Implemented workflow/script/docs changes on topic branch only.
- Opened internal PR A (topic -> carry).
- Carry now contains topic changes via merge history and PR A is marked merged.

3. Carry -> integration promotion

- Opened internal PR B (`carry/publish` -> `integration/ikentic`).
- Initial state was conflict (`DIRTY`) due carry branch being behind integration.
- Resolved by merging `origin/integration/ikentic` into `carry/publish` and resolving 2 files:
  - `.github/workflows/npm-publish.yml`
  - `scripts/release/bundle-ikentic.ts`
- Preserved IKENTIC policy during conflict resolution:
  - publish trigger `v*-ike*`
  - override precedence: `IKENTIC_BUNDLE_SPEC` first
  - tag-channel mapping: `-ike.` => `latest`, `-ike.beta.` => `beta`, `-ike.rc.` => `rc`, `-ike.dev.` => `dev`
  - default fallback spec: `@locusai/openclaw-ikentic-plugin@latest`

4. Validation sequence in carry worktree

- `pnpm check:publish:ikentic` passed.
- `pnpm build` passed.
- `pnpm release:check` passed after build.
- `pnpm bundle:ikentic` intentionally blocked pending published extension package.

## Current publish blocker

- Latest required base package for `@locusai/openclaw-ikentic-plugin` is not yet published.
- Until publish exists, no real bundle pull test can complete against that target.
- All non-pull workflow and release gates are prepared.

## Operational notes for next run

- Use `direnv exec /path/to/openclaw ...` consistently.
- Shared-bare-repo worktree operations may require elevated exec due to lock writes under `.git-repos/*/worktrees/*`.
- Run order for pre-publish sanity should be:
  1. `pnpm check:publish:ikentic`
  2. `pnpm build`
  3. `pnpm release:check`
  4. `pnpm bundle:ikentic` (only when extension artifact is published)

## Branch state at log time

- Recorded at time of run. Prefer checking current heads with:
  - `git rev-parse origin/carry/publish`
  - `git rev-parse origin/integration/ikentic`
