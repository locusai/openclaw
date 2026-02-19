Run the repeatable Ikentic cycle: sync mirror main, port latest upstream PR updates into integration correctly, then cut/publish newest dev release with governance compliance.

Workspace:

- .

Mandatory docs and why:

1. [Branch Governance Spec](docs/ikentic/branch-governance-spec.md)
   Why: defines canonical routing and merge policy by branch type.
2. [AGENTS.md](AGENTS.md)
   Why: required branch-management safety rules and execution conventions.
3. [Releasing Guide](docs/reference/RELEASING.md)
   Why: exact release branch/tag/publish order and checks.
4. [CI Guide](docs/ci.md)
   Why: confirms expected workflow triggers and gating behavior.

Invariant policy:

- `main` mirrors `upstream/main` via ff-only.
- `integration/ikentic` is the only internal deploy lane.
- `carry/publish` is release-only and never deleted.
- No carry-publish equalization.
- Main-based upstream PRs are integrated by cherry-picking missing commits into fresh `topic/sync-*` branches.
- Dev release flow is always topic/release -> carry/publish -> integration/ikentic -> tag.
- Use `direnv exec . <command>` directly and elevated permissions when needed.

Repeatable execution checklist:

Phase A: Session truth load

- Bootstrap env (`pnpm install`, `.envrc` with `source_up`, `direnv allow .`).
- Fetch origin/upstream with prune.
- Capture divergence counts, branch heads, open PR list, workflow states/runs, and current remote tags.

Phase B: Upstream mirror sync

- If `origin/main...upstream/main` shows origin behind, run:
  - `git switch main`
  - `git merge --ff-only upstream/main`
  - `git push origin main`

Phase C: Integration porting from main-based PRs
For each selected `origin/pr/*` branch:

- Compute missing patch set relative to integration:
  - `git cherry -v origin/integration/ikentic origin/pr/<branch>`
- Create fresh port branch from integration:
  - `git switch -c topic/sync-<name>-<n> origin/integration/ikentic`
- Cherry-pick only missing commits (`-x`).
- Reapply required integration-only overlay hunks if needed.
- Validate tests/checks.
- Open/merge PR into `integration/ikentic`.
- Delete temporary sync branch local+remote after merge.

Phase D: Dev release publish

- Determine next dev version/tag from remote tags.
- Create release branch from `carry/publish`.
- Apply release version/bundle updates for latest dev plugin line.
- Merge release branch into `carry/publish`.
- Promote `carry/publish` into `integration/ikentic`.
- Tag from integration head and push tag.

Phase E: Publish verification

- Confirm npm workflow is active and run completed for the tag.
- Verify logs include:
  - `Resolved IKENTIC bundle spec ... @locusai/openclaw-ikentic-plugin@dev`
  - `Using npm dist-tag: dev`
  - `+ @locusai/openclaw@<target-dev-version>`
- Confirm docker workflow state only; do not change unless explicitly requested.

Phase F: Documentation/governance hygiene

- Governance doc changes go through `carry/docs` branch and proper promotion.
- Keep AGENTS as pointer/gate, not duplicated governance policy.
- Add changelog entries when integration/release behavior changes.

Use this runbook as source of truth for planning and execution continuity.
