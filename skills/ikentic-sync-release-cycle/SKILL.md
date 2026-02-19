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
3. `docs/ikentic/RELEASING.md`
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
9. Snapshot open main-based `pr/*` heads before mechanical porting and pin to captured SHAs for the cycle.
10. Do not create the final review branch until the mechanical sync branch is merged into `integration/ikentic`.
11. Mechanical sync branches must contain deterministic-only edits; manual conflict edits belong to the final review branch.

## Deterministic Conflict Classes

1. Class A: dependency manifests (`package.json` files) -> upstream-first (`main`) baseline.
2. Class B: lockfile (`pnpm-lock.yaml`) -> regenerate from resolved manifests every cycle.
3. Class C: changelogs (`CHANGELOG.md`) -> integration-side maintenance lane; do not block dependency resolution.
4. Class D: code/config conflicts -> explicit manual resolution with rationale captured in the sync PR.

## Deterministic Helpers

- `scripts/ikentic/cli.sh`
  - Single entrypoint for Ikentic cycle helpers:
    - `sync-main`
    - `classify-conflicts`
    - `resolve-conflicts`
    - `check-lockfile-gates`
    - `snapshot-open-prs`
    - `stage-tools`
    - `ledger-refresh`
    - `ledger-validate`
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
2. Refresh/validate first-parent ledger and snapshot open main-based `pr/*` branches with pinned head SHAs for the cycle.
3. Build and merge the mechanical sync branch (mirror merge + deterministic conflict handling + conflict-free snapshot PR ports).
4. Build final review branch from post-mechanical `integration/ikentic` head for unresolved/manual/conflict-bearing ports only.
5. Run release path `topic/release-* -> carry/publish -> integration/ikentic -> tag`.
6. Verify npm publish evidence lines for bundle spec, dist-tag, and published version.
7. Delete temporary `topic/sync-*` and `topic/release-*` branches after merge; keep long-lived lanes.
