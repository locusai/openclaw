# Ikentic Overlay Consolidation Changelog

This file tracks what is added to the Ikentic overlay consolidation branch as merges are replayed.
Each entry should summarize the practical impact (runtime behavior, UI, docs, infra) and cite the
source branch.

## Consolidation Entries

### pr/control-ui-plugin-extensions
- Functionality: Added gateway + UI support for plugin-provided UI panels (new plugin UI
  loader/runtime, controller wiring, view, and navigation changes).
- Functionality: Added server methods and registry support for plugin UI metadata.
- Functionality: Added tests for plugin UI server methods and runtime behavior.
- Bead: `ikeagent-9881` (PR pending: control-ui-plugin-extensions).
- Upstream PR: Not submitted (pending).

### pr/internal-hooks-clear-before-plugins
- Functionality: Clear internal hook registry once before plugin registration so plugin-registered
  hooks (e.g., session:start) are not wiped during hook discovery.
- Functionality: Adds regression coverage ensuring plugin-registered internal hooks survive gateway
  sidecar hook loading.
- Bead: `ikeagent-9877` (PR submitted: openclaw/openclaw#13709).
- Upstream PR: https://github.com/openclaw/openclaw/pull/13709

### pr/docker-uidgid-persistent-bin
- Functionality: Docker image now tolerates existing UID/GID collisions by remapping node user/group
  and hardens docker-setup behavior (including updated tests and tooling path handling).
- Functionality: Adds IRC channel extension (plugin, config schema, onboarding, and docs).
- Functionality: Refactors config schema hints into a dedicated module and expands provider/tool
  schema coverage for UI hints.
- Functionality: Improves browser/Playwright tool reliability with abort-aware paths and timeouts.
- Bead: `ikeagent-9878` (PR submitted: openclaw/openclaw#13737).
- Upstream PR: https://github.com/openclaw/openclaw/pull/13737

### pr/ui-hide-noop-tool-cards
- Functionality: Suppress tool cards for configured tools when the tool result has no output.
- Functionality: Adds tool display metadata to drive suppression and coverage tests for tool cards.
- Bead: `ikeagent-9879` (PR submitted: openclaw/openclaw#14189).
- Upstream PR: https://github.com/openclaw/openclaw/pull/14189

### feat/command-hook-options
- Functionality: Adds a generic plugin command-option extension framework for core slash commands
  (including `/new`), with option parsing and dispatch to plugin handlers.
- Functionality: Ensures `/new` reset/session handling respects plugin-provided options and avoids
  silent no-reply fallthroughs; adds regression coverage.
- Bead: `ikeagent-62ve` (plugin command-option extensions).
- Upstream PR: Not submitted (pending).

### feat/slug-generator-overrides
- Functionality: Slug generation now respects session model/provider overrides when generating
  LLM-backed slugs, with debug logging for resolved model selection.
- Bead: `ikeagent-9882` (PR pending: feat/slug-generator-overrides).
- Upstream PR: Not submitted (pending).

### pr/docker-compose-healthcheck-clean
- Functionality: Adds gateway healthcheck to the default docker-compose service.
- Bead: `ikeagent-9883` (PR pending: pr/docker-compose-healthcheck-clean).
- Upstream PR: Not submitted (pending).

### ike-overlay/docker-compose
- Functionality: Adds Ikentic overlay compose files for ephemeral and host-mounted setups.
- Functionality: Adds `.env.ikentic.example` to document Ikentic overlay environment variables.
- Functionality: Overlay compose files now load environment variables via `env_file: .env`.
- Functionality: `.env.ikentic.example` clarifies public issuer usage and host state examples.
- Functionality: Adjusts plugin registry handling used by the overlay.
- Bead: `ikeagent-9884` (PR pending: ike-overlay/docker-compose).
- Upstream PR: Not submitted (pending).
