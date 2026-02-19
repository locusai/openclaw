---
name: ikentic-sync-release-cycle
description: Run Ikentic branch governance and dev-release cycles for `locusai/openclaw`. Use when asked to sync `main` with `upstream/main`, port `pr/*` commits into `integration/ikentic` via `topic/sync-*` cherry-picks, execute release routing across `topic/release-*`, `carry/publish`, and `integration/ikentic`, and verify npm publish workflow evidence.
---

# Ikentic Sync Release Cycle

Use this skill when running Ikentic governance, upstream sync, integration porting, and dev
release publishing in `locusai/openclaw`.

## Mandatory Sources

Read these files before branch-management actions:

1. `docs/ikentic/branch-governance-spec.md`
2. `AGENTS.md`
3. `docs/reference/RELEASING.md`
4. `docs/ci.md`
5. `docs/ikentic/CHANGELOG.md`

## Operating Invariants

1. Never bypass governance branch protocol.
2. Never rewrite history on protected long-lived branches.
3. Never equalize `carry/publish` with `integration/ikentic`.
4. Never treat `carry/publish` as a catchall; keep release-scope only.
5. For main-based `pr/*` updates, port patches via `topic/sync-*` cherry-picks.
6. Use `direnv exec . <command>` directly (no manual export shims).
7. Use elevated permissions when required by this environment.
8. Treat changelog maintenance as a separate lane; changelog conflicts must not drive dependency decisions.

## Deterministic Conflict Classes

1. Class A: dependency manifests (`package.json` files) -> upstream-first (`main`) baseline.
2. Class B: lockfile (`pnpm-lock.yaml`) -> regenerate from resolved manifests every cycle.
3. Class C: changelogs (`CHANGELOG.md`) -> integration-side maintenance lane; do not block dependency resolution.
4. Class D: code/config conflicts -> explicit manual resolution with rationale captured in the sync PR.

## Deterministic Helpers

- `scripts/ikentic/sync-main-into-integration.sh`
  - Fetch/prune refs, fast-forward `main` from `upstream/main`, push mirror, create `topic/sync-main-*`, merge `origin/main`, and run deterministic conflict pass.
- `scripts/ikentic/classify-conflicts.sh`
  - Classify unresolved files into Classes A/B/C/D.
- `scripts/ikentic/resolve-sync-conflicts.sh`
  - Auto-resolve Class A and C (and stage lockfile for later rebuild), then report remaining Class D conflicts.
- `scripts/ikentic/check-lockfile-gates.sh [<base-ref> [<head-ref>]]`
  - Fail if `package.json` changed without `pnpm-lock.yaml` change.
  - Run `pnpm install --frozen-lockfile`.
  - Defaults to `origin/integration/ikentic...HEAD`.

## Runbook References

- Full continuity mode: `references/full-continuity-runbook.md`
- Process-only runbook mode: `references/repeatable-cycle-runbook.md`

Use full continuity mode for in-flight sessions that need fresh, explicit state discovery.
Use process-only mode for recurring cycles where the operator wants the reusable checklist flow.

## Execution Skeleton

1. Load fresh session truth (env bootstrap, fetch/prune, divergence, refs, PRs, workflows, tags).
2. Fast-forward mirror `main` from `upstream/main` when behind.
3. Port selected `pr/*` deltas into `integration/ikentic` using `topic/sync-*` branches.
4. Run release path `topic/release-* -> carry/publish -> integration/ikentic -> tag`.
5. Verify npm publish evidence lines for bundle spec, dist-tag, and published version.
6. Delete temporary `topic/sync-*` and `topic/release-*` branches after merge; keep long-lived lanes.
