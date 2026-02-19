Continue from current state for Ikentic branch governance, upstream sync, integration ports, and dev release publishing in `locusai/openclaw`.

Execution anchors:

- Repo root: `.`
- Primary worktree: `.`
- Required branch lanes:
  - `main` = upstream mirror lane (ff-only from `upstream/main`)
  - `integration/ikentic` = protected internal deploy lane
  - `carry/publish` = release-only lane (long-lived, never deleted)
  - `pr/*` = upstream PR branches (main-based)
  - `carry/*` = long-lived internal carry branches
  - `topic/sync-*` = temporary integration port branches
  - `topic/release-*` = temporary release-prep branches

Required docs to read first (with reason):

1. [Branch Governance Spec](docs/ikentic/branch-governance-spec.md)
   Reason: single source of truth for branch routing, merge strategy, carry/publish scope, and upstream-port flow.
2. [AGENTS.md](AGENTS.md)
   Reason: execution guardrails and mandatory pre-branch-management governance check.
3. [Ikentic Releasing Guide](docs/ikentic/RELEASING.md)
   Reason: fork release/tag/publish sequence and Ikentic-specific verification expectations.
4. [CI Guide](docs/ci.md)
   Reason: workflow behavior, lineage gates, and expected CI release path behavior.
5. [Ikentic Changelog](docs/ikentic/CHANGELOG.md)
   Reason: record integration/release governance-impacting changes without duplicating policy text.

Hard rules:

- Do not bypass governance branch protocol.
- Do not rewrite history on protected long-lived branches.
- Do not equalize `carry/publish` with `integration/ikentic`; divergence is expected.
- Do not treat `carry/publish` as catchall; release-scope changes only.
- For main-based upstream PR updates, port patches into integration via `topic/sync-*`, not lineage merges.
- Changelog maintenance is separate from dependency reconciliation.
- Snapshot open main-based PR heads before mechanical porting and pin to those SHAs for the cycle.
- Do not create the final review branch before mechanical sync merge lands in `integration/ikentic`.
- Mechanical sync branches contain deterministic-only edits (no manual conflict edits).
- Use elevated permissions when needed in this environment.
- Use `direnv exec . <command>` directly (no manual export shims when using direnv exec).

Deterministic conflict classes:

- Class A: `package.json` files -> upstream-first (`main` / `--theirs`).
- Class B: `pnpm-lock.yaml` -> always regenerate from resolved manifest set.
- Class C: `CHANGELOG.md` files -> integration-maintained lane (`--ours`).
- Class D: all remaining code/config conflicts -> explicit manual resolution with rationale in sync PR.

Session-start ground truth protocol (always run fresh; do not trust prior snapshots):

1. Bootstrap env in worktree:

- `cd .`
- `pnpm install`
- `printf '%s\n' 'source_up' > .envrc` (if missing)
- `direnv allow .`

2. Refresh refs:

- `git fetch origin --prune`
- `git fetch upstream --prune`

3. Branch/ref truth:

- `git rev-parse --abbrev-ref HEAD`
- `git status --short --branch`
- `git rev-parse origin/main`
- `git rev-parse upstream/main`
- `git rev-parse origin/carry/publish`
- `git rev-parse origin/integration/ikentic`
- `git rev-list --left-right --count origin/main...upstream/main`
- `git rev-list --left-right --count origin/main...origin/integration/ikentic`
- `git rev-list --left-right --count origin/carry/publish...origin/integration/ikentic`
- `git for-each-ref --format='%(refname:short) %(objectname)' refs/remotes/origin/pr refs/remotes/origin/carry refs/remotes/origin/topic | sort`

4. PR truth:

- `direnv exec . gh pr list --repo locusai/openclaw --state open --limit 100 --json number,title,headRefName,baseRefName,headRefOid,url`
- `mkdir -p .ikentic/snapshots`
- `SNAP=.ikentic/snapshots/open-main-prs-$(date +%Y%m%d-%H%M%S).json`
- `direnv exec . gh pr list --repo locusai/openclaw --state open --search "base:main head:pr/" --limit 200 --json number,title,headRefName,baseRefName,headRefOid,url > "$SNAP"`

5. Workflow truth:

- `direnv exec . gh api repos/locusai/openclaw/actions/workflows/npm-publish.yml`
- `direnv exec . gh api repos/locusai/openclaw/actions/workflows/docker-release.yml`
- `direnv exec . gh run list --workflow npm-publish.yml --repo locusai/openclaw --limit 30`
- `direnv exec . gh run list --workflow docker-release.yml --repo locusai/openclaw --limit 30`
- `direnv exec . gh run view <latest-successful-npm-run-id> --repo locusai/openclaw --log | rg -n "Resolved IKENTIC bundle spec|Using npm dist-tag|\\+ @locusai/openclaw@"`

6. Tag truth:

- `git ls-remote --tags origin 'v2026.2.*'`

Deterministic main->integration reconciliation protocol:

0. Preferred bootstrap (includes mirror fast-forward + sync branch creation + deterministic auto-resolution):

- `scripts/ikentic/sync-main-into-integration.sh`

1. Create mechanical sync branch:

- `git switch -c topic/sync-main-<stamp>-mechanical origin/integration/ikentic`

2. Merge mirror main:

- `git merge --no-ff origin/main -m "sync integration with mirror main"`

3. Capture conflict-class summary:

- `scripts/ikentic/classify-conflicts.sh`

4. Apply deterministic resolver pass:

- `scripts/ikentic/resolve-sync-conflicts.sh`

5. Mechanical guard:

- if Class D conflicts remain, stop and fail this mechanical attempt (no manual edits in mechanical lane).

6. Port snapshot PR commits that cherry-pick cleanly:

- for each snapshot row in `$SNAP`, verify `origin/<headRefName>` still equals `headRefOid`.
- if any head SHA drift is detected, stop and regenerate snapshot before continuing.
- compute missing commits via `git cherry -v HEAD origin/<headRefName>`.
- `git cherry-pick -x` only cleanly applicable commits.
- on conflict: `git cherry-pick --abort`, record branch/commit as manual backlog for review lane.

7. Regenerate lockfile from resolved manifests:

- `direnv exec . pnpm install --lockfile-only`

8. Validate install deterministically:

- `scripts/ikentic/check-lockfile-gates.sh origin/integration/ikentic topic/sync-main-<stamp>-mechanical`

9. Merge mechanical branch into integration:

- merge/push `topic/sync-main-<stamp>-mechanical` into `integration/ikentic` first.

10. Create final review branch only after mechanical merge:

- `git switch -c topic/sync-main-<stamp>-review origin/integration/ikentic`
- apply only manual backlog and intentional integration-impacting deltas.

11. If validation fails:

- stop and fail the sync branch,
- report concise file-level failure summary,
- do not merge partial state.

Execution objectives:

1. Bring mirror `main` up to spec (ff-only from upstream) when behind.
2. Bring `integration/ikentic` up to spec by merging mechanical sync first, then review-only deltas.
3. Build/publish newest dev release on correct branch route: `topic/release -> carry/publish -> integration/ikentic -> tag`.
4. Validate npm publish evidence lines for plugin spec, dist-tag, and published package version.
5. Keep temporary sync/release branches cleaned up after merge; keep long-lived governance lanes intact.

Use this runbook as source of truth for planning and execution continuity.
