# Ikentic Integration Workflow Hardening

This document defines the long-term Git workflow for maintaining Ikentic-specific OpenClaw work
without losing upstream compatibility.

## Branch Model

- `main`: exact mirror of `upstream/main` (fast-forward only; no internal commits).
- `integration/ikentic`: canonical deploy lane (merge-based updates only; no force-push).
- `pr/*`: upstream-bound topic branches (short-lived; rebase allowed).
- `carry/*`: long-lived internal-only patchsets that are merged into integration.

## Required Invariants

- Mirror invariant: `origin/main...upstream/main` must always be `0 0` before integration sync.
- Integration invariant: `main` must always be an ancestor of `integration/ikentic`.
- Carry invariant: every permanent internal change must live on an explicit `carry/*` branch.
- Safety invariant: create `archive/*` + annotated `safety/*` refs before branch rewrites/deletes.

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
4. When no longer needed, verify retirement:
   - `git cherry -v main carry/<topic>`
   - If no `+` commits remain, delete branch after safety-tag window.

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
