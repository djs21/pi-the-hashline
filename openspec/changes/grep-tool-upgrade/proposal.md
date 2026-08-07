## Why

Grep tool has weak nudging, runs blockingly using `execSync`, lacks binary/invalid UTF-8 handling via NDJSON streaming, and has no tests. 

## What Changes

- Upgrade `grep` to a first-class slice.
- Nudge LLM to use `grep` over `read` for search. Nudge output formats to match `edit` tool expectations.
- Use asynchronous `spawn` + readline NDJSON streaming for ripgrep (`rg --json`).
- Safely handle invalid UTF-8 bytes in matches.
- Gate prompt guidelines injection behind `grep: true` config.
- Add robust unit/integration tests for the grep tool.

## Capabilities

### New Capabilities
- `grep-tool-upgrade`: Upgrade the grep tool with non-blocking JSON-streaming, UTF-8 robustness, and cross-tool nudging.

### Modified Capabilities
<!-- None -->

## Impact

- Affects `src/grep.ts`, `src/config.ts`, `src/index.ts`, `src/read.ts`, `src/edit.ts`.
- Adds tests under `tests/grep.test.ts`.
