# pi-the-hashline — Design Document

## What

A Pi coding-agent extension that overrides native `read`/`edit` tools with hashline-anchored replacements. Every line in `read` output carries `LINE#HASH:` prefix; `edit` validates anchors against live content hashes, enabling safe, verifiable code modifications.

## Strengths Taken

| From | What We Take |
|------|-------------|
| **RimuruW** (pi-hashline-edit) | NIBBLE_STR hash alphabet, configurable hash length (2-4), context-based hashing (prev+curr+next), inline `LINE#HASH:content` format, config file, file-kind detection, grep tool, clean prompt system |
| **YanwuZeng** (pi-hashline) | State-machine DSL parser (SWAP/DEL/INS/INS.HEAD/INS.TAIL/.BLK ops), brace-matching block resolver, self-healing boundary repair, landing-shift for INS.POST, CRLF/BOM preservation, rich error display, multi-file diff sections, all-or-nothing commits |
| **Both** | xxHash32, 3-way merge stale-anchor recovery, snapshot version walk, noop-loop guard, LRU snapshot store |

## Architecture

```
index.ts                    ← Extension entry: register read/edit/grep tools
src/
  config.ts                 ← ~/.pi/agent/hashline.json loader
  hash.ts                   ← xxh32 + NIBBLE_STR context-based hashing
  format.ts                 ← Hashline format/parse utilities
  tokenizer.ts              ← Edit DSL line-by-line tokenizer (YanwuZeng-inspired)
  parser.ts                 ← Token stream → Edit[] state machine
  block-resolver.ts         ← Brace-matching for .BLK ops
  apply.ts                  ← Edit application engine (bottom-up atomic ops)
  read.ts                   ← read tool: hashline-format output
  edit.ts                   ← edit tool: DSL parser → validate → apply → commit
  grep.ts                   ← grep tool: ripgrep + hashline output (optional)
  snapshot.ts               ← LRU multi-version snapshot store
  recovery.ts               ← 3-way merge stale-anchor recovery
  noop-guard.ts             ← Fixation breaker (3 noops → fail)
  fs.ts                     ← Atomic file writes + file-kind detection
  types.ts                  ← Shared type definitions
prompts/
  read.md                   ← Read tool prompt
  edit.md                   ← Edit tool prompt
```

## Key Design Decisions

### 1 — Hash Algorithm
- **Algorithm**: xxHash32
- **Alphabet**: NIBBLE_STR `ZPMQVRWSNKTXJBYH` (16 chars, no hex digits except B, no vowels, no confusable D/G/I/L/O)
- **Context**: `xxh32(prev + "\0" + curr + "\0" + next)` — hash depends on neighbors
- **Length**: configurable 2-4 chars, default 2
- **Normalization**: strip trailing `[ \t\r]` before hashing

### 2 — Read Format
```
  LINE#HASH:content
```
- 1-indexed line numbers, left-padded for alignment
- Hash per line via context-based hash
- Files larger than 400 lines / 32KB truncated with continuation hint
- Images passed through to native Pi read (attachment mode)
- Binary/directory rejected with descriptive error

### 3 — Edit DSL

```
[path/to/file#TAG]
  SWAP 15.=17:
    replacement line 1
    replacement line 2
  DEL 23.=24
  INS.PRE 42:
    inserted line before
  INS.POST 7:
    inserted line after
  INS.HEAD:
    prepended line
  INS.TAIL:
    appended line
  SWAP.BLK 31:
    replacement inside brace block at line 31
```

### 4 — Block Resolution
- Character-level brace-matching state machine
- Skips strings (single/double/template), comments (//, /* */), regex literals
- Supports: TS/JS/Java/C/C++/Go/Rust/C#
- Returns `null` for indent-based languages (Python, etc.)

### 5 — Stale-Anchor Recovery
1. If live hash !== anchor tag:
   - HEAD/TAIL only → apply with warning (position-stable)
   - Else → try 3-way merge against each historical snapshot version
   - If all fail → MismatchError with ±2 line context display
2. If tag matches → check seen-lines enforcement
3. Apply bottom-up (descending line) for drift safety

### 6 — Safety
- Noop-loop guard: 3 identical consecutive no-ops → hard fail
- Seen-lines enforcement: edits referencing undisplayed lines rejected
- Self-healing: trailing body row duplicating structural closer dropped
- No silent relocation: stale anchors always throw, never slide
- All-or-nothing: multi-file edits commit together or not at all

### 7 — Configuration
File: `~/.pi/agent/hashline.json`
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| hashLength | int | 2 | Characters per hash (2-4) |
| grep | bool | false | Enable grep tool |
