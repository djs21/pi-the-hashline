## 1. Task Group 1: Grep Tool Implementation (grep.ts)

- [ ] 1.1 Update `registerGrepTool` to parse parameters, spawn `rg --json`, stream NDJSON via `readline`, extract matching and context lines, fallback to `bytes` base64 decoding for invalid UTF-8, and format into hashline matches. Must enforce limit parameter using both `--max-count` per-file and a global in-stream counter (close the stream and kill the child process once limit is reached). Must gracefully catch spawn/permission errors and non-zero exit code 2 to return error message instead of crashing. Must parse `end`/`summary` records to determine final status.
- [ ] 1.2 Add `promptGuidelines` in grep.ts, gated on `config.grep`.

## 2. Task Group 2: Cross-Nudge Addition (read.ts, edit.ts)

- [ ] 2.1 Update `registerReadTool` in `src/read.ts` to add a prompt guideline suggesting `grep` when `config.grep` is enabled.
- [ ] 2.2 Update `registerEditTool` in `src/edit.ts` to add a prompt guideline indicating grep output matches edit format when `config.grep` is enabled.

## 3. Task Group 3: Test Suite (tests/)

- [ ] 3.1 Create `tests/grep.test.ts` to verify streaming, UTF-8 base64 fallback, limits, context, and guidelines injection. Use `node:test` (Node's built-in test runner, zero extra dependencies) for tests.
- [ ] 3.2 Add test runner/script configuration to package.json, configuring `"test": "node --import tsx --test tests/**/*.test.ts"` or similar built-in script.
