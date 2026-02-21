# Ikentic Branch Governance Spec

This document is the single-source governance spec for Ikentic branch strategy in `locusai/openclaw`.

For operator hardening directives, see `AGENTS.md` (section: `Ikentic Overlay Hardening`).

## Scope

- Defines branch purpose, routing rules, and merge policy.
- Covers both:
  - upstream-bound work (`main`/`pr/*` lineage),
  - internal integration/release work (`integration/ikentic`, `carry/*`, `carry/publish`).

## Branch Roles

- `main`
  - Mirror of `upstream/main` only.
  - No internal-only commits.
  - Sync mode: fast-forward only.
- `pr/*`
  - Upstream PR branches.
  - Based on `main`.
  - Intended for `openclaw/openclaw` review/merge.
- `feat/*`
  - Integration-only feature branches (internal).
  - Based on `integration/ikentic` (or a short-lived `topic/*` off it).
  - Not upstream PR routing; if upstreaming later, port patches into a `pr/*` branch based on `main`.
- `integration/ikentic`
  - Canonical internal integration/deploy branch.
  - Base for internal feature/fix/test work.
  - Merge-based; no force-push.
- `carry/*`
  - Long-lived internal patch lanes.
  - Merge into `integration/ikentic`.
  - Keep long-lived by default; retire only explicitly.
- `carry/publish`
  - Long-lived release-only lane.
  - Contains only release-scope changes:
    - version bumps,
    - changelog/release-note updates,
    - plugin packaging/release guard updates.
  - Never delete.
  - Not a catchall internal branch.
- `topic/*`
  - Short-lived implementation branches.
- `topic/release-*`
  - Short-lived release-prep branches targeting `carry/publish`.

## Hard Invariants

1. Mirror invariant:
   - `origin/main...upstream/main` must be `0 0` after mirror sync.
2. Integration ancestry invariant:
   - `origin/main` must be an ancestor of `origin/integration/ikentic`.
3. Release lane scope invariant:
   - `carry/publish` must only contain release-scope commits.
4. Force-push invariant:
   - no force-push to `integration/ikentic`, `carry/publish`, or persistent `carry/*`.
5. PR safety invariant:
   - active-review PR branches are additive-update by default (no history rewrite unless explicit maintainer override).

## PR Routing Rules

1. Upstream work:
   - head: `pr/<topic>`
   - base: upstream `main`
2. Internal feature/fix/test:
   - head: `topic/*` or `carry/*`
   - base: `integration/ikentic`
3. Internal feature tracking (optional, integration-only):
   - head: `feat/<topic>`
   - base: `integration/ikentic`
   - do not assume upstream PR semantics for `feat/*`.
4. Release-prep:
   - head: `topic/release-*`
   - base: `carry/publish`
5. Release promotion:
   - head: `carry/publish`
   - base: `integration/ikentic`

Do not target `carry/publish` for normal internal feature/fix/test PRs.

## Merge Strategy by Lane

Use merge strategy intentionally by branch type:

1. `topic/* -> integration/ikentic` (short-lived internal work):
   - prefer squash merge to keep integration history readable.
2. `carry/* -> integration/ikentic` (long-lived internal patch lanes):
   - require merge commit (`--no-ff`) so previously integrated carry commits are tracked cleanly.
3. `main -> integration/ikentic` (upstream mirror sync):
   - require merge commit (`--no-ff`).
4. `topic/release-* -> carry/publish` and `carry/publish -> integration/ikentic`:
   - use merge commit (`--no-ff`) for release traceability.

If a lane uses a different strategy for a specific change, document why in the PR.

## Main-Based PR Porting Model

`pr/*` branches are `main`-lineage and should not be merged directly into `integration/ikentic`.
Port patches, not branch lineage.

### Mechanical sync requirement

Every sync cycle must split into:

1. Mechanical sync update (merge-first):
   - `main` mirror merge,
   - deterministic conflict-class handling only,
   - conflict-free patch ports from open main-based PR snapshot.
2. Final review update:
   - only unresolved/manual/conflict-bearing ports and intentional integration deltas.

Do not create the final review branch before the mechanical sync branch is merged into
`integration/ikentic`.

### Open PR snapshot requirement

Before mechanical porting, capture a snapshot of open upstream PR heads:

- include `number`, `headRefName`, `baseRefName`, and `headRefOid`,
- include only `baseRefName == main` and `headRefName` in `pr/*`,
- freeze this snapshot for the cycle.

Before porting each snapshot branch, verify `origin/<headRefName>` still matches `headRefOid`.
If any branch head moved, stop the cycle and regenerate a fresh snapshot before continuing.

### Mechanical determinism requirement

Mechanical sync branches must not include manual conflict edits.

- allowed: deterministic class resolution rules from this spec,
- allowed: clean `cherry-pick -x` ports that apply without manual edits,
- not allowed: hand-edited conflict resolutions for code/config paths.

Branches requiring manual resolution move to the final review branch by design.

### Required flow

1. Create sync branch from integration:
   - `git switch integration/ikentic`
   - `git switch -c topic/sync-<pr-topic>`
2. Port upstream PR commits:
   - `git cherry-pick -x <sha1> <sha2> ...`
3. Resolve conflicts and validate targeted tests.
4. Open internal PR:
   - `topic/sync-<pr-topic> -> integration/ikentic`
5. When upstream PR updates:
   - cherry-pick only new upstream commits onto the same sync branch.
6. If the sync PR is already merged:
   - create `topic/sync-<pr-topic>-2` from current `integration/ikentic`,
   - cherry-pick only new upstream commits,
   - open a follow-up internal PR.

### Equivalence checks

- `git cherry -v origin/integration/ikentic origin/pr/<topic>`
- `git range-diff origin/main...origin/pr/<topic> origin/main...topic/sync-<pr-topic>`

If all relevant patches are already present, close duplicate integration sync PRs.

### Commit trailers (recommended)

When porting from upstream into integration, add trailers for auditability:

- `Upstream-Status: Pending|Merged|Rejected|Internal`
- `Upstream-PR: <url>`

## Release Flow

1. Start release branch from `carry/publish`:
   - `topic/release-<version>`
2. Apply release-scope changes only.
3. Merge `topic/release-* -> carry/publish`.
4. Promote `carry/publish -> integration/ikentic`.
5. Tag from promoted `integration/ikentic` commit with exact version match:
   - `package.json` version == tag version.
6. If tag push fails to trigger:
   - keep old tag as history,
   - cut next tag from next promoted release commit.

## Carry Branch Maintenance

Long-lived `carry/*` branches must be kept current to reduce conflict debt.

1. Measure lag:
   - `git rev-list --left-right --count refs/remotes/origin/carry/<topic>...refs/remotes/origin/main`
2. Refresh cadence:
   - refresh each active `carry/*` at least once per upstream sync cycle, or when lag exceeds 50 commits.
3. Refresh method (no force-push policy):
   - `git switch carry/<topic>`
   - `git merge --no-ff main -m "sync carry/<topic> with main"`
   - `git push origin carry/<topic>`
4. If branch history becomes too noisy:
   - create `carry/<topic>-v2` from current `integration/ikentic` or `main`,
   - cherry-pick active commits,
   - retire the old carry branch explicitly after containment checks.
5. Governance hygiene:
   - each carry branch must have an owner and reason (why it cannot move upstream),
   - review active carry branches at least quarterly; retire obsolete branches.

## PR Update Stability Policy

1. Draft phase:
   - rebase allowed on base branch,
   - push with `--force-with-lease`.
2. Active review phase:
   - no history rewrite by default,
   - update with additive commits.
   - for internal PRs only, merging the current base branch into the PR branch is allowed.
3. Maintainer override:
   - if rewrite is required, announce and use `--force-with-lease` only.
4. Upstream expectation override:
   - upstream PRs may be rebased before merge if upstream requires clean history.
   - avoid merge-commits into upstream PR branches unless upstream maintainers explicitly allow it.

## Alignment Checks (Operational)

1. Mirror:
   - `git rev-list --left-right --count refs/remotes/origin/main...refs/remotes/upstream/main`
2. Integration ancestry:
   - `git merge-base --is-ancestor refs/remotes/origin/main refs/remotes/origin/integration/ikentic`
3. Carry publish scope:
   - `git log --oneline refs/remotes/origin/integration/ikentic..refs/remotes/origin/carry/publish`
   - `git diff --name-only refs/remotes/origin/integration/ikentic..refs/remotes/origin/carry/publish`
4. Note:
   - Non-zero divergence between `carry/publish` and `integration/ikentic` is expected.
   - Do not auto-equalize by merging all integration commits into `carry/publish`.

## Session-Start Truth Protocol

Run this sequence at the start of every sync/replay/cutover session:

1. Environment bootstrap:
   - `direnv allow .`
   - `direnv exec . pnpm install`
2. Ref truth refresh:
   - `git fetch origin --prune`
   - `git fetch upstream --prune`
3. Branch truth checks:
   - mirror divergence and integration ancestry checks from the Alignment section.
4. Required lane completeness gate:
   - run `scripts/ikentic-branch-gap-audit.ts` before any replay sign-off or cutover planning.
5. Categorized branch inventory:
   - `node --import tsx scripts/ikentic-branch-inventory.ts`
6. Open PR head snapshot and workflow/tag truth checks:
   - capture current open PR heads and workflow/tag status into the run report.

## Daily Deterministic Operation

Use the daily runbook command:

- `scripts/ikentic/daily-deterministic-sync.sh`

Optional mechanical bootstrap after gates pass:

- `scripts/ikentic/daily-deterministic-sync.sh --run-sync`

The daily runbook writes machine-readable reports under `.ikentic/reports/` and enforces stop/go
checks before any mechanical merge bootstrap.

Detailed runbook:

- [`/ikentic/daily-deterministic-sync`](/ikentic/daily-deterministic-sync)

## Cutover Readiness Package

Every cutover/readiness report must include all sections below:

1. Integration Equivalence
   - target integration comparison (candidate vs destination integration lane).
2. Required Lane Completeness (blocking)
   - branch-gap audit output for lanes in `docs/ikentic/required-lanes.txt`.
   - any `BLOCKING_MISSING` entry is a no-go.
3. Advisory Lane Deltas (non-blocking backlog)
   - `ADVISORY_MISSING` lanes tracked for follow-up.
4. Release Safety Gates
   - manifest/lockfile consistency and frozen-lockfile result.
## Carry/Publish Enforcement Controls

Treat `carry/publish` scope as enforceable policy, not convention.

1. Branch protection:
   - require pull request reviews and block direct pushes.
2. Ownership:
   - require approval from release owners for PRs targeting `carry/publish`.
3. Path guard (CI):
   - fail PRs to `carry/publish` if changed files are outside release-scope allowlist.
4. Suggested allowlist (adjust to repo reality):
   - root/package version files,
   - `CHANGELOG*` and release-note files,
   - plugin packaging and release scripts/config,
   - release workflow guards.

## Governance Decisions (Current)

- `carry/publish` is release-only.
- Internal PRs remain on `integration/ikentic`.
- Main-based upstream PR branches are ported via `topic/sync-*` + `cherry-pick -x`.
- Open main-based PR heads are snapshotted and pinned before mechanical ports.
- Final review branch is created only after mechanical sync merge lands.
- Mechanical sync branches contain deterministic-only edits; manual conflict resolution is review-lane work.
- Ikentic-specific documentation content lives under `docs/ikentic/**`.
- Non-Ikentic docs (for example `docs/reference/*`, `docs/ci.md`) must stay free of Ikentic policy/process content and Ikentic-specific cross-links.
