# Ikentic Daily Deterministic Sync

This runbook is the daily operator flow for deterministic Ikentic sync governance.

Use this after baseline recovery is completed and keep the same sequence every day.

## Daily Command

Run from repo root:

```bash
scripts/ikentic/daily-deterministic-sync.sh
```

Optional mechanical bootstrap (only when all gates pass):

```bash
scripts/ikentic/daily-deterministic-sync.sh --run-sync
```

## Generated Reports

Reports are written to `${TMPDIR:-/tmp}/ikentic-reports/` by default (override with
`--reports-dir` if you want a repo-local path):

- `gap-<timestamp>.json`
  - Required-lane carry completeness status.
- `inventory-<timestamp>.json`
  - Categorized branch truth for `carry/*`, `pr/*`, and integration-only `feat/*`.
- `daily-summary-<timestamp>.txt`
  - Gate exit codes, ancestry result, and report file paths.

Use these artifacts as the canonical daily evidence.

## Stop/Go Policy

Stop immediately (no mechanical promotion) if any of the following are true:

1. `origin/main` is not an ancestor of `origin/integration/ikentic`.
2. Required carry-lane gap audit exits non-zero.
3. Inventory reports `REVIEW_REQUIRED` or missing commits for `pr/*`.
4. Mechanical sync requires manual conflict edits.

Go to review lane only after:

1. Mechanical lane has been merged into `integration/ikentic`.
2. Remaining unresolved commits are explicitly listed in inventory output.
3. Async-loader disposition is explicit (`21ef80ada...` restored or waived with rationale).

## Required Daily Outputs

Every cycle should produce:

1. The three report files above.
2. A short run log indicating:
   - whether the lane was mechanical-only or review lane,
   - unresolved commit list by category,
   - lockfile/install gate status.

## Operational Notes

- `bun` is the preferred TypeScript runner.
- If `bun` is unavailable, the script falls back to `node --import tsx`.
- Reports default to `/tmp` to avoid repo-polluting artifacts. If you override `--reports-dir`
  to a repo-local path (for example `.ikentic/reports`), keep `.ikentic/` untracked and do not
  commit generated reports.
