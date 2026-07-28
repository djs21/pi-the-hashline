# src/ — Hashline Extension Core

## Purpose
Hashline-anchored read/edit/grep tools for pi coding-agent. Replaces pi's built-in read and edit with LINE#HASH:-formatted output and hash-validated edits.

## Ownership
- Entire src/ directory — all extension source code
- No file outside src/ owns extension logic

## Local Contracts
- **Tool registration** — All tools register via `ExtensionAPI` in `index.ts` entry point
- **read.ts** — LINE#HASH: prefix per line, offset/limit pagination (400 lines/32KB default cap), raw:true mode, 10-line TUI preview with Ctrl+O expand
- **edit.ts** — Discriminated schema: `op:"replace_text"` (oldText/newText) + `op:"hashline"` ([path#TAG] DSL). convertReplaceTextEdits() bridges Pi native format into hashline sections. Pipeline: parse → validate (stale-anchor check with synthetic tag) → apply → snapshot → diff display. Guards: E_AMBIGUOUS_MATCH (duplicate oldText), E_EMPTY_OLDTEXT, whitespace-normalized fallback, E_REPLACE_TEXT_DISABLED config. Fixes 2026-07-27: off-by-one startLine + section overwrite. Fixes 2026-07-28: all error paths `throw` instead of `return { isError: true }` so agent loop propagates isError=true to TUI (background merah). Fixes 2026-07-28: `convertReplaceTextEdits` single-line substring replacement now preserves surrounding text (prefix+suffix on match line) instead of replacing entire line.
- **grep.ts** — ripgrep wrapper with LINE#HASH: output. Auto-downloads rg from GitHub if not on PATH. Lazy init (download on first execute)
- **parser.ts** — State-machine DSL parser: tokenizer → parseDiff → Section[] with optional BLK resolution
- **config.ts** — Loads ~/.pi/agent/hashline.json. Keys: hashLength (2-4), grep (bool), replaceText (bool, default true)
- **hash.ts** — Context-based xxHash32: computeLineHash(prev + "\0" + curr + "\0" + next). NIBBLE_STR alphabet (ZPMQVRWSNKTXJBYH, 16 chars, no vowels/hex)
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
No test framework exists. Manual verification via reload + basic smoke test.

## Child DOX Index
(leaf directory — no children)
