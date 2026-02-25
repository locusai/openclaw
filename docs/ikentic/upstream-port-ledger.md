# Upstream Port Ledger (Canonical)

This ledger is the canonical record for `pr/* -> topic/sync-* -> integration/ikentic` ports.

Use this file when patch-id/equivalence checks are ambiguous (common after squash merges).

## Entry Rules

1. One section per upstream PR.
2. Append updates in chronological order under that PR.
3. For each upstream commit reviewed, record one disposition:
   - `ported`
   - `already-present`
   - `superseded`
   - `empty-after-port`
   - `deferred`
4. Every sync merge into integration must append:
   - sync branch name,
   - integration commit SHA,
   - validation run summary.
5. When upstream PR merges to main, append a `merged-upstream` update with merge SHAs and retained integration-only deltas.

## Template

```md
## PR #<number> <slug>

- Upstream PR: <url>
- Origin branch: `origin/pr/<topic>`

### Update <YYYY-MM-DD>

- Upstream head: `<sha>`
- Integration base: `<sha>`
- Sync branch: `topic/sync-<pr-topic>` (or `topic/sync-<pr-topic>-2`)
- Upstream commits reviewed:
  - `<sha>` — `<disposition>` — <note>
- Integrated as:
  - `<integration-commit-sha>` — <summary>
- Validation:
  - <tests/checks and result>
- Status: `pending-upstream` | `merged-upstream` | `closed-no-merge`
```

## PR #14189 ui-hide-noop-tool-cards

- Upstream PR: <https://github.com/openclaw/openclaw/pull/14189>
- Origin branch: `origin/pr/ui-hide-noop-tool-cards`

### Update 2026-02-19

- Upstream head: `16b37bc1a578c1d5565fc91bf79aabcb4bc02eda`
- Integration base: `5467e6342ad619289a92ab4e2aaac30b31836d61`
- Sync branch: `topic/sync-ui-hide-noop-tool-cards-2`
- Upstream commits reviewed:
  - `857a62bc25a82232da7ece4288a88c6cab904995` — `superseded` — conflicted against newer integration-side UI structure; net behavior covered by later per-tool suppression commit.
  - `17c32dc6024071e7ac609f58fb4df853fc4858af` — `already-present` — patch-equivalent behavior already in integration.
  - `05d36af54d58d61b2a3ac5a66848d6219245e451` — `ported` — test coverage tightening.
  - `98ac036dbb9821bfe0ab2528c1f6602a0cd0e564` — `ported` — per-tool suppression logic + tests.
  - `b210cd5d855c4e6b639bc322b647fef9ad6153f6` — `ported` — regression test title alignment.
  - `16b37bc1a578c1d5565fc91bf79aabcb4bc02eda` — `empty-after-port` — formatter-only delta already satisfied after conflict resolution.
- Integrated as:
  - `180b64356` — `sync: port pr/ui-hide-noop-tool-cards updates into integration`
- Validation:
  - `direnv exec . pnpm exec oxfmt --check ui/src/ui/chat/tool-cards.ts ui/src/ui/chat/tool-cards.test.ts` (pass)
  - targeted vitest file path not runnable directly due repo include filter; no standalone test run for this exact file path
- Status: `pending-upstream`

## PR #13709 internal-hooks-clear-before-plugins

- Upstream PR: <https://github.com/openclaw/openclaw/pull/13709> (closed)
- Origin branch: `origin/pr/internal-hooks-clear-before-plugins`

### Update 2026-02-19

- Upstream head: `76aa9b7fc9e5a80aa9e28a7e1615c637f583a4e5`
- Integration base: `5467e6342ad619289a92ab4e2aaac30b31836d61`
- Sync branch: `topic/sync-internal-hooks-clear-before-plugins-2`
- Upstream commits reviewed:
  - `c58cca47b20e6d341e1d63b101e20069e1a2aee1` — `ported` — clear internal hooks before plugin registration.
  - `f77d3976820118fd1fa1f25d4a8cbc31c7ddbd69` — `superseded` — PR-head refresh commit with no additional functional delta.
  - `76aa9b7fc9e5a80aa9e28a7e1615c637f583a4e5` — `empty-after-port` — formatter-only after conflict resolution.
- Integrated as:
  - `97ceded13` — `sync: port pr/internal-hooks-clear-before-plugins updates into integration`
- Validation:
  - `direnv exec . pnpm vitest run src/gateway/server-startup.plugin-internal-hooks.test.ts` (pass)
- Status: `pending-upstream`
