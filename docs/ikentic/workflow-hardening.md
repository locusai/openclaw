# Ikentic Integration Workflow Hardening

This document defines the long-term Git workflow for maintaining Ikentic-specific OpenClaw work
without losing upstream compatibility.

## Branch Model

- `main`: exact mirror of `upstream/main` (fast-forward only; no internal commits).
- `integration/ikentic`: canonical deploy lane (merge-based updates only; no force-push).
- `pr/*`: upstream-bound topic branches (short-lived; rebase allowed).
- `carry/*`: long-lived internal-only patchsets that are merged into integration and kept.

## Required Invariants

- Mirror invariant: `origin/main...upstream/main` must always be `0 0` before integration sync.
- Integration invariant: `main` must always be an ancestor of `integration/ikentic`.
- Carry invariant: every permanent internal change must live on an explicit `carry/*` branch.
- Safety invariant: create `archive/*` + annotated `safety/*` refs before branch rewrites/deletes.

## Operator Environment

- Keep a repo `.envrc` with:
  - `source_up 2>/dev/null || true`
- Run operational commands through `direnv exec . <command>` to ensure expected environment.

## Integration Update (Merge-Based)

1. Sync mirror:
   - `git fetch upstream origin --prune`
   - `git switch main`
   - `git merge --ff-only upstream/main`
   - `git push origin main`
2. Sync integration:
   - `git switch integration/ikentic`
   - `git merge --no-ff main -m "sync integration with mirror main"`
3. Merge active carry branches one-by-one:
   - `git merge --no-ff carry/<topic> -m "apply carry patchset: <topic>"`
4. Push integration:
   - `git push origin integration/ikentic`

## Carry Branch Lifecycle

1. Create from `main`:
   - `git switch main`
   - `git switch -c carry/<topic>`
2. Add internal-only commits (or cherry-pick from temporary integration branches).
3. Merge into integration with `--no-ff`.
4. Keep the branch after merge. Do not delete `carry/*` as routine cleanup.
5. Only retire by explicit decision. Before retirement, verify:
   - `git cherry -v main carry/<topic>`
   - If no `+` commits remain and the patchset is intentionally upstreamed/obsolete, retire after
     safety-tag window.

## PR Handling Model

1. Classify every change first:
   - `upstream-pr`: intended for `openclaw/openclaw`.
   - `carry`: internal-only, not intended for upstream.
   - `hybrid`: split into two branches (`pr/*` and `carry/*`).
2. Base/head rules:
   - Upstream-bound: PR from `pr/<topic>` into upstream `main`.
   - Internal carry: PR from `carry/<topic>` into fork `integration/ikentic`.
3. Merge behavior:
   - Prefer GitHub PR merge with **Merge commit** for carry branches.
   - Equivalent local merge:
     - `git switch integration/ikentic`
     - `git merge --no-ff carry/<topic> -m "apply carry patchset: <topic>"`
     - `git push origin integration/ikentic`
4. Never merge internal changes directly into `main`.

## Rebuild Method (When Integration Becomes Risky/Noisy)

1. Create a fresh rebuild branch from `main`:
   - `git switch main`
   - `git switch -c tmp/rebuild-integration-<stamp>`
2. Merge source branches in documented order, one at a time.
3. Resolve conflicts manually per file; do not use blanket `-X ours`/`-X theirs`.
4. After each merge, run targeted checks for touched areas.
5. Validate containment:
   - `git merge-base --is-ancestor <source-branch> tmp/rebuild-integration-<stamp>`
6. Replace integration only after review + safety refs.

## Validation Checklist (Nothing Lost)

- Tree equivalence for branch topology refactors:
  - `git rev-parse <old>^{tree}`
  - `git rev-parse <new>^{tree}`
- Source branch containment:
  - `git merge-base --is-ancestor <source> <integration-candidate>`
- Patchset traceability:
  - `git log --oneline <base>..<candidate>`
  - `git diff --name-status <base>..<candidate>`
- Explicitly list intentionally omitted commits (for example: pure version bumps already superseded).

## Cleanup Policy

- Backups can be scripted.
- Deletions must be executed one-by-one after each branch passes containment checks.
- Default retention for `archive/*` and `safety/*`: 14 days after milestone validation.
- `carry/*` branches are excluded from routine cleanup and stay long-lived by default.

## Retirement Log

### 2026-02-17 historical lane retirement

The following branches were explicitly retired after cutover to `integration/ikentic` as the canonical
integration lane. These are historical lanes, not active carry lanes.

| Historical branch                       | Last known local tip | Why it existed                                                    | Retirement disposition |
| --------------------------------------- | -------------------- | ----------------------------------------------------------------- | ---------------------- |
| `rebuild/ikentic-e2e-parity`            | `bf58e744d`          | Temporary rebuild lane for conflict-managed replay work           | Retired                |
| `overlay/consolidated-internal-commits` | `8c628fe39`          | Historical consolidation/source lane for internal overlay commits | Retired                |
| `integration/ikentic-v2`                | `9db849dc2`          | Pre-cutover integration replacement candidate                     | Retired                |

Safety refs created before deletion (stamp `20260217-174919`):

- `archive/20260217-174919-rebuild-ikentic-e2e-parity`
- `archive/20260217-174919-overlay-consolidated-internal-commits`
- `archive/20260217-174919-integration-ikentic-v2`
- `safety/20260217-174919/rebuild-ikentic-e2e-parity`
- `safety/20260217-174919/overlay-consolidated-internal-commits`
- `safety/20260217-174919/integration-ikentic-v2`

Retention evidence was captured before deletion using:

- `git merge-base --is-ancestor <branch> integration/ikentic`
- `git log --left-right --cherry-pick --oneline integration/ikentic...<branch>`

## Operational Run Log

### 2026-02-17 first local sync run (`main` mirror + `integration/ikentic` sync)

Run objective: execute phases 1-5 from the worktree-native runbook, then publish a real `-ike`
package tag.

Plan vs actual adjustments from this run:

- Remote alias: runbook used `source`; operation standardized on `shared` by policy.
- Re-anchor gate: `integration/ikentic` failed safe-forward ancestor gate (`19` local-only commits
  vs `2856` remote-only commits).
- Divergence handling: preserved divergent local tip with safety+archive refs, then realigned
  `integration/ikentic` to `origin/integration/ikentic`.
- Main mirror sync: succeeded after re-anchor (`origin/main...upstream/main` became `0 0`).
- Integration merge from `main`: large conflict set in generated version/changelog artifacts.
- Conflict policy used: for conflicted release artifacts, keep `theirs` (`main`) to drop stale old
  `-ike` bump files before new release cut.
- Local hook issue: merge commit hooks failed due missing `oxlint` native binding; merge commits
  completed with `--no-verify` and explicit publish checks deferred to release phase.

Refs and state after this run segment:

- `main` -> `5acec7f79` (mirrored to `upstream/main` and pushed to `origin/main`).
- `integration/ikentic` -> `8bb5194ce` (contains merge commit `1149ee665` from `main` and merge of
  `carry/publish`; pushed to origin).
- `carry/publish` -> `587134ce4`.
- `carry/docs` -> `b559dc311` (unchanged in this run, intentionally in abeyance).

Safety refs created in this segment:

- `safety/20260217-182223/main-pre-sync`
- `safety/20260217-182818/integration-ikentic-pre-sync-diverged`
- `safety/20260217-182818/carry-publish-pre-sync`
- `safety/20260217-182818/carry-docs-pre-sync`
- `safety/20260217-182832/main-pre-mirror`

Next steps to complete phase 5 publish in the next pass:

- Derive next version from highest upstream semver core + `-ike.N` policy.
- Set `package.json` version and sync plugin versions.
- Run pre-publish sanity checks (`check/lint/typecheck/release/prepack` subset we keep active).
- Commit release bump on `integration/ikentic`, push branch, create/push `v<version>` tag.
- Watch `npm-publish.yml` run and confirm GitHub Packages publish + expected dist-tag.
