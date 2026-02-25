# Ikentic Branch Governance Spec

This document defines the canonical git model and start to finish operator flow for Ikentic work in `locusai/openclaw`.

Goal:

- Keep upstream PR branches clean and reviewable (`main` lineage only).
- Keep internal integration deterministic and repeatable (merge based, no replay magic).
- Stop re solving the same conflicts by recording real merge and resolution commits in integration history.

## Annotated branch DAG

The model is intentionally split into three truths:

1. Upstream truth: `origin/main`, `origin/pr/*`
2. Upstream candidate truth (generated): `origin/carry/stacked`
3. Internal truth (merge based): `origin/integration/ikentic`, `origin/carry/*`, `origin/topic/*`, `origin/feat/*`

Legend:

- `+-->` normal ancestry (based on)
- `+--M-->` merge commit into the collector branch
- `+..CP..>` patch port (cherry pick), no ancestry edge
- `Gx` gate (blocking unless noted)

```text
upstream/main
   |
   |  G1 Mirror gate
   |  - origin/main is a ff only mirror of upstream/main
   |  - after mirror: origin/main...upstream/main must be 0 0
   v
origin/main
   |\
   | +--> origin/pr/*                                  (upstream PR branches, main lineage only)
   |       G2 PR refresh gate (per PR ref)
   |       - rebase onto origin/main with rerere off
   |       - conflict free only, else NEEDS_MANUAL
   |
   +--> origin/carry/stacked                           (generated, main lineage only)
   |     G3 Stack inputs
   |     - snapshot origin/pr/* refs to a TSV (frozen for the cycle)
   |     - stable PR ordering = sort by refname, then oldest to newest commits
   |     G4 Stack completeness gate
   |     - rebuild from origin/main + snapshot via clean cherry picks only
   |     - fail if port report contains STALE_SNAPSHOT or NEEDS_REVIEW
   |
   +--M--> origin/integration/ikentic                  (internal collector, no force push)
         G5 Integration ancestry gate
         - origin/main must be an ancestor of origin/integration/ikentic
         G6 Mechanical integration sync gate
         - merge origin/main with rerere off (A B C auto resolution only)
         - port the same PR snapshot with rerere off (no NEEDS_REVIEW, no STALE_SNAPSHOT)
         - lockfile gates + pnpm check + pnpm build
         |
         +--M--> origin/carry/ops-v2                   (ops scripts and governance docs)
         +--M--> origin/carry/docker-v2                (docker runtime docs and files)
         +--M--> origin/carry/docs                     (ikentic docs lane)
         +--M--> origin/carry/tests                    (tests lane)
         +--M--> origin/carry/publish                  (release lane, release cycles only)
         +--M--> origin/topic/* / origin/feat/*         (internal only work)
         |
         G7 Required carry lanes gate
         - lanes listed in docs/ikentic/required-lanes.txt must be contained by integration (right=0)
```

Why `carry/stacked` is not merged into integration:

- `carry/stacked` is generated and may be rebuilt with `--force-with-lease`.
- PR branches can rebase and rewrite SHAs.
- Merging regenerated stacks into a long lived integration branch is not idempotent and creates duplicate patch and conflict churn.

How integration starts from the stacked patchset without merging the stack branch:

- `carry/stacked` and the mechanical integration sync use the same frozen PR snapshot TSV and the same deterministic port logic.
- The PR port report TSV is the canonical artifact for what was applied, in what order, and what requires review.

## Canonical operator flow

This is the canonical daily cycle. Do not reorder steps.

### 0. Daily gates (recommended)

Command:

```bash
scripts/ikentic/daily-deterministic-sync.sh
```

Optional mechanical bootstrap after all gates pass:

```bash
scripts/ikentic/daily-deterministic-sync.sh --run-sync
```

Outputs:

- gap report JSON
- inventory report JSON
- daily summary TXT

### 1. Mirror main (G1)

Requirement:

- `origin/main` mirrors `upstream/main` via fast forward only.

Verification:

```bash
git rev-list --left-right --count origin/main...upstream/main
```

### 2. Refresh open PR branches (G2)

Goal:

- keep `origin/pr/*` strictly main lineage and current
- avoid polluting PRs with internal integration deltas

Command:

```bash
scripts/ikentic/refresh-pr-refs-with-main.sh
```

Output:

- PR refresh report TSV under `${TMPDIR:-/tmp}/ikentic-reports/`

Policy:

- conflict free rebases only
- conflicts are recorded as `NEEDS_MANUAL` and handled in a PR review lane

### 3. Build upstream candidate stack (G3, G4)

Goal:

- deterministic view of `origin/main + open PR patches` for composition testing and ordering evidence

Command:

```bash
scripts/ikentic/update-stacked-carry.sh
```

Outputs:

- PR snapshot TSV path
- PR port report TSV path

Stop conditions:

- `STALE_SNAPSHOT` in port report means a PR ref moved after snapshot, stop and rerun
- `NEEDS_REVIEW` means inter PR conflict or non clean pick, fix the relevant `pr/*` branch and rerun

### 4. Create mechanical integration sync branch (G6)

Goal:

- integration starts from the same PR snapshot ordering as `carry/stacked`
- integration records real merges and conflict resolutions as commits

Command:

```bash
scripts/ikentic/sync-main-into-integration.sh
```

This creates a new sync branch from `origin/integration/ikentic` and runs:

1. merge `origin/main` (rerere off)
2. port the same PR snapshot (rerere off, clean only)
3. lockfile gates + pnpm check + pnpm build

Stop conditions:

- unresolved D class conflicts remain after deterministic resolution
- PR port report contains `STALE_SNAPSHOT` or `NEEDS_REVIEW`

### 5. Merge internal carry lanes (G7)

Merge carry lanes into integration as needed, using merge commits:

- `carry/ops-v2`
- `carry/docker-v2`
- `carry/docs`
- `carry/tests`

Required lane completeness is enforced by:

- `scripts/ikentic-branch-gap-audit.ts` using `docs/ikentic/required-lanes.txt`

### 6. Release cycle only

Release flow is constrained to:

- work lands on `carry/publish`
- promotion is `carry/publish -> integration/ikentic`
- tags for Ikentic releases match `v*-ike*`

## Determinism rules

All ops scripts must preserve determinism:

- rerere disabled for rebase, merge, and cherry pick operations
- do not rely on stash or autostash
- do not use worktrees for these flows
- require a clean working tree before running governance scripts

Generated artifacts:

- default output directories live under `${TMPDIR:-/tmp}` to avoid repo pollution
- if you override outputs to a repo local path, keep them untracked and do not commit them

## Branch meanings

- `main`
  - mirror of `upstream/main` only
- `pr/*`
  - upstream PR branches, main lineage only
- `carry/stacked`
  - generated upstream candidate stack (main + PR patchset)
  - force updates allowed via governance scripts only
- `integration/ikentic`
  - internal collector branch, merge based, no force push
- `carry/*`
  - long lived internal lanes merged into integration with merge commits
- `carry/publish`
  - release only lane
- `topic/*`, `feat/*`
  - internal only work lanes

## Cutover exception

If integration baseline reconstruction requires keeping branch name `integration/ikentic`:

1. resolve and verify the replacement baseline branch head
2. create remote backup branch and annotated tag at current `origin/integration/ikentic`
3. move `integration/ikentic` with `git push --force-with-lease` exactly once
4. verify head SHA and record the exception in `docs/ikentic/CHANGELOG.md`
5. re enable and confirm branch protections immediately after cutover
