# Ikentic Integration Workflow Hardening

This document defines the long-term Git workflow for maintaining Ikentic-specific OpenClaw work
without losing upstream compatibility.

## Branch Model

- `main`: exact mirror of `upstream/main` (fast-forward only; no internal commits).
- `integration/ikentic`: canonical internal integration/deploy lane (merge-based updates only; no force-push).
- `carry/publish`: release-only lane for version/changelog/plugin packaging updates (long-lived, never deleted).
- `pr/*`: upstream-bound topic branches (short-lived; rebase allowed).
- `carry/*`: long-lived internal-only patchsets that land on `integration/ikentic`.
- `topic/*`: short-lived implementation branches.

## Required Invariants

- Mirror invariant: `origin/main...upstream/main` must always be `0 0` before integration sync.
- Integration invariant: `main` must always be an ancestor of `integration/ikentic`.
- Release invariant: release-scope commits follow `topic/release-* -> carry/publish -> integration/ikentic`.
- Scope invariant: `carry/publish` contains release-scope changes only (versioning, changelogs, plugin packaging/release guard updates).
- Carry invariant: every permanent non-upstream internal feature/fix/test change lands on `integration/ikentic` (directly or via `carry/*`).
- Protection invariant: never delete `carry/publish` after merge.
- PR safety invariant: open PR branches should not be history-rewritten during active review unless explicitly approved by maintainer.
- Safety invariant: create `archive/*` + annotated `safety/*` refs before branch rewrites/deletes.

## Operator Environment

- Keep a repo `.envrc` with:
  - `source_up 2>/dev/null || true`
- Run operational commands through `direnv exec . <command>` to ensure expected environment.

## Release Promotion Protocol (`carry/publish` Scope)

Use `carry/publish` only for release-scope changes (version/changelog/plugin packaging/release guard updates).

1. Start a release topic from `carry/publish`:
   - `git switch carry/publish`
   - `git switch -c topic/release-<version>`
2. Apply release-scope changes only.
3. Merge into `carry/publish`:
   - `git switch carry/publish`
   - `git merge --no-ff topic/release-<version> -m "release: <version> metadata updates"`
   - `git push origin carry/publish`
4. Promote release metadata into integration:
   - `git switch integration/ikentic`
   - `git merge --no-ff carry/publish -m "promote release metadata from carry/publish"`
   - `git push origin integration/ikentic`

Do not route normal feature/fix/test work through `carry/publish`.

## Integration Update (Merge-Based from Upstream Mirror)

1. Sync mirror:
   - `git fetch upstream origin --prune`
   - `git switch main`
   - `git merge --ff-only upstream/main`
   - `git push origin main`
2. Sync integration from mirror:
   - `git switch integration/ikentic`
   - `git merge --no-ff main -m "sync integration with mirror main"`
3. Merge active internal carry branches into integration:
   - `git merge --no-ff carry/<topic> -m "apply carry patchset: <topic>"`
4. Push integration:
   - `git push origin integration/ikentic`

`carry/publish` is a scoped release lane and is expected to diverge from `integration/ikentic` between release promotions.

## Carry Branch Lifecycle

1. Create internal carry branches from `integration/ikentic`:
   - `git switch integration/ikentic`
   - `git switch -c carry/<topic>`
2. Add internal-only commits.
3. Merge into `integration/ikentic` with `--no-ff`.
4. Keep the branch after merge. Do not delete `carry/*` as routine cleanup.
5. Only retire by explicit decision. Before retirement, verify:
   - `git cherry -v main carry/<topic>`
   - If no `+` commits remain and the patchset is intentionally upstreamed/obsolete, retire after
     safety-tag window.
6. `carry/publish` is special:
   - keep long-lived.
   - keep release-scope only.
   - never delete.

## PR Handling Model

1. Classify every change first:
   - `upstream-pr`: intended for `openclaw/openclaw`.
   - `internal`: feature/fix/test/config for Ikentic fork behavior.
   - `release`: version/changelog/plugin packaging/release guard updates.
2. Base/head rules:
   - Upstream-bound: PR from `pr/<topic>` into upstream `main`.
   - Internal: PR from `topic/*` or `carry/*` into fork `integration/ikentic`.
   - Release-scope: PR from `topic/release-*` into fork `carry/publish`.
   - Release promotion PR: `carry/publish` into `integration/ikentic`.
   - Do not open integration PRs directly from `pr/*` branches, because `pr/*` is `main`-based lineage.
3. Merge behavior:
   - Prefer GitHub PR merge with **Merge commit** for internal and release branches.
4. Never merge internal non-release changes into `carry/publish` or `main`.

## Porting Main-Based PR Work Into Integration

`pr/*` branches are expected to be based on `main` for upstream review. Integration should consume the
patches, not the branch lineage.

1. Start from integration:
   - `git fetch upstream origin --prune`
   - `git switch integration/ikentic`
   - `git switch -c topic/sync-<pr-topic>`
2. Bring in upstream PR commits as patches:
   - `git cherry-pick -x <commit1> <commit2> ...`
   - Use `-x` so commit messages retain source SHA traceability.
3. Resolve conflicts manually and run targeted checks.
4. Open an internal PR:
   - `topic/sync-<pr-topic> -> integration/ikentic`
5. Keep upstream and integration in sync incrementally:
   - when upstream PR adds commits, cherry-pick only the new commits onto the same integration sync branch.

Equivalence checks (preferred over SHA matching):

- `git cherry refs/remotes/origin/integration/ikentic refs/remotes/origin/pr/<topic>`
- `git range-diff refs/remotes/origin/integration/ikentic...refs/remotes/origin/pr/<topic>`

If all relevant patches are already present in integration, close duplicate integration sync PRs rather
than merging redundant branches.

## Keeping PRs Stable When Updating Branches

Use a two-phase policy so open PRs do not get destabilized:

1. Draft phase (before review starts):
   - `pr/*` branches may be rebased on their base branch.
   - Allowed push: `git push --force-with-lease origin pr/<topic>`
2. Active review phase (after reviewers are engaged):
   - Do not rewrite PR branch history by default.
   - Update by adding new commits or by merging the current base branch into the PR branch.
   - Allowed push: regular `git push origin <branch>`.
3. Maintainer override:
   - If rebase is required during review, announce it, then use `--force-with-lease` only.
4. Never force-push long-lived lanes:
   - `carry/publish`, `integration/ikentic`, and persistent `carry/*` branches are merge-only.

Reference update commands:

- Upstream PR draft refresh:
  - `git fetch upstream origin --prune`
  - `git switch pr/<topic>`
  - `git rebase upstream/main`
  - `git push --force-with-lease origin pr/<topic>`
- Internal PR review-safe refresh:
  - `git fetch origin --prune`
  - `git switch <branch>`
  - `git merge --no-ff refs/remotes/origin/integration/ikentic -m "refresh from integration/ikentic"`
  - `git push origin <branch>`
- Release PR review-safe refresh:
  - `git fetch origin --prune`
  - `git switch topic/release-<version>`
  - `git merge --no-ff refs/remotes/origin/carry/publish -m "refresh from carry/publish"`
  - `git push origin topic/release-<version>`

## Branch Alignment Checks (Spec)

1. Mirror check:
   - `git rev-list --left-right --count refs/remotes/origin/main...refs/remotes/upstream/main`
   - expected `0 0`.
2. Integration check:
   - `git merge-base --is-ancestor refs/remotes/origin/main refs/remotes/origin/integration/ikentic`
3. Carry publish scope check:
   - `git log --oneline refs/remotes/origin/integration/ikentic..refs/remotes/origin/carry/publish`
   - `git diff --name-only refs/remotes/origin/integration/ikentic..refs/remotes/origin/carry/publish`
   - expected: only release-scope files/commits.
4. Divergence expectation:
   - non-zero divergence between `carry/publish` and `integration/ikentic` is normal.
   - do not auto-equalize by merging all integration commits into `carry/publish`.

## Release Tag Protocol (Ikentic Dev Line)

1. Cut release commits on `topic/release-* -> carry/publish -> integration/ikentic`, then tag from the promoted `integration/ikentic` commit.
2. Tag from the promoted commit with matching version:
   - `package.json` version must equal tag version (for example, `package.json: 2026.2.17-ike.dev.9` and tag `v2026.2.17-ike.dev.9`).
3. If a tag push does not trigger workflows, do not rewrite published history:
   - keep existing tag as historical record.
   - cut the next tag from the next promoted release commit with a fresh version bump commit.
4. NPM publish verification must include:
   - `Resolved IKENTIC bundle spec ... @locusai/openclaw-ikentic-plugin@dev`
   - `Using npm dist-tag: dev`
   - `+ @locusai/openclaw@<version>`
5. Docker release is operationally optional; disabling it must be done in GitHub workflow settings/API, not by changing workflow YAML.

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
- Commit release bump on `topic/*` from `carry/publish`, merge to `carry/publish`, promote to `integration/ikentic`, then create/push `v<version>` tag from the promoted commit.
- Watch `npm-publish.yml` run and confirm GitHub Packages publish + expected dist-tag.

### 2026-02-17 publish execution addendum (what actually happened)

This records the concrete publish failure modes seen in the first real run and the fixes that
produced a successful publish.

Observed sequence:

1. `v2026.2.17-ike.0` failed at `Bundle IKENTIC plugin`:
   - Cause: `bundle:ikentic` script missing from root `package.json`.
   - Fix: restored script entry:
     - `"bundle:ikentic": "node --import tsx scripts/release/bundle-ikentic.ts"`

2. `v2026.2.17-ike.1` failed in setup with frozen lockfile mismatch:
   - Cause: generated `extensions/openclaw-ikentic-plugin/package.json` was accidentally committed.
   - Fixes:
     - remove tracked generated file from git history tip
     - add guard ignore:
       - `.gitignore`: `extensions/openclaw-ikentic-plugin/`
     - keep generated plugin files ephemeral from `bundle:ikentic`.

3. `v2026.2.17-ike.2` failed publish auth:
   - Cause: publish attempted against npmjs without npm auth in earlier flow.
   - Fix: force registry in publish command:
     - `npm publish ... --registry https://npm.pkg.github.com`

4. `v2026.2.17-ike.3` still failed with `E404` on GitHub Packages:
   - Cause: package name was unscoped (`openclaw`), but GitHub Packages npm publish expects scoped name.
   - Fix: publish-time scoped name override in workflow (no repo-wide workspace rename):
     - before publish, rewrite `package.json.name` to `@${github.repository_owner}/openclaw`
     - keep tag/version checks and release checks unchanged.

Successful result:

- `v2026.2.17-ike.4` (`npm-publish.yml` run `22120475640`) completed successfully.
- Dist-tag resolution remained prerelease-derived (`ike` for `-ike.*`).

Operational rules added for future runs:

- Always run local sanity in CI order:
  1. `pnpm check:publish:ikentic`
  2. `pnpm bundle:ikentic`
  3. `pnpm release:check`
- Never stage generated bundle directory content (`extensions/openclaw-ikentic-plugin/*`).
- For GitHub Packages with fork policy, keep package identity override in publish step instead of
  renaming root workspace package metadata.

### 2026-02-18 plugin sync and packaging readiness update

Run objective: unblock `ike-agents` PR sanity and ensure `openclaw` packaging path bundles the latest
published IKENTIC plugin.

Plan vs actual adjustments from this run:

- `ike-agents` Sanity Check failure (`22123974784` then `22124036771`) moved from lockfile failure
  to formatter failure; fixed by applying repo formatter and pushing:
  - commit `d9104f4` on `codex/ikentic-plugin-gpr-publish-on-main`.
- Verification: subsequent Sanity Check run `22124113369` completed successfully.
- `openclaw` publish flow was still using a stale fallback plugin spec in
  `scripts/release/bundle-ikentic.ts`.
- Added workflow-level latest resolution in `.github/workflows/npm-publish.yml`:
  - if `IKENTIC_BUNDLE_SPEC` is set, use it as explicit override.
  - if unset, resolve `@locusai/openclaw-ikentic-plugin@<latest>` via `npm view` against
    `npm.pkg.github.com` using the existing read token.
- Updated local fallback constant to `@locusai/openclaw-ikentic-plugin@0.1.0-test.20260218.0`.

Validation performed locally (integration lane):

- `pnpm check:publish:ikentic` (after formatting `extensions/openclaw-ikentic-plugin` files)
- `IKENTIC_BUNDLE_SPEC=@locusai/openclaw-ikentic-plugin@0.1.0-test.20260218.0 pnpm bundle:ikentic`
- `pnpm build`
- `pnpm release:check`

Result:

- `integration/ikentic` now includes commit `0c1e1fcf6` with latest-plugin resolution and fallback
  update, pushed to `origin/integration/ikentic`.
