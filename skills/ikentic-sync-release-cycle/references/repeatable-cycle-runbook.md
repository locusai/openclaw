Run the repeatable Ikentic cycle: sync mirror main, port latest upstream PR updates into integration correctly, then cut/publish newest dev release with governance compliance.

Workspace:

- `.`

Mandatory docs and why:

1. [Branch Governance Spec](docs/ikentic/branch-governance-spec.md)
   Why: defines canonical routing and merge policy by branch type.
2. [AGENTS.md](AGENTS.md)
   Why: required branch-management safety rules and execution conventions.
3. [Ikentic Releasing Guide](docs/ikentic/RELEASING.md)
   Why: fork release branch/tag/publish order and Ikentic-specific checks.
4. [CI Guide](docs/ci.md)
   Why: confirms expected workflow triggers and gating behavior.

Invariant policy:

- `main` mirrors `upstream/main` via ff-only.
- `integration/ikentic` is the only internal deploy lane.
- `carry/publish` is release-only and never deleted.
- No carry-publish equalization.
- Main-based upstream PRs are integrated by cherry-picking missing commits into fresh `topic/sync-*` branches.
- Dev release flow is always `topic/release -> carry/publish -> integration/ikentic -> tag`.
- Changelog maintenance is separate from dependency reconciliation. Do not use changelog conflicts to choose dependency versions.
- Snapshot open main-based PR heads before mechanical porting and pin to those SHAs for the cycle.
- Do not create the final review branch before mechanical sync is merged into `integration/ikentic`.
- Mechanical branches are deterministic-only; manual conflict edits are review-lane work.
- Use `direnv exec . <command>` directly and elevated permissions when needed.

Deterministic conflict classes:

- Class A: `package.json` files -> upstream-first (`main` / `--theirs`).
- Class B: `pnpm-lock.yaml` -> always regenerate from resolved manifest set.
- Class C: `CHANGELOG.md` files -> integration-maintained lane (`--ours`).
- Class D: all remaining code/config conflicts -> explicit manual resolution with rationale in sync PR.

Repeatable execution checklist:

Phase A: Session truth load

- Bootstrap env (`pnpm install`, `.envrc` with `source_up`, `direnv allow .`).
- Fetch origin/upstream with prune.
- Capture divergence counts, branch heads, open PR list, workflow states/runs, and current remote tags.
- Stage current ikentic helper scripts into tmp before long replay/rebuild runs:
  - `scripts/ikentic/cli.sh stage-tools`
- Refresh first-parent ledger and validate coverage/ordering:
  - `scripts/ikentic/cli.sh ledger-refresh`
  - `scripts/ikentic/cli.sh ledger-validate`
- Snapshot open main-based PR heads for this cycle (pin SHAs):
  - `scripts/ikentic/cli.sh snapshot-open-prs .ikentic/snapshots/open-main-prs-$(date +%Y%m%d-%H%M%S).json`

Phase B: Upstream mirror sync

- If `origin/main...upstream/main` shows origin behind, run:
  - `git switch main`
  - `git merge --ff-only upstream/main`
  - `git push origin main`

Phase C: Mechanical sync branch (must merge first)

- Preferred bootstrap (includes Phase B ff-only mirror step):
  - `scripts/ikentic/cli.sh sync-main`
- Create mechanical branch from integration:
  - `git switch -c topic/sync-main-<stamp>-mechanical origin/integration/ikentic`
- Merge mirror main into mechanical branch:
  - `git merge --no-ff origin/main -m "sync integration with mirror main"`
- Classify conflicts:
  - `scripts/ikentic/cli.sh classify-conflicts`
- Apply deterministic resolver pass:
  - `scripts/ikentic/cli.sh resolve-conflicts`
- If Class D conflicts remain, stop and fail this mechanical attempt (do not hand-edit).
- Port snapshot PR patches that cherry-pick cleanly:
  - For each entry in `$SNAP`, verify `git rev-parse origin/<headRefName> == <headRefOid>` before porting.
  - If any head SHA drift is detected, stop and regenerate snapshot.
  - Use `git cherry -v HEAD origin/<headRefName>` to list missing commits.
  - `git cherry-pick -x` only commits that apply cleanly.
  - On conflict, `git cherry-pick --abort`, record branch/commit as manual backlog, and continue mechanical-only ports.
- Mechanical branch must contain only deterministic edits (mirror merge, class-resolved files, clean cherry-picks).
- Regenerate lockfile from resolved manifests:
  - `direnv exec . pnpm install --lockfile-only`
- Validate lockfile/install gates:
  - `scripts/ikentic/cli.sh check-lockfile-gates origin/integration/ikentic topic/sync-main-<stamp>-mechanical`
- Merge mechanical branch into `integration/ikentic` first (direct merge/push is allowed for mechanical lane).

Phase D: Final review branch (post-mechanical only)

- Create review branch from updated `origin/integration/ikentic` head:
  - `git switch -c topic/sync-main-<stamp>-review origin/integration/ikentic`
- Apply only:
  - snapshot PR commits that required manual resolution,
  - intentional integration-impacting deltas not safe for mechanical lane.
- Open final review PR from this branch.

Phase E: Dev release publish

- Determine next dev version/tag from remote tags.
- Create release branch from `carry/publish`.
- Apply release version/bundle updates for latest dev plugin line.
- Merge release branch into `carry/publish`.
- Promote `carry/publish` into `integration/ikentic`.
- Before tagging, enforce lockfile gates on integration head:
  - `scripts/ikentic/cli.sh check-lockfile-gates origin/integration/ikentic HEAD`
- Tag from integration head and push tag.

Phase F: Publish verification

- Confirm npm workflow is active and run completed for the tag.
- Verify logs include:
  - `Resolved IKENTIC bundle spec ... @locusai/openclaw-ikentic-plugin@dev`
  - `Using npm dist-tag: dev`
  - `+ @locusai/openclaw@<target-dev-version>`
- Confirm docker workflow state only; do not change unless explicitly requested.

Phase G: Documentation/governance hygiene

- Governance doc changes go through `carry/docs` branch and proper promotion.
- Keep AGENTS as pointer/gate, not duplicated governance policy.
- Add changelog entries when integration/release behavior changes.

Required sync PR evidence:

- Snapshot artifact path and timestamp used for mechanical ports.
- Conflict-class summary (Class A/B/C auto-resolved + Class D manual rationale).
- Manual backlog list from snapshot branches (conflicted/skipped commits).
- Mechanical merge commit SHA merged into `integration/ikentic` before review branch creation.
- Lockfile regeneration command output.
- Frozen-lockfile validation output.

Use this runbook as source of truth for planning and execution continuity.
