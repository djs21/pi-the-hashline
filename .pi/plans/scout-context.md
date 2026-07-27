# pi-hashline — Technical Reconnaissance Report

**Repo:** https://github.com/YanwuZeng/pi-hashline  
**Version:** 0.2.0  
**License:** MIT  
**Language:** TypeScript (ESM, jiti-registered)  
**Pi peer deps:** `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`

---

## File Structure (3,315 LOC in 22 source files)

```
index.ts                 18     Extension entry — registers read/edit tools + /hash-edit-status command
src/
  read.ts               122     read# tool: hashline-format file reading with snapshot recording
  edit.ts               179     edit# tool: hashline-DSL file editing via Patcher pipeline
  patcher.ts            302     **Core pipeline**: prepare (tag validation/recovery/block resolve) → apply → commit
  apply.ts              417     Line-edit engine: atomic ops, bottom-up sort, landing-shift, self-healing
  parser.ts             376     **Parser state machine**: token feed → Executor → Edit[] (parsePatch)
  tokenizer.ts          344     **Tokenizer**: line-by-line scanner → tokens (header/op-block/payload-literal/etc.)
  block-resolver.ts     235     Brace-matching BlockResolver (TS/JS/Java/C/C++/Go/Rust/C#)
  block.ts              110     ResolveBlockEdits — .BLK ops → concrete line edits
  input.ts              134     Patch class: split multi-file [path#TAG] sections from raw diff text
  format.ts             142     Hashline format constants + computeFileHash (xxHash32 → 4-hex tag)
  snapshots.ts           94     InMemorySnapshotStore (LRU-cached content snapshots + seen lines)
  recovery.ts           110     Stale-tag 3-way merge (diff3) recovery with version-chain walk
  messages.ts           149     All error/warning message formatters
  mismatch.ts            84     MismatchError class + display helpers
  fs.ts                  70     Filesystem abstraction (NodeFilesystem / InMemoryFilesystem)
  noop-loop-guard.ts     61     Fixation-loop breaker (3 consecutive identical no-ops → hard fail)
  normalize.ts           35     BOM stripping, line-ending detection & normalization
  prefixes.ts           100     Hashline prefix stripping heuristics (N: prefixes, + prefixes)
  shared.ts              70     Path resolution, compactPreview, splitLines, line range formatting
  prompts.ts             13     Loads prompt/ guidelines files at registration time
  types.ts               95     Pure data types (Anchor, Cursor, Edit, ApplyResult, BlockSpan, etc.)
  diff-preview.ts         1     Re-exports buildCompactDiffPreview from apply.ts
prompts/
  read.md                26    LLM prompt snippet for read tool usage
  edit.md                28    LLM prompt snippet for edit tool usage
test/
  auto-verify.test.ts         13 manual-test scenarios verified via hashline DSL
  hashline-smoke.test.ts      10 smoke tests (parser + apply + format round-trips)
  integration-edit-cycle.test.ts 8 integration tests (Patcher end-to-end, CRLF, BOM, diff preview)
  regression-edge-cases.test.ts 10 regression tests (multi-hunk drift, INS.POST dupe, mixed ops)
  robustness.test.ts          28 robustness tests (P0-P6: block resolver, noop guard, recovery, all-or-nothing)
  manual-tests/                13 scenario directories (source/expected/prompt per scenario)
```

---

## Architecture Overview

### How it Hooks into Pi

`index.ts:6-8` — default export receives `ExtensionAPI`:
```
registerReadTool(pi)     → registers read# tool
registerEditTool(pi)     → registers edit# tool
pi.registerCommand("hash-edit-status") → /hash-edit-status command
```

- **readSchema** (`read.ts:16-27`): `{ path: string, offset?: number, limit?: number }`
- **editSchema** (`edit.ts:33-48`): `{ diff?: string, edits?: [{diff?}], path?: string }`
  - `prepareArguments` (`edit.ts:62-84`) normalizes Pi's native `{edits: [{diff}]}` and direct `{diff}` formats

### The Hashline Mechanism

**Hash generation** (`format.ts:105-112`):
1. Normalize text: strip trailing `[ \t\r]` from every line (`format.ts:99`)
2. Compute `xxHash32` (WASM) of normalized text, mask to low 16 bits
3. Format as 4-char uppercase hex → e.g. `"1A2B"`

**Read flow** (`read.ts:46-104`):
1. Read file from disk
2. Split into lines, format as `N:content`
3. Record snapshot: `snapshotStore.record(absolute, text, seenLines)` → stores full text + computed hash + set of displayed line numbers
4. Return `[path#TAG]` header + `N:content` lines + continuation hint if truncated

**Edit flow** (`patcher.ts:62-158`):
1. **Parse**: `splitPatchInput` splits multi-file `[path#TAG]` sections (`input.ts:70-116`)
2. **For each section**, `Patcher.prepare()`:
   a. Read file, strip BOM, detect line ending, normalize to LF
   b. `parsePatch(section.text)` → `Edit[]` via tokenizer + state machine (`parser.ts`)
   c. `resolveBlockEdits()` — convert `.BLK` ops to concrete line edits via brace-matching scanner (`block.ts`)
   d. **Tag validation**:
      - If `liveHash !== section.fileHash`:
        - HEAD/TAIL-only edits → apply with warning (position-stable)
        - Else → try `recovery.ts` 3-way merge against historical snapshots
        - If recovery fails → `MismatchError` thrown (no file written — all-or-nothing)
      - If tag matches → check unseen lines (edit anchored on line never displayed → error)
      - If no tag → only HEAD/TAIL allowed
   e. `applyEdits(normalized, edits)` → applies grouped atomic ops bottom-up
3. **Commit** (`patcher.ts:162-190`): write file with preserved BOM + line endings, record new snapshot, format result

### The Edit/Read Replacement Logic

**Parser** (`parser.ts` — `Executor` class):
1. Tokenizer yields tokens: `header`, `op-block`, `payload-literal`, `blank`, `raw`, `envelope-begin/end`, `abort`
2. Executor feeds tokens and accumulates `Edit[]`:
   - `SWAP N.=M:` → replacement inserts (mode="replacement", cursor="before_anchor") + deletes for lines N-M
   - `DEL N.=M` → delete edits for each line in range
   - `INS.PRE N:` → insert (cursor="before_anchor")
   - `INS.POST N:` → insert (cursor="after_anchor")
   - `INS.HEAD:` → insert (cursor="bof")
   - `INS.TAIL:` → insert (cursor="eof")
   - `SWAP.BLK N:` / `DEL.BLK N` / `INS.BLK.POST N:` → block edit (resolved later)
   - Auto-prefixes bare body rows with `+` (warning emitted)
   - Rejects `-` rows (minus-rows not valid in hashline)

**Applier** (`apply.ts` — `applyEdits`):
1. `groupAtomicOps()` — groups consecutive replacement inserts + deletes into single "replace" ops; batching per anchor
2. `mergeConsecutiveOps()` — merges same-anchor INS.POST/PRE payloads together (prevents duplication bug)
3. `repairReplacementBoundaries()` — self-heal: drops last payload row if it exactly duplicates structural closer just past range
4. Sort operations **bottom-up** (descending anchor line) with stable tiebreaker — prevents line-number drift
5. Apply each op via splice operations on the lines array
6. `computeInsertAfterLanding()` — adjusts landing line for `INS.POST` when body is shallower than anchor (skips structural closers to maintain nesting)

**Block Resolution** (`block-resolver.ts` — `findBraceBlock`):
- State machine scanning character-by-character through the file text
- Tracks depth of `{}`, skipping braces inside:
  - Line comments (`//`)
  - Block comments (`/* */`)
  - String literals (`'`, `"`, `` ` ``)
  - Template literals
  - Regex literals (heuristic: regex vs division via preceding keyword/char set)
- Returns `{ start, end }` for the block opener at anchor line
- Returns `null` when:
  - Anchor is inside a block (closer at depth 0 before any opener)
  - Braces unbalanced
  - Anchor out of range
  - Single-line blocks (`{ ... }` on same line) — returns start==end

**Recovery** (`recovery.ts`):
1. Look up snapshot by (path, fileHash)
2. If snapshot text == current text → just apply edits (session chain)
3. Else → apply edits to snapshot text, compute structuredPatch diff (`diff` library), apply patch to current text with `fuzzFactor: 0` (never slides onto duplicate)
4. Walk ALL historical versions (via `SnapshotStore.versions()`) trying each as merge base
5. Returns merged text + warnings on success, `null` on total failure

---

## Exported API / Tools

### Tool registrations

| Tool | Name | File:Line | Schema |
|------|------|-----------|--------|
| `read` | `read#` | `read.ts:29` | `{ path: string, offset?: number, limit?: number }` |
| `edit` | `edit#` | `edit.ts:49` | `{ diff?: string, edits?: any[], path?: string }` |

### Command

| Command | File:Line | Description |
|---------|-----------|-------------|
| `/hash-edit-status` | `index.ts:10` | Shows whether extension is loaded |

### Key Exported Functions

| Function | File:Line | Purpose |
|----------|-----------|---------|
| `computeFileHash(text)` | `format.ts:105` | xxHash32 → 4-char hex tag |
| `parsePatch(diff)` | `parser.ts:358` | Hashline DSL text → `{ edits: Edit[], warnings: string[] }` |
| `applyEdits(oldText, edits)` | `apply.ts:234` | Edits → new text + firstChangedLine + warnings |
| `buildCompactDiffPreview(before, after)` | `apply.ts:307` | Context diff preview for UI |
| `splitPatchInput(input, options)` | `input.ts:70` | Split multi-file `[path#TAG]` sections |
| `Patch` class | `input.ts:118` | Constructor takes raw diff text + cwd, exposes `.sections` |
| `Patcher.apply(patch)` | `patcher.ts:55` | Full pipeline: prepare → commit for all sections (all-or-nothing) |
| `MismatchError` | `mismatch.ts:48` | Thrown on hash mismatch with rich display context |
| `recover(store, args)` | `recovery.ts:60` | 3-way merge recovery from stale hash |
| `findBraceBlock(text, line)` | `block-resolver.ts:84` | Brace block span for .BLK ops |
| `hasBlockEdit(edits)` | `block.ts:21` | Check if any `block`-kind edits exist |
| `resolveBlockEdits(edits, text, path, resolver)` | `block.ts:28` | Convert .BLK ops to concrete edits |
| `NoopLoopGuard` | `noop-loop-guard.ts:18` | Fixation-breaker (3 identical no-ops → throw) |

### SnapshotStore Interface

| Method | File:Line | Description |
|--------|-----------|-------------|
| `head(path)` | `snapshots.ts:18` | Latest snapshot for path |
| `byHash(path, hash)` | `snapshots.ts:19` | Snapshot by (path, hash) |
| `versions(path)` | `snapshots.ts:20` | All snapshots for path, oldest first |
| `record(path, text, seenLines?)` | `snapshots.ts:22` | Store new snapshot, returns hash |
| `invalidate(path)` | `snapshots.ts:25` | Clear snapshots for path |
| `clear()` | `snapshots.ts:26` | Clear all snapshots |

---

## Configuration Mechanism

- **No user-facing configuration files.** All behavior is hardcoded or derived from tool parameters.
- Default max read lines: `400` (`shared.ts:5`)
- Default max read bytes: `32 KiB` (`shared.ts:6`)
- Hash tag length: `4` hex chars (`format.ts:74`)
- Noop-loop limit: `3` consecutive identical no-ops (`noop-loop-guard.ts:20`)
- Snapshot store: LRU cache, `100` paths max, `10` versions per path (`snapshots.ts:29-31`)
- Prompt guidelines loaded from `prompts/read.md` and `prompts/edit.md` at registration time (`prompts.ts`)
- Block resolver language support: brace-delimited languages only (TS/JS/Java/C/C++/Go/Rust/C#)
- Recovery fuzz factor: `0` (never slides hunk onto closer dupe) (`recovery.ts:9`)

---

## Dependencies

| Package | Version | Used In | Purpose |
|---------|---------|---------|---------|
| `diff` | ^9.0.0 | `recovery.ts` | `structuredPatch` / `applyPatch` for 3-way merge |
| `lru-cache` | ^11.5.1 | `snapshots.ts` | `LRUCache` for snapshot store |
| `typebox` | ^1.1.38 | `read.ts`, `edit.ts` | Runtime type schemas for Pi tool parameters |
| `xxhash-wasm` | ^1.1.0 | `format.ts` | `xxHash32` WASM for content hash tags |
| `@mariozechner/jiti` | ^2.6.5 | test runner | ESM TypeScript loader for Node `--test` |

---

## Key Patterns & Conventions

1. **CRLF/BOM preservation**: `normalize.ts` detects, strips, restores BOM and line endings throughout the pipeline
2. **All-or-nothing writes**: `Patcher.apply()` prepares all sections in memory; if any fails, no file is written (`patcher.ts:57-63`)
3. **Bottom-up edit application**: edits sorted descending by anchor line to prevent drift (`apply.ts:259-263`)
4. **Seen-lines enforcement**: edits referencing lines the model never saw via read get rejected (`patcher.ts:203-223`)
5. **Tag binding**: every read mints a hash; every edit validates against it; every successful edit mints a fresh hash
6. **Error messages include context**: `MismatchError.formatDisplayMessage` shows ±2 lines around anchors with markers (`messages.ts:9-28`)
7. **Parser state machine**: `Executor` class in `parser.ts` processes token stream, emits `Edit[]` with warnings
8. **Multi-file diffs**: `Patch` class splits input on `[path#TAG]` headers, each section processed independently
9. **Self-healing**: trailing body row duplicating a structural closer just past range gets dropped (`apply.ts:197-229`)
10. **Fixation breaker**: `NoopLoopGuard` keyed by `(canonicalPath, payloadKeyHash)` hard-fails after 3 identical no-ops

---

## Gotchas

1. **Hash tag is lowercase-hex from xxHash32 but uppercased in headers** — `format.ts:112` calls `.toUpperCase()` on output, `tokenizer.ts:134` also uppercases parsed tags. Tag comparison is case-insensitive during parse but uppercase-normalized for storage.
2. **Trailing whitespace normalization** affects hashes — `computeFileHash` strips trailing `[ \t\r]` from each line before hashing (`format.ts:99`). This means files differing only in trailing whitespace produce the same hash.
3. **Block resolver is language-limited** — only brace-delimited languages work. Python/indent-based blocks always return `null`. The resolver also has a regex-vs-division heuristic that could misidentify pathological regex literals with balanced braces (e.g., `/}{/`).
4. **No user-facing config exposed** — max lines (400), max bytes (32KB), noop limit (3), snapshot path limit (100), version limit (10) are all hardcoded constants.
5. **Recovery uses `fuzzFactor: 0`** — this is deliberate but means even a single changed context line outside the hunk can cause recovery to fail completely.
6. **Snapshot store is in-memory only** — `InMemorySnapshotStore` (`snapshots.ts:27`) is the only implementation. Snapshots do not persist across Pi sessions.
7. **`diff` library's `applyPatch`** is the 3-way merge engine — this is a third-party dependency with its own edge cases around context matching.
8. **`prepareArguments` in edit.ts** normalizes Pi's native `{edits: [{diff}]}` format but only uses the **first** element of the `edits` array (`edit.ts:70-76`).
9. **`splitPatchInput` uses `lastIndexOf('#')`** to find the hash separator in headers (`tokenizer.ts:124`) — paths containing `#` would be misparsed. The code partially guards against this (`input.ts:35` rejects headers where `pathText.includes("#")`) but the tokenizer doesn't have this guard.
10. **`INS.HEAD`/`INS.TAIL` drift exemption** — stale tags are non-fatal for head/tail inserts (`patcher.ts:103-112`), which is safe but could surprise a model expecting strict enforcement.
