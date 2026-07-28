# Context for: pi-the-hashline codebase survey

## Relevant Files
- `src/index.ts` — Extension entry point; registers read/edit/grep tools with Pi agent
- `src/hash.ts` — xxHash32 + NIBBLE_STR context-based hashing (prev+curr+next lines)
- `src/format.ts` — Hashline format/parse utilities
- `src/tokenizer.ts` — Edit DSL line-by-line tokenizer (state machine)
- `src/parser.ts` — Token stream → Edit[] state machine
- `src/block-resolver.ts` — Brace-matching for .BLK ops
- `src/apply.ts` — Edit application engine (bottom-up atomic ops)
- `src/read.ts` — read tool: hashline-format output
- `src/edit.ts` — edit tool: DSL parser → validate → apply → commit
- `src/recovery.ts` — 3-way merge stale-anchor recovery
- `src/snapshot.ts` — LRU multi-version snapshot store
- `src/noop-guard.ts` — Fixation breaker (3 noops → fail)
- `src/fs.ts` — Atomic file writes + file-kind detection
- `src/types.ts` — Shared type definitions
- `src/config.ts` — ~/.pi/agent/hashline.json loader
- `DESIGN.md` — Full design document
- `prompts/read.md` — Read tool prompt
- `prompts/edit.md` — Edit tool prompt

## Project Structure
```
├── src/            — All source modules (no subdirs, flat)
├── prompts/        — System prompts for read/edit tools
├── .pi/plans/      — Prior scout reports
├── package.json    — ESM, pi extension entry at ./src/index.ts
├── DESIGN.md       — Architecture and design decisions
└── README.md       — Usage and installation
```

## Conventions
- TypeScript ESM (type:module)
- No build step — Pi agent loads raw TS
- Flat src/ layout — all modules at one level
- Edit DSL parsed by two-phase pipeline: tokenizer → parser → apply
- Context-based hashing includes prev+curr+next lines with \0 separator
- Edit ops applied bottom-up (descending line number) for drift safety

## Dependencies
- `xxhash-wasm` — hashing
- `diff` — 3-way merge for stale-anchor recovery
- `lru-cache` — snapshot version store
- Peers (provided by Pi runtime): @earendil-works/pi-coding-agent, @earendil-works/pi-tui, typebox, @earendil-works/pi-ai

## Key Findings
- 10 commits on linear history, single contributor
- No test infrastructure — no test/ dir, no test framework config
- Peer deps not locally installable; code only runnable inside Pi agent
- Hash length configurable 2-4 chars (default 2), shorter = more collisions
- grep tool is optional, requires rg on PATH

## Gotchas
- Peer deps unresolvable outside Pi runtime — can't typecheck standalone
- No tsconfig.json — TS compilation handled by Pi agent
- No tests — changes need manual verification or self-check additions
- hashLength < 4 increases collision risk for anchor verification
- edit tool relies on seen-lines enforcement — lines not displayed by read get rejected
