# Ikentic Integration Steward Skill

Use this skill to keep Ikentic overlay work aligned with OpenClaw upstream while preserving all
internal changes.

## Goals

- Keep `main` as a clean upstream mirror.
- Keep integration merge-based and deploy-safe.
- Keep upstream work isolated in `pr/*`.
- Keep internal work isolated in `carry/*`.
- Prevent loss by requiring containment and tree-equivalence checks.

## Operating Rules

1. Never force-push `main` or `integration/*`.
2. Never bulk-delete branches.
3. Never use blanket conflict sides (`-X ours` / `-X theirs`) for non-trivial conflicts.
4. Always create safety refs before rewrites/deletions.
5. Treat missing/renamed source branches as a stop-and-review item.

## Standard Runbook

### 1) Preflight

```bash
git fetch --all --prune
git rev-list --left-right --count origin/main...upstream/main
```

Expected mirror result: `0 0`.

### 2) Safety Refs

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
git branch "archive/${STAMP}-integration-ikentic" integration/ikentic
git tag -a "safety/${STAMP}/integration-ikentic" integration/ikentic -m "safety: integration update"
```

### 3) Sync Mirror + Integration

```bash
git switch main
git merge --ff-only upstream/main
git push origin main

git switch integration/ikentic
git merge --no-ff main -m "sync integration with mirror main"
git push origin integration/ikentic
```

### 4) Apply Carry Patchsets

```bash
git merge --no-ff carry/<topic> -m "apply carry patchset: <topic>"
git push origin integration/ikentic
```

### 5) Validate “Nothing Lost”

```bash
git merge-base --is-ancestor main integration/ikentic
git merge-base --is-ancestor pr/<topic> integration/ikentic
git merge-base --is-ancestor carry/<topic> integration/ikentic
```

For topology refactors, verify tree-equivalence:

```bash
git rev-parse <old-branch>^{tree}
git rev-parse <new-branch>^{tree}
```

Trees must match unless intentional differences are documented.

## Rebuild Mode (When Integration Is Too Messy)

1. Create temporary rebuild branch from `main`.
2. Merge required source branches one-by-one in documented order.
3. Resolve conflicts file-by-file with rationale.
4. Validate containment for each source branch.
5. Compare tree with previous candidate if this is a structural rebuild.
6. Promote rebuild branch only after explicit review.

## Branch Retirement Gates

- Before deleting a “duplicate” branch:
  - `git merge-base --is-ancestor <candidate> integration/ikentic`
- Before deleting doc/workflow branches:
  - inspect unique commits:
  - `git log --left-right --cherry-pick --oneline integration/ikentic...<branch>`
- Delete one branch at a time only after passing checks.
