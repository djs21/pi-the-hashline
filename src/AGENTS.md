# src/ — Hashline Extension Core

## Purpose
Hashline-anchored read/edit/grep tools for pi coding-agent. Replaces pi's built-in read and edit with LINE#HASH:-formatted output and hash-validated edits.

## Ownership
- Entire src/ directory — all extension source code
- No file outside src/ owns extension logic

## Local Contracts
- **Tool registration** — All tools register via `ExtensionAPI` in `index.ts` entry point
- **read.ts** — LINE#HASH: prefix per line, offset/limit pagination (400 lines/32KB default cap), raw:true mode, 10-line TUI preview with Ctrl+O expand. Cross-nudge (config.grep): suggests grep first for locating strings/patterns/definitions
- **edit.ts** — Discriminated schema: `op:"replace_text"` (oldText/newText) + `op:"hashline"` ([path#TAG] DSL). convertReplaceTextEdits() bridges Pi native format into hashline sections. Pipeline: parse → validate (stale-anchor check with synthetic tag) → apply → snapshot → diff display. Guards: E_AMBIGUOUS_MATCH (duplicate oldText), E_EMPTY_OLDTEXT, whitespace-normalized fallback, E_REPLACE_TEXT_DISABLED config. Fixes 2026-07-27: off-by-one startLine + section overwrite. Fixes 2026-07-28: all error paths `throw` instead of `return { isError: true }` so agent loop propagates isError=true to TUI (background merah). Fixes 2026-07-28: `convertReplaceTextEdits` single-line substring replacement now preserves surrounding text (prefix+suffix on match line) instead of replacing entire line. Cross-nudge (config.grep): grep output anchors usable directly without re-reading.
- **grep.ts** — ripgrep wrapper with LINE#HASH: output. NDJSON streaming via spawn + readline (`rg --json`), bytes base64 fallback for invalid UTF-8, per-file `--max-count` + global in-stream limit with child kill, throw-on-error convention (spawn error, exit 2+). promptGuidelines nudge toward grep usage + anchor reuse in edit. Auto-downloads rg from GitHub if not on PATH
- **parser.ts** — State-machine DSL parser: tokenizer → parseDiff → Section[] with optional BLK resolution
- **config.ts** — Loads ~/.pi/agent/hashline.json. Keys: hashLength (2-4), grep (bool), replaceText (bool, default true)
- **hash.ts** — Context-based FNV-1a 32-bit: computeLineHash(prev + "\0" + curr + "\0" + next), `>>> 0` unsigned. NIBBLE_STR alphabet (ZPMQVRWSNKTXJBYH, 16 chars, no vowels/hex). Synchronous, zero deps (replaced xxHash32 WASM 2026-07-30)
- **apply.ts** — Applies edit ops to file content. Bottom-up sorting for line-number stability
- **block-resolver.ts** — Brace-block resolution for SWAP.BLK/DEL.BLK/INS.BLK.POST ops
- **recovery.ts** — 3-way merge stale-anchor recovery against historical LRU snapshots
- **snapshot.ts** — LRU snapshot store (8 snapshots × 4 entries)
- **noop-guard.ts** — 3 consecutive identical no-ops → hard fail
- **tokenizer.ts** — Character-level tokenizer: HEADER, SWAP, DEL, INS.PRE/POST/HEAD/TAIL, .BLK, PAYLOAD tokens
- **types.ts** — HashConfig type: hashLength (2|3|4), grep (bool), replaceText (bool?)
- **fs.ts** — readTextFile/splitLines/writeFileAtomically helpers

## Work Guidance
(empty — no specific guidelines beyond contracts above)

## Verification
`npm test` — node:test + tsx runner (tests/grep.test.ts): match collection + hashline format, regex vs literal, ignoreCase, context, limit (per-file + global kill path), invalid UTF-8 bytes, no-matches grace. Config backup/restore isolation in test setup.

## Child DOX Index
(leaf directory — no children)
