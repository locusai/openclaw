# Ikentic Consolidation Matrix

Updated: 2026-02-12

Legend: `Y` = branch head is contained (ancestor) in consolidation branch. `-` = not contained.

| Source branch | wip/ikentic-e2e-parity | rebuild/ikentic-e2e-parity | e2e/ikentic-clean-merge |
| --- | --- | --- | --- |
| pr/control-ui-plugin-extensions | Y | Y | Y |
| pr/internal-hooks-clear-before-plugins | Y | Y | Y |
| pr/docker-uidgid-persistent-bin | Y | Y | Y |
| pr/ui-hide-noop-tool-cards | Y | Y | Y |
| feat/command-hook-options | Y | Y | Y |
| feat/slug-generator-overrides | Y | Y | Y |
| pr/docker-compose-healthcheck | Y | Y | Y |
| overlay/consolidated-internal-commits | Y | Y | - |

Notes:
- `overlay/consolidated-internal-commits` advanced after the legacy E2E merge; `e2e/ikentic-clean-merge` contains an older snapshot, not the current head.
- No `integration/*` branches exist yet.
- PR branches (`pr/*`) are expected to track `origin/*` unless the same ref exists on `upstream`.

## Branch Status (Remotes, Consolidation, Worktrees)

Legend:
- `Upstream`: branch has a configured upstream (remote tracking branch).
- `InConsolidation`: branch head is contained (ancestor) in any consolidation branch
  (`wip/ikentic-e2e-parity`, `rebuild/ikentic-e2e-parity`, `e2e/ikentic-clean-merge`).
- `Worktree`: branch is currently checked out in a worktree.

| Branch | Upstream | InConsolidation | Worktree |
| --- | --- | --- | --- |
| e2e/ikentic-clean-merge | origin/e2e/ikentic-clean-merge | Y | Y |
| feat/command-hook-options | upstream/main | Y | Y |
| feat/slug-generator-overrides | upstream/main | Y | - |
| overlay/consolidated-internal-commits | origin/overlay/consolidated-internal-commits | Y | Y |
| ikentic-hooks-mvp-2026-02-04 | - | - | Y |
| internal-shipping | upstream/main | - | Y |
| main | origin/main | Y | Y |
| plan-onyx-chat-ui | - | - | - |
| pr/control-ui-plugin-extensions | - | Y | Y |
| pr/docker-compose-healthcheck | - | Y | - |
| pr/docker-uidgid-persistent-bin | origin/pr/docker-uidgid-persistent-bin | Y | - |
| pr/internal-hooks-clear-before-plugins | origin/pr/internal-hooks-clear-before-plugins | Y | - |
| pr/openclaw-onyx-split-archive | - | - | - |
| pr/ui-hide-noop-tool-cards | origin/pr/ui-hide-noop-tool-cards | Y | - |
| rebuild/ikentic-e2e-parity | origin/main | Y | Y |
| upstream/archive/new-persona-args-no-user-message | upstream/main | - | - |
| wip/epic-onul-persona-switch-ikentic-tooling-align | - | Y | - |
| wip/epic-onul-persona-switch-pr-stack | upstream/main | Y | - |
| wip/ikentic-e2e-parity | - | Y | Y |

## Branches Not In Any Consolidation

| Branch | Upstream | Worktree |
| --- | --- | --- |
| ikentic-hooks-mvp-2026-02-04 | - | Y |
| internal-shipping | upstream/main | Y |
| plan-onyx-chat-ui | - | - |
| pr/openclaw-onyx-split-archive | - | - |
| upstream/archive/new-persona-args-no-user-message | upstream/main | - |
