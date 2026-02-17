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
