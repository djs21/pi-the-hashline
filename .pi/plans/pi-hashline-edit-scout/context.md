# pi-hashline-edit — Full Technical Report

**Repo**: https://github.com/RimuruW/pi-hashline-edit (v0.8.3)
**npm**: `pi install npm:pi-hashline-edit`
**License**: MIT

---

## File Structure

```
index.ts                       ← Extension entrypoint (3 tool registrations)
src/
  config.ts                    ← ~/.pi/agent/hashline.json loader, singleton
  hashline.ts                  ← Barrel re-export for hashline module
  hashline/
    hash.ts                    ← xxh32, NIBBLE_STR alphabet, context-based line hashing
    parse.ts                   ← Anchor type, prefix regex, resolveEditAnchors, display-prefix rejection
    apply.ts                   ← 3-phase edit engine (validate, resolve, assemble)
    format.ts                  ← formatHashlineRegion, computeAffectedLineRange, computeChangedLineRange
  edit.ts                      ← edit tool registration, pipeline, snapshot recovery
  edit-diff.ts                 ← Line-ending normalization, diff generation (unified-style)
  edit-normalize.ts            ← Dialect convergence (native Pi shapes → canonical {path, edits})
  edit-response.ts             ← Response builders (buildChangedResponse, buildNoopResponse)
  edit-render.ts               ← TUI rendering (diff formatting, markdown, color themes)
  read.ts                      ← read tool registration, hashline output formatting
  grep.ts                      ← grep tool registration, ripgrep async wrapper
  snapshot.ts                  ← Stat-based snapshotId (mtime+size) for host UI
  read-snapshot.ts             ← Per-path multi-version LRU snapshot store (8 paths × 4 versions, 32MiB cap)
  merge.ts                     ← 3-way merge (structuredPatch + applyPatch, fuzzFactor 0)
  file-kind.ts                 ← Text/binary/image/directory detection via file-type + null-byte scan
  fs-write.ts                  ← Atomic write (temp file + rename), symlink resolution, hardlink preservation
  noop-loop-guard.ts           ← Noop/duplicate-edit detection (hard limit=3)
  path-utils.ts                ← ~ expansion, relative→absolute resolution
  prompt-loader.ts             ← Read prompt .md, rewrite anchor examples to configured hash length
  runtime.ts                   ← throwIfAborted helper
prompts/
  edit.md                      ← edit tool prompt (ops, rules, examples)
  edit-snippet.md              ← snippet for tool call
  edit-guidelines.md           ← bullet guidelines
  read.md                      ← read tool prompt
  read-snippet.md
  read-guidelines.md
  grep.md                      ← grep tool prompt
  grep-snippet.md
docs/
  FAQ.md
  adr/                         ← 7 ADRs covering key design decisions
test/                          ← Vitest test suite (core/, tools/, integration/, prompts/, support/)
```

---

## Exported Functions / Tools

### Extension Entrypoint (`index.ts:5-32`)

```ts
export default function (pi: ExtensionAPI): void
```

Registers three tools:
- `read` — `registerReadTool(pi)` (always)
- `edit` — `registerEditTool(pi)` (always)
- `grep` — `registerGrepTool(pi)` (only if config `grep: true` AND `rg` on PATH)

Also hooks `session_start` to emit config warnings + optional debug banner (`PI_HASHLINE_DEBUG=1`).

### 1. read Tool (`src/read.ts:129-224`)

**Schema**: `{ path: string, offset?: int, limit?: int, raw?: boolean }`

- Text files → `LINE#HASH:content` per line
- Images (JPEG, PNG, GIF, WebP) → pass-through to built-in Pi `read` (attachment)
- Binary/directory → rejected with descriptive error
- `raw: true` → plain content, no hash prefixes
- Updates multi-version snapshot store (non-raw only)
- Clears duplicate-edit guard on non-raw reads
- Truncation notices include exact `nextOffset` for paging

**Key function**: `formatHashlineReadPreview()` at `src/read.ts:61-120` — splits lines, applies offset/limit, calls `formatHashlineRegion`, handles truncation.

### 2. edit Tool (`src/edit.ts:280-495`)

**Schema**: `{ path: string, edits: Array<{ op, pos?, end?, lines?, oldText?, newText? }> }`

**Ops** (`src/hashline/parse.ts:54-59`):

| Op | Fields | Behavior |
|---|---|---|
| `replace` | `pos`, `end?`, `lines` | Replace line at `pos` (single) or range `pos`..`end` (inclusive). `lines: []` deletes the span. |
| `append` | `pos?`, `lines` | Insert after `pos`; omit `pos` → EOF. |
| `prepend` | `pos?`, `lines` | Insert before `pos`; omit `pos` → BOF. |
| `replace_text` | `oldText`, `newText` | Exact unique substring replace. Disabled via config `replaceText: false`. |

**Pipeline** (`executeEditPipeline` at `src/edit.ts:122-252`):

1. **Access check** — `fs.access` with R_OK (+ W_OK for execute)
2. **File kind detection** — `loadFileKindAndText` rejects non-text
3. **Normalization** — BOM strip, line-ending detection, normalize to LF
4. **Anchor resolution** — `resolveEditAnchors()` parses LINE#HASH → typed edits
5. **Direct apply** — `applyHashlineEdits()` (see below)
6. **Stale-anchor recovery** — On `[E_STALE_ANCHOR]`, iterate snapshots via `getReadSnapshotVersions()`, replay + 3-way-merge (`threeWayMerge` in `src/merge.ts`)
7. **Write** — `writeFileAtomically()`
8. **Response** — `buildChangedResponse()` or `buildNoopResponse()`

**Key hooks**:
- `prepareArguments` — calls `normalizeEditRequest()` then `assertEditRequest()`; also checks `replaceText` not disabled
- `renderCall` — async preview via `computeEditPreview()` (diff against current file)
- `execute` — full pipeline, writes file, updates snapshot store + noop guard

### 3. grep Tool (`src/grep.ts:141-272`)

**Schema**: `{ pattern: string, path?, glob?, ignoreCase?, literal?, context?: 0-5, limit?: 1-200 }`

- Registers only when config `grep: true` AND `rg` on PATH (`isRgAvailable()` at `src/grep.ts:27-35`)
- Spawns ripgrep with `--json` output, parses match events asynchronously (`runRg` at `src/grep.ts:90-139`)
- Returns `LINE#HASH:content` lines using `formatHashlineRegion` (same format as `read`)
- Merges context ranges per file; updates snapshot store for edit's stale-anchor recovery
- Default limit 50, max 200

### Helper Functions (public exports from `src/hashline.ts`)

| Function | File:Line | Purpose |
|---|---|---|
| `computeLineHash` | `hash.ts:56-60` | Hash a line at index within file lines array |
| `computeHashFromContext` | `hash.ts:37-46` | Core hash: `xxh32(prev + "\0" + curr + "\0" + next)` → nibble-encoded string |
| `resolveEditAnchors` | `parse.ts:215-265` | Validate + parse tool-schema edits → typed `HashlineEdit[]` |
| `applyHashlineEdits` | `apply.ts:304-331` | 3-phase engine: validate anchors → resolve spans → assemble result |
| `computeAffectedLineRange` | `format.ts:22-48` | Post-edit range with context for anchor chaining |
| `formatHashlineRegion` | `format.ts:50-62` | Render `LINE#HASH:content` for a line range |
| `computeChangedLineRange` | `format.ts:68-119` | Character-level diff → first/last changed line numbers |

---

## Hash Generation (`src/hashline/hash.ts`)

**Alphabet** (`hash.ts:27`): `ZPMQVRWSNKTXJBYH` — 16 chars, no hex digits (except B), no confusable letters (D/G/I/L/O), no common vowels (A/E/I/O/U). Each char encodes exactly one nibble (4 bits).

**Context-based hashing** (`hash.ts:37-46`):
```
xxh32(prev + "\0" + curr + "\0" + next) → low 4*len nibbles → NIBBLE_STR encoding
```

- `prev`, `curr`, `next` are normalized via `normalizeHashInput` (strip `\r`, `trimEnd`)
- Neighbors outside file bounds = `""`
- Hash length from config (2-4, default 2)
- Editing line N invalidates anchors for N-1, N, N+1 only

**Hash validation** includes:
1. **Exact match** — computed hash === anchor hash
2. **TextHint questioning** (`apply.ts:237-243`): hash matches but `:content` suffix doesn't → treat as stale (anti-collision guard)
3. **Forgiveness** (`apply.ts:244-257`): hash mismatched but recomputed with hint text + current neighbors matches, and hint fuzzy-matches line → accept with warning
4. **Fuzzy normalization** (`hash.ts:82-93`): Unicode smart quotes, hyphens, spaces → ASCII equivalents for `hintMatchesLine`

---

## Edit/Read Replacement Logic

### Read Output Format (`src/hashline/format.ts:50-62`)

```
  LINE#HASH:content
```

- Line numbers are 1-indexed, left-padded to column alignment
- Hash is `computeLineHash` at that line index
- Display-prefix rejection (`src/hashline/parse.ts:65-82`) uses regex matching ALL supported hash lengths (2-4), not just session length — stale transcripts from different-length configs are still caught.

### Edit Application (`src/hashline/apply.ts`)

**Phase 1 — Validate anchors** (`validateAnchorEdits` at `apply.ts:173-272`):
- Every `pos`/`end` anchor hash is verified against current file content
- Range OOB → `[E_RANGE_OOB]`
- Stale anchors → `[E_STALE_ANCHOR]` with "Did you mean" candidates when textHint is present (max 8 total, 3 per anchor)
- Warns on duplicate inserts, boundary duplication, single-anchor replace with multiple lines

**Phase 2 — Resolve spans** (`resolveEditSpans` at `apply.ts:278-301`):
- `resolveEditToSpan()` maps each typed edit to a `{kind, start, end, replacement}` character span
- Noop detection: if replacement matches current content exactly → noopEdits list
- Deduplicates identical spans (same key)
- Conflict detection: overlapping replaces, insert-inside-replace, same-boundary inserts → `[E_EDIT_CONFLICT]`
- Sorts back-to-front (`end` descending) for safe in-place assembly

**Phase 3 — Assemble** (`assembleEditResult` at `apply.ts:303-315`):
- String slicing from back to front, offsets remain valid
- Empty-file edge cases handled for insert modes

### Snapshot Merge Recovery (`src/edit.ts:176-240`, `src/merge.ts`)

When direct apply throws `[E_STALE_ANCHOR]`:
1. Get all stored versions for path (`getReadSnapshotVersions`, newest first)
2. Skip versions matching live content
3. Replay edit against each historical version (`applyHashlineEdits`)
4. 3-way merge: base=snapshot, base-edited=replay result, current=live file
5. `threeWayMerge()` uses `structuredPatch` + `applyPatch` with `fuzzFactor: 0`
6. First successful merge returned with `"Recovered stale anchors..."` warning
7. If all fail, original error augmented with diagnostic suffix

---

## Configuration (`src/config.ts`)

**File**: `~/.pi/agent/hashline.json` (loaded once at module init)

| Key | Type | Default | Valid | Effect |
|---|---|---|---|---|
| `hashLength` | int | 2 | 2,3,4 | Characters per line hash |
| `grep` | bool | false | Boolean | Register grep tool (needs `rg` on PATH) |
| `replaceText` | bool | true | Boolean | Allow `replace_text` op |

- Missing file → defaults silently
- Invalid field → fallback to default + one-time session warning (never throws)
- Validation precedes all regex/encoder construction

**Prompt rewriting** (`src/prompt-loader.ts`):
- Anchor examples in `.md` prompts (authored at 2 chars) are padded to session hash length
- When `replaceText: false`, `replace_text` op description stripped from prompts
- All rewrite is in-memory at load time

---

## Noop Loop Guard (`src/noop-loop-guard.ts`)

- Tracks consecutive noop edits per path (same payload key)
- Hard limit = 3 → throws `[E_NOOP_LOOP]`
- Also tracks last successfully applied payload per path for duplicate-edit detection (`[E_DUPLICATE_EDIT]`)
- Cleared on deliberate re-read

---

## Atomic Writes (`src/fs-write.ts`)

- Temp file (`wx` mode, 0o600) → rename → target
- Resolves symlink chains to real files
- Hard-linked files: writes in-place to preserve inode sharing
- Preserves existing file permissions

---

## Dependencies

| Package | Version | Use |
|---|---|---|
| `diff` | ^8.0.2 | Diff generation, structuredPatch/applyPatch for 3-way merge |
| `file-type` | ^21.3.0 | MIME detection for text/binary/image classification |
| `xxhashjs` | ^0.2.2 | xxHash32 for line hashing |
| `@earendil-works/pi-coding-agent` | >=0.74.0 | Extension API, tool registration, createReadTool, TUI theme |
| `@earendil-works/pi-tui` | * | Text/Markdown rendering components |
| `@sinclair/typebox` | * | JSON schema type definitions for tool parameters |

---

## Key Design Decisions (ADRs)

1. **0001** — 2-char hashes by default (token economy)
2. **0002** — Edit success returns only fresh anchors in text, never full file; details carry structured data (diff, classification)
3. **0003** — Context-based hashing (prev+curr+next ±1 window)
4. **0004** — Snapshot-merge stale-anchor recovery (fuzzFactor 0, never slide)
5. **0005** — Multi-version LRU snapshot store (8×4 paths/versions, 32MiB cap)
6. **0006** — User config for hash length (2-4) and grep opt-in
7. **0007** — Opt-out replace_text op via config

## Gotchas

- **No silent relocation** — stale anchors always throw; the runtime never slides to "close enough"
- **Content hashes are session-length-specific** — anchors from different hash-length configs produce a dedicated error, not generic format error
- **Display prefixes in `lines` are rejected** — model must send literal file content, never `LINE#HASH:` or diff `+/-` prefixes
- **Edit payloads are validated bottom-up** — resolved spans are sorted back-to-front, but the anchor validation and rejection of overlaps are checked before assembly
- **Snapshot store is LRU** — oldest versions evicted first, up to 8 paths × 4 versions each; total 32MiB ceiling
- **`replace_text` is a second-class citizen** — disabled via config, and even when enabled, it's a substring search without the hash verification that the other ops provide
- **Bare `HH:` prefixes** (issue #24) — a line starting with a hash character followed by `:` (e.g. `KK:### heading`) is ambiguously a legitimate file line or a bare hash prefix. The runtime warns but does NOT reject or strip these.
- **Fuzzy anchors via textHint** — the `:content` suffix on an anchor enables forgiveness for whitespace/Unicode drift, but only when the hint fuzzy-matches the actual line AND the recomputed hash matches against current neighbors
