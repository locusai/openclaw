# Ikentic Changelog

This changelog tracks Ikentic-specific branch work that is not represented in the root project
`CHANGELOG.md`.

## Unreleased

### Source: `pr/control-ui-plugin-extensions`

- Added gateway and UI support for plugin-provided UI panels (plugin UI loader/runtime, controller
  wiring, view, and navigation updates).
- Added server methods and registry support for plugin UI metadata.
- Added tests for plugin UI server methods and runtime behavior.
- Bead: `ikeagent-9881`.
- Upstream PR: pending.

### Source: `pr/internal-hooks-clear-before-plugins`

- Clear internal hook registry once before plugin registration so plugin-registered hooks (for
  example, `session:start`) are not wiped during hook discovery.
- Added regression coverage to ensure plugin-registered internal hooks survive gateway sidecar hook
  loading.
- Bead: `ikeagent-9877`.
- Upstream PR: [openclaw/openclaw#13709](https://github.com/openclaw/openclaw/pull/13709).

### Source: `pr/docker-uidgid-persistent-bin`

- Docker image now tolerates existing UID/GID collisions by remapping node user/group and hardening
  `docker-setup` behavior (including tests and tooling path handling).
- Added IRC channel extension (plugin, config schema, onboarding, and docs).
- Refactored config schema hints into a dedicated module and expanded provider/tool schema coverage
  for UI hints.
- Improved browser/Playwright tool reliability with abort-aware paths and timeouts.
- Bead: `ikeagent-9878`.
- Upstream PR: [openclaw/openclaw#13737](https://github.com/openclaw/openclaw/pull/13737).

### Source: `pr/ui-hide-noop-tool-cards`

- Suppress tool cards for configured tools when the tool result has no output.
- Added tool display metadata to drive suppression behavior and tool card coverage tests.
- Bead: `ikeagent-9879`.
- Upstream PR: [openclaw/openclaw#14189](https://github.com/openclaw/openclaw/pull/14189).

### Source: `feat/command-hook-options`

- Added a generic plugin command-option extension framework for core slash commands (including
  `/new`) with option parsing and dispatch to plugin handlers.
- Ensured `/new` reset/session handling respects plugin-provided options and avoids silent
  no-reply fallthroughs; added regression coverage.
- Bead: `ikeagent-62ve`.
- Upstream PR: pending.

### Source: `feat/slug-generator-overrides`

- Slug generation now respects session model/provider overrides when generating LLM-backed slugs,
  with debug logging for resolved model selection.
- Bead: `ikeagent-9882`.
- Upstream PR: pending.

### Source: `pr/docker-compose-healthcheck`

- Added a gateway healthcheck to the default Docker Compose service.
- Bead: `ikeagent-9883`.
- Upstream PR: pending.

### Source: `overlay/consolidated-internal-commits`

- Added Ikentic overlay compose files for ephemeral and host-mounted setups.
- Added `.env.ikentic.example` to document Ikentic overlay environment variables.
- Updated overlay compose files to load environment variables via `env_file: .env`.
- Clarified public issuer usage and host state examples in `.env.ikentic.example`.
- Adjusted plugin registry handling used by the overlay.
- Bead: `ikeagent-9884`.
- Upstream PR: pending.
