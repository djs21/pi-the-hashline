# Context: pi-the-hashline extension exploration

## File Tally

**19 files, 1471 lines (source), 1576 total (incl. DESIGN.md, package.json)**

| File | Lines | Role |
|------|-------|------|
| `src/index.ts` | 42 | Extension entry: registers read/edit/grep + status command |
| `src/types.ts` | 53 | Shared types: HashConfig, EditOp, ApplyResult, params |
| `src/config.ts` | 49 | Loads `~/.pi/agent/hashline.json` (hashLength, grep toggle) |
| `src/hash.ts` | 48 | xxHash32 + NIBBLE_STR encoding, context-based (prev\\0curr\\0next) |
| `src/format.ts` | 45 | Hashline format/parse: `LINE#HASH:content`, `[path#TAG]` header |
| `src/tokenizer.ts` | 113 | Line-by-line tokenizer: 9 op types, HEADER, PAYLOAD, ABORT, BLANK, RAW |
| `src/parser.ts` | 119 | Token stream → per-file sections of ParsedEdit[], block resolution |
| `src/block-resolver.ts` | 141 | Char-level brace-matching state machine for .BLK ops |
| `src/apply.ts` | 144 | Bottom-up edit application, self-healing, landing-shift, range checks |
| `src/read.ts` | 95 | read tool: hashline output, image passthrough, snapshot recording, truncation |
| `src/edit.ts` | 189 | edit tool: DSL parse → hash validate → apply → stale-anchor recovery |
| `src/grep.ts` | 114 | grep tool: ripgrep wrapper with hashline-formatted output |
| `src/snapshot.ts` | 111 | LRU cache of VersionRing (10/path) for stale-anchor recovery |
| `src/recovery.ts` | 57 | 3-way merge recovery using snapshots as merge base |
| `src/noop-guard.ts` | 48 | Fixation breaker: 3 identical noop edits → hard fail |
| `src/fs.ts` | 74 | File kind detection, atomic writes (temp+rename), text read |
| `prompts/read.md` | 8 | Read tool prompt guidelines |
| `prompts/edit.md` | 21 | Edit tool DSL prompt guidelines |
| `DESIGN.md` | 105 | Design document (not counted in src) |
| `package.json` | — | Valid JSON, 3 deps, 4 peer deps |

## Project Structure

```
pi-the-hashline/
  package.json       — ESM module, deps: xxhash-wasm, diff, lru-cache
  DESIGN.md           — Architecture & design decisions
  prompts/
    read.md           — Agent prompt for read tool
    edit.md           — Agent prompt for edit tool
  src/
    index.ts          — Extension entry point
    config.ts         — Config loader
    hash.ts           — xxHash32 + NIBBLE_STR encoding
    format.ts         — Hashline format/parse utilities
    tokenizer.ts      — DSL line-by-line tokenizer
    parser.ts         — Token stream → Edit[] state machine
    block-resolver.ts — Brace-matching for .BLK operations
    apply.ts          — Edit application engine (bottom-up)
    read.ts           — read tool registration & execution
    edit.ts           — edit tool registration & execution
    grep.ts           — grep tool (opt-in, requires ripgrep)
    snapshot.ts       — LRU multi-version snapshot store
    recovery.ts       — 3-way merge stale-anchor recovery
    noop-guard.ts     — Fixation breaker (3 noops → fail)
    fs.ts             — Atomic file writes + file-kind detection
    types.ts          — Shared type definitions
  .pi/                — Agent scaffolding artifacts
```

## Conventions

- **ESM only**: `"type": "module"` in package.json, all imports use `.js` extension even for `.ts` sources
- **Async init pattern**: `initHash()` returns a shared promise; idempotent, safe to call multiple times
- **Error codes**: ALL user-facing errors use `[E_CODE]` prefix (e.g., `[E_STALE_ANCHOR]`, `[E_NOOP_LOOP]`, `[E_FILE_NOT_FOUND]`)
- **Config via file**: `~/.pi/agent/hashline.json` — lazy-loaded, cached, validated with fallback defaults
- **Generator for tokenizer**: `tokenize()` is a generator yielding `Token` objects
- **Immutable edits pipeline**: `parseDiff → resolveBlockEdits → applyEdits` — each stage transforms EditOp
- **Bottom-up application**: edits sorted descending by line number to avoid index drift
- **Atomic writes**: write to `.tmp-{random}-{timestamp}`, then rename to target
- **No test files found**: no `*.test.ts`, `*.spec.ts`, or `__tests__` directories present

## Dependencies

| Package | Version | Usage |
|---------|---------|-------|
| `xxhash-wasm` | ^1.1.0 | WASM-accelerated xxHash32 for context-based line hashing |
| `diff` | ^7.0.0 | `structuredPatch` / `applyPatch` for 3-way stale-anchor recovery |
| `lru-cache` | ^11.0.0 | LRU cache for snapshot store (max 100 paths) |
| `@earendil-works/pi-coding-agent` | >=0.74.0 | Peer — provides ExtensionAPI, tool registration, TUI |
| `@earendil-works/pi-tui` | * | Peer — TUI abstractions |
| `typebox` | * | Peer — parameter schema validation |
| `@earendil-works/pi-ai` | * | Peer — AI abstractions |

No TypeScript config file (`tsconfig.json`) found — likely uses the parent Pi agent's tsconfig.

## Key Findings

1. **Hashline is a read/edit overlay**: replaces the coding agent's native `read` and `edit` tools with versions that emit/validate line-level hashes. Each line in read output carries `LINE#HASH:` prefix; edit validates anchors against live content hashes before applying.

2. **Context-sensitive hashing**: `xxh32(prevLine + "\0" + currLine + "\0" + nextLine)` — hash depends on neighbors. Editing line N invalidates hashes for N-1, N, N+1.

3. **NIBBLE_STR alphabet**: 16-char custom alphabet (`ZPMQVRWSNKTXJBYH`) — no hex digits except B, no vowels, no confusable chars. Hash length configurable 2-4, default 2.

4. **Edit DSL with 9 operations**: SWAP, DEL, INS.PRE, INS.POST, INS.HEAD, INS.TAIL, SWAP.BLK, DEL.BLK, INS.BLK.POST. Block ops use character-level brace-matching state machine (skips strings, comments, regex).

5. **Safety mechanisms**: noop-loop guard (3 consecutive identical noops → error), seen-lines enforcement (edits referencing undisplayed lines rejected), self-healing (drops duplicate structural closers), stale-anchor recovery (3-way merge against snapshots), all-or-nothing multi-file commits.

6. **Grep tool is opt-in**: requires `grep: true` in config AND `rg` (ripgrep) on PATH. Disabled by default.

7. **No tests exist**: the project has zero tests — any changes risk silent regressions.

8. **No tsconfig.json**: assumes the parent agent provides compilation config.

## Gotchas

- **Hash validation is file-level, not per-line**: edit uses a composite tag from first 4 line hashes, not individual line anchors. Per-line anchors are only in the read display for human reference.
- **HEAD/TAIL edits bypass anchor validation**: `isHeadTailOnly()` skips the tag mismatch check — these ops are considered position-stable.
- **Normalization before hashing**: trailing whitespace (space/tab) is stripped via `trimEnd()`, but `\r` is stripped separately. This means whitespace-only changes after the last non-whitespace char are invisible to the hash.
- **Context-sensitive hash means edits affect neighbors**: replacing one line changes hashes for 3 lines (prev, curr, next). Multi-line edits compound this.
- **Snapshots are LRU-cached in memory**: no on-disk persistence. Restarting the agent loses all snapshots, disabling stale-anchor recovery.
- **Self-healing only fires on CLOSER_RE lines**: `CLOSER_RE = /^\s*[}\])]\s*$/` — only braces, parens, brackets. Does not apply to other structural patterns.
- **`render-dir` references in prompts**: the parent agent's `render-dir` command is mentioned in prompts but no longer exists — may cause confusion.
- **No tsconfig/build config**: project relies entirely on the parent Pi agent's TypeScript compilation setup. Standalone builds not possible without setup.
