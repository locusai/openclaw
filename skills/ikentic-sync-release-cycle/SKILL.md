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
