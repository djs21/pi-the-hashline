# Verification Report: pi-the-hashline

## Complete File Tree

```
/home/kominfo/project/pi-the-hashline/
├── .git/                         # Git repository
├── .pi/
│   ├── laconic-mode.json
│   └── plans/
│       ├── pi-hashline-edit-scout/context.md
│       ├── scout-context.md
│       ├── scout-pi-ext-api.md
│       └── verify-battlefield-2026-07-27T06-47-36/report.md  (this file)
├── DESIGN.md                     # Architecture & design decisions
├── LICENSE
├── package.json                  # Extension manifest
├── prompts/
│   ├── edit.md                   # Edit tool prompt text
│   └── read.md                   # Read tool prompt text
└── src/
    ├── index.ts                  # Entry point — default export function
    ├── types.ts                  # Shared interfaces (HashConfig, EditOp, etc.)
    ├── config.ts                 # ~/.pi/agent/hashline.json loader
    ├── hash.ts                   # xxh32 + NIBBLE_STR context-based hashing
    ├── format.ts                 # Hashline formatting/parsing utilities
    ├── tokenizer.ts              # DSL line-by-line tokenizer (generator)
    ├── parser.ts                 # Token stream → Edit[] state machine
    ├── block-resolver.ts         # Brace-matching for .BLK ops
    ├── apply.ts                  # Edit application engine (bottom-up)
    ├── read.ts                   # read tool: hashline output
    ├── edit.ts                   # edit tool: DSL → validate → apply → commit
    ├── grep.ts                   # grep tool: ripgrep + hashline (optional)
    ├── fs.ts                     # Atomic writes + file-kind detection
    ├── snapshot.ts               # LRU multi-version snapshot store
    ├── recovery.ts               # 3-way merge stale-anchor recovery
    └── noop-guard.ts             # Fixation breaker (3 noops → fail)
```

**Count**: 17 source files, 2 prompts, 1 design doc, 1 manifest.

---

## Import Dependency Graph

```
src/index.ts
  ├── @earendil-works/pi-coding-agent          (peer)
  ├── ./read.js → src/read.ts
  ├── ./edit.js → src/edit.ts
  ├── ./grep.js → src/grep.ts
  └── ./hash.js → src/hash.ts

src/read.ts
  ├── typebox                                   (peer)
  ├── node:fs
  ├── node:path
  ├── ./hash.js → src/hash.ts
  ├── ./config.js → src/config.ts
  ├── ./format.js → src/format.ts
  ├── ./fs.js → src/fs.ts
  ├── ./snapshot.js → src/snapshot.ts
  ├── ./noop-guard.js → src/noop-guard.ts
  └── @earendil-works/pi-coding-agent          (peer)

src/edit.ts
  ├── typebox                                   (peer)
  ├── node:path
  ├── ./fs.js → src/fs.ts
  ├── ./hash.js → src/hash.ts
  ├── ./config.js → src/config.ts
  ├── ./format.js → src/format.ts
  ├── ./parser.js → src/parser.ts
  ├── ./apply.js → src/apply.ts
  ├── ./snapshot.js → src/snapshot.ts
  ├── ./recovery.js → src/recovery.ts
  ├── ./noop-guard.js → src/noop-guard.ts
  └── @earendil-works/pi-coding-agent          (peer)

src/grep.ts
  ├── typebox                                   (peer)
  ├── node:path
  ├── node:child_process
  ├── ./hash.js → src/hash.ts
  ├── ./config.js → src/config.ts
  ├── ./format.js → src/format.ts
  ├── ./fs.js → src/fs.ts
  └── @earendil-works/pi-coding-agent          (peer)

src/hash.ts
  └── xxhash-wasm                               (dep)

src/config.ts
  ├── node:fs
  ├── node:os
  ├── node:path
  └── ./types.js → src/types.ts

src/fs.ts
  ├── node:fs
  ├── node:path
  └── node:crypto

src/format.ts
  └── ./hash.js → src/hash.ts

src/parser.ts
  ├── ./tokenizer.js → src/tokenizer.ts
  ├── ./types.js → src/types.ts
  └── ./block-resolver.js → src/block-resolver.ts

src/apply.ts
  └── ./types.js → src/types.ts

src/snapshot.ts
  ├── lru-cache                                 (dep)
  ├── node:fs
  ├── ./types.js → src/types.ts
  ├── ./hash.js → src/hash.ts
  └── ./config.js → src/config.ts

src/recovery.ts
  ├── diff                                      (dep)
  ├── ./snapshot.js → src/snapshot.ts
  ├── ./types.js → src/types.ts
  └── ./apply.js → src/apply.ts

src/noop-guard.ts        (no imports)
src/block-resolver.ts    (no imports)
src/tokenizer.ts         (no imports)
```

---

## Checks

### ✅ Entry point
`src/index.ts` has `export default async function (pi: ExtensionAPI): Promise<void>` — default async function, correct signature.

### ✅ All local imports resolve
Every `./*.js` import maps to an existing `.ts` file in `src/`.

### ✅ All external imports have matching dependency
- `xxhash-wasm` → listed in `dependencies`
- `lru-cache` → listed in `dependencies`
- `diff` → listed in `dependencies`
- `typebox` → listed in `peerDependencies`
- `@earendil-works/pi-coding-agent` → listed in `peerDependencies`

### ⚠️ `computeLineHash` imported but unused in `edit.ts`
`src/edit.ts` line 4 imports `computeLineHash` from `./hash.js`, but the function is never called in the file. Only `initHash` and `computeAllLineHashes` are used. This will cause a TS error with `noUnusedLocals`.

### ⚠️ `SnapshotEntry` type imported but unused in `snapshot.ts`
`src/snapshot.ts` line 3 imports `type { SnapshotEntry }` from `./types.js`, but `SnapshotEntry` is never referenced in the file. The local `StoredSnapshot` interface is used instead. Will cause TS error with `noUnusedLocals`.

### ⚠️ `file-type` in dependencies is unused
`package.json` lists `"file-type": "^19.0.0"` in `dependencies`, but no source file imports it. `src/fs.ts` has its own `detectFileKind()` with hardcoded extension sets. Safe to remove.

### ⚠️ No `tsconfig.json`
No TypeScript config file found. The project may rely on the host's tsconfig, but standalone type-checking or building is not possible without one.

### ⚠️ No `node_modules` installed
Expected for an extension (host app manages deps), but means `npm install` would be needed for local type-checking.

---

## Issues Summary

| # | Severity | File | Description |
|---|----------|------|-------------|
| 1 | **low** | `src/edit.ts:4` | Unused import: `computeLineHash` |
| 2 | **low** | `src/snapshot.ts:3` | Unused import: `SnapshotEntry` type |
| 3 | **low** | `package.json` | Unused dependency: `file-type` |
| 4 | **info** | (root) | Missing `tsconfig.json` |
| 5 | **info** | (root) | No `node_modules` installed |

---

## Overall Verdict

**READY** — with minor cleanup items.

The extension file tree is complete, all file dependencies resolve correctly, the entry point is properly structured, and there are no broken imports or missing critical files. Three small unused-import/dependency issues exist but are non-blocking.
