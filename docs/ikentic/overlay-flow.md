---
summary: "Branch strategy and promotion flow for the Ikentic overlay in the OpenClaw fork."
---

# Ikentic Overlay Branch Flow

## Purpose

Keep the OpenClaw fork in sync with upstream while isolating fork-only work and providing a
repeatable path from topic branches to a consolidated integration branch that is safe to share.

## Branch Taxonomy

- `upstream/main`  
  Canonical upstream OpenClaw.
- `fork/main`  
  Fast-forward mirror of `upstream/main` (no fork-only commits).
- `pr/<topic>`  
  Branches intended for upstream PRs.
- `fork/<topic>` or `ike/<topic>`  
  Fork-only changes that may never land upstream.
- `wip/<ikentic-*>`  
  Consolidation branch composed only of merges from topic branches.
- `integration/<ikentic-*>`  
  Promotion target once E2E passes. Prefer `integration/` over `e2e/`.
  Legacy `e2e/ikentic-clean-merge` should be replaced by `integration/ikentic-clean-merge`.

## Non-Negotiables

- **No direct commits** to `wip/*` or `integration/*`.  
  All work happens on topic branches and is merged in.
- `integration/*` is a **fast-forward** of `wip/*` after E2E passes.  
  If a change is needed, create a topic branch and merge into `wip/*`.
- `fork/main` only moves via **fast-forward** from `upstream/main`.

## Consolidation Order (Canonical)

Maintain this list as the source of truth for merges into `wip/ikentic-e2e-parity`:

1. `pr/control-ui-plugin-extensions`
2. `pr/internal-hooks-clear-before-plugins`
3. `pr/docker-uidgid-persistent-bin`
4. `pr/ui-hide-noop-tool-cards`
5. `feat/command-hook-options`
6. `feat/slug-generator-overrides`
7. `pr/docker-compose-healthcheck`
8. `overlay/consolidated-internal-commits`
9. `chore/github-packages-npm-publish` (if still required for the fork)

When a PR lands upstream, remove it from the list and refresh `wip/*` from the updated `fork/main`.

## Promotion Checklist (WIP → Integration)

- All required merges are present in `wip/ikentic-e2e-parity`.
- E2E passes (Docker + persona flow checks as applicable).
- `integration/ikentic-clean-merge` is fast-forwarded from WIP only.

## Maintenance

- Update this doc when the consolidation list changes.
- Keep naming consistent: `integration/*` is preferred for promotion targets.
