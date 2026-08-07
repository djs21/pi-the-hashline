## Context

Current `grep` implementation uses blocking `execSync` and plain text parsing of `rg` stdout. This is fragile when paths contain colons or when output has encoding issues. It also lacks cross-tool guidelines to nudging the agent to use it efficiently.

## Goals / Non-Goals

**Goals:**
- Port `grep` tool to use `spawn` and stream output line-by-line using Node's `readline` and `rg --json`.
- Safely extract paths and content, decoding base64 `bytes` if `text` is missing/invalid.
- Gate grep guidelines on `config.grep`.
- Inject cross-tool guidelines in `read.ts` and `edit.ts` pointing to `grep` tool benefits.
- Create tests for all of these paths.

**Non-Goals:**
- Modifying standard hashline parsing or hashing logic.
- Adding new global configurations other than `config.grep` which is already defined.

## Decisions

- **NDJSON parsing**: parse `begin`, `match`, and `end` events from `rg --json`. The `end` event (specifically the `end` or `summary` record) may be parsed to detect the `rg` exit status or search metrics, and ensure graceful handling of execution state.
- **Base64 decoding**: `rg --json` represents invalid UTF-8 lines via the `bytes` field (base64 encoded). We will fallback to decoding `bytes` to string if `text` is not provided.
- **Test Runner**: Node's built-in `node:test` test runner will be used (requiring zero external test dependencies).
- **Spawn Error Handling**: Implement error event listener on `spawn` (e.g. `on('error')` for missing binary or permission errors) and handle exit code 2 gracefully, returning error info to caller rather than crashing.
- **Limit Enforcement**: Pass `--max-count N` directly to `rg` per-file, and maintain an in-memory counter of matching lines streamed to immediately close the readline stream/kill child process once global `limit` is reached.
- **Dynamic guidelines**: Modify `registerGrepTool`, `registerReadTool`, and `registerEditTool` to inject dynamic guidelines at registration time or check config dynamically. Since `promptGuidelines` can be a dynamic getter or function if supported by Pi, or we can resolve config dynamically if the framework supports it. Note: `registerTool` description/guidelines are static at registration time. Let's inspect Pi's `registerTool` interface to see if we can check config at registration. `loadConfig()` reads sync from file, so we can check it easily at tool registration in `registerGrepTool`/`registerReadTool`/`registerEditTool`.

## Risks / Trade-offs

- Ripgrep versions must support `--json`. `rg` v11+ supports it. Since standard `pi-coding-agent` uses `--json` in its own grep tool, this is safe.
- Dynamic guidelines only update on tool load/session refresh. This is completely standard.
