# tests/ — Extension Test Suite

## Purpose
Runnable tests for pi-the-hashline tools. Currently covers the grep tool (NDJSON streaming, encoding, limits, nudging).

## Ownership
- Entire tests/ directory — test files and fixtures
- Tests exercise the REAL tool implementation via fake-pi registerTool capture + execute (no reimplemented logic)

## Local Contracts
- **Runner** — node:test via `npm test` (`node --import tsx --test tests/**/*.test.ts`). tsx is a devDependency (Node native type-stripping cannot resolve `.js` → `.ts` ESM specifiers used across src/)
- **Config isolation** — tests back up `~/.pi/agent/hashline.json` to `.bak` and restore in after(); crashed-run recovery via existing `.bak`
- **Fixtures** — tests/fixtures/ committed, written fresh per run
- **Grep tool tests** — match collection + hashline format, regex vs literal, ignoreCase, context, limit (per-file + global kill path), invalid UTF-8 bytes, no-matches grace

## Work Guidance
(empty)

## Verification
`npm test` — all tests must pass before merge. Current: 8 tests.

## Child DOX Index
(leaf directory — no children)
