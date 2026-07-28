# Implementation Report: EDIT Tool Display/Output UX

**Date:** 2026-07-28
**File changed:** `src/edit.ts` only

## Changes Made

### 1. Helper function `colorEditOutputLine()` (lines 314-324)
Added after `registerEditTool()` closing brace, before `isHeadTailOnly()`.
Prefix-based line color mapping with specific evaluation order:
- `- ` → `theme.fg("toolDiffRemoved")`
- `+ ` → `theme.fg("toolDiffAdded")`
- `  LINE#HASH:` → `theme.fg("toolDiffContext")`
- `[E_*]` → `theme.fg("error")`
- `[path] Error:` → `theme.fg("error")`
- `Warnings:` / `DSL warnings:` → `theme.fg("warning")`
- `No change` → `theme.fg("dim")`
- `---` → `theme.fg("dim")`
- Everything else → pass through unchanged

### 2. `renderResult()` rewrite (lines 285-310)
- **Signature**: `_options` → `options` (now reads `options.expanded`)
- **Removed** `isError` special-case block — all content now goes through line-level coloring
- **Preview truncation**: If `!options.expanded && lines > 10`, shows first 10 lines + muted `"... (N more lines, Ctrl+O to expand)"`
- Empty/absent textContent still returns `theme.fg("dim", "No changes")`
- Returns single `new Text(colored.join("\n"), 0, 0)` — no per-line Text components

### 3. `execute()` return `details` (lines 268-274)
Changed from `details: {}` to:
```typescript
details: {
  fileCount: sections.size,
  paths: [...sections.keys()].map(p => resolve(ctx.cwd, p)),
  changedFileCount: results.filter(r =>
    r.includes('Updated lines') || r.includes('Recovered')
  ).length,
}
```

## Constraints Verified
- ✅ No new imports (`Text` and `resolve` already imported)
- ✅ No edit logic changes in `execute()` beyond details population
- ✅ No other files modified
- ✅ No new dependencies
- ✅ `theme` parameter typed as `any` in helper (matching existing pattern)

## ISC Status

| ISC | Description | Status |
|-----|-------------|--------|
| ISC-1 | Ctrl+O expand/collapse (≤10 lines preview) | ✅ Integrated |
| ISC-2 | `-` lines → `toolDiffRemoved` | ✅ |
| ISC-3 | `+` lines → `toolDiffAdded` | ✅ |
| ISC-4 | Context lines → `toolDiffContext` | ✅ |
| ISC-5 | Warning lines → `theme.fg("warning")` | ✅ |
| ISC-6 | Noop message → `theme.fg("dim")` | ✅ |
| ISC-7 | `details` populated with fileCount/paths/changedFileCount | ✅ |
| ISC-8 | Error lines `[E_*]` → `theme.fg("error")` | ✅ |
| ISC-9 | `---` separators → `theme.fg("dim")` | ✅ |
| ISC-10 | Empty result → `theme.fg("dim", "No changes")` | ✅ |
| ISC-A-1 | No edit logic changes in execute() | ✅ |
| ISC-A-2 | No new dependencies | ✅ |

## Verification
- TypeScript syntax verified by reading final file — no syntax errors visible
- Full runtime verification requires Pi extension reload and manual smoke test (peer deps not runnable standalone)
