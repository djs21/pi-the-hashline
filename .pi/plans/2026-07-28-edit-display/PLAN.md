# Plan: EDIT Tool Display/Output UX

**Date:** 2026-07-28
**Status:** Draft
**Directory:** /home/kominfo/project/pi-the-hashline

## Intent

Improve EDIT tool's TUI output display to match READ tool's polish — colored diff lines, preview truncation with Ctrl+O expand, proper error differentiation, warning styling, and metadata in `details`. Pure display changes; no edit logic changes.

## User Story

As a user of pi-the-hashline extension, I want EDIT tool results in the TUI to show color-coded diffs, respect Ctrl+O expand/collapse, display distinct error types with appropriate colors, and show summary metadata, so I can quickly understand what changed without reading raw monochrome text.

## Behavior

### Current State
- `renderResult` ignores `options.expanded` (parameter named `_options`)
- Diff lines (`- LINE#HASH:old` / `+ LINE#HASH:new`) are plain text — no color
- Context lines from `formatHashlineRegion()` are plain text — no color
- All errors wrapped in `theme.fg("error")` — same red for stale anchors, syntax errors, file errors
- Warnings plain text with no styling
- `details: {}` always empty
- Multi-file output concatenated with `---` — no truncation mechanism
- Noop messages: `theme.fg("dim", "No changes")`

### Desired State (renderResult only)
1. If `!options.expanded` and lines > 10: show first 10 lines + muted "N more lines, Ctrl+O to expand"
2. If `!options.expanded` and lines ≤ 10: show all
3. If `options.expanded`: show full text
4. Diff lines colored: `-` prefix → `toolDiffRemoved`, `+` prefix → `toolDiffAdded`
5. Context lines (from `formatHashlineRegion`) colored: `toolDiffContext`
6. `[E_*]` error lines stay `theme.fg("error")` but rendered with distinct visible prefix
7. `Warnings:` / `DSL warnings:` lines → `theme.fg("warning")`
8. `[path] No change` lines → `theme.fg("dim")` (already done for empty, extend to noop text)
9. `---` separators between files → `theme.fg("dim")`
10. `details` populated with `{ fileCount, paths, changedFileCount }`

## Edge Cases & Error Handling
- **Empty text**: Already handled — `theme.fg("dim", "No changes")` — keep as-is
- **Single line output**: No truncation, no color needed (e.g. `[E_NO_DIFF]`)
- **Multi-file, mixed success/error**: `isError: true` with colored diffs + colored errors
- **Very long diffs**: 10-line preview truncation applies; Ctrl+O reveals all
- **Error lines that look like diff lines**: Error lines start with `[E_` or `[path]`, never with `-` or `+` — no ambiguity
- **Context lines containing `-` or `+` as content**: `formatHashlineRegion` output always starts with spaces (format: `    LINE#HASH:content`) — prefix detection is safe

## Scope

### In Scope
- `src/edit.ts` only: `renderResult` signature and body, plus `details` in `execute()` return
- Parsing text output to apply per-line `theme.fg()` colors
- 10-line preview truncation matching READ tool pattern
- `details` with file paths and counts
- Error type differentiation (prefix-based)

### Out of Scope
- Any change to `execute()` edit logic (parsing, applying, recovery, snapshot)
- READ tool changes
- New dependencies
- CSS/ANSI escape codes in `execute()` output
- Block-level coloring (no background colors, no line-per-line `Text` components)
- HTML export rendering

## Effort & Quality
- **Level:** MVP (display polish, no logic changes)
- **Tests:** None (no test infra exists; manual verify with reload)
- **Docs:** Inline comments in changed code

## Constraints
- No changes to `execute()` edit logic — display-only changes to `renderResult()`
- Exception: can add `details` data and minor formatting hints to `result.content[0].text` (but prefix parsing avoids needing markers)
- Peer dependencies not runnable outside Pi runtime — manual verification only
- Follow READ tool's `renderResult` pattern for preview truncation

## Ideal State Criteria

### Core Functionality
- [ ] ISC-1: EDIT result respects Ctrl+O expand/collapse (≤10 lines preview, muted hint)
- [ ] ISC-2: `-` diff lines render with `toolDiffRemoved` color
- [ ] ISC-3: `+` diff lines render with `toolDiffAdded` color
- [ ] ISC-4: Context lines render with `toolDiffContext` color
- [ ] ISC-5: Warning lines render with `theme.fg("warning")`
- [ ] ISC-6: Noop message renders with `theme.fg("dim")`
- [ ] ISC-7: `details` contains `fileCount`, `paths[]`, `changedFileCount`

### Edge Cases
- [ ] ISC-8: Error lines (`[E_*]`) render with `theme.fg("error")` but distinct from generic errors
- [ ] ISC-9: Multi-file separators (`---`) render with `theme.fg("dim")`
- [ ] ISC-10: Empty result still shows `theme.fg("dim", "No changes")`

### Anti-Criteria
- [ ] ISC-A-1: No edit logic changes in `execute()` beyond `details` population
- [ ] ISC-A-2: No new dependencies

## Approach

**Parse-and-color in renderResult** (option B from requirements).

Rationale: Clean separation between data (execute) and display (renderResult). The existing text output format already has detectable prefixes (`-`, `+`, `LINE#HASH:`, `[E_`, `Warnings:`, `---`) — no need for ANSI escapes in execute() output or extra markers.

### How it works

1. `renderResult()` receives `options` (was `_options`), reads `options.expanded`
2. Gets text from `result.content[0]`, splits into lines
3. If `!expanded && lines > 10`: truncates to first 10 lines, tracks remaining count
4. Maps each line through a color function that checks prefix patterns
5. If truncated: appends muted `"... (N more lines, Ctrl+O to expand)"` line
6. Joins with `\n` and returns `new Text(...)`

### Line color mapping

**Evaluation order matters** — diff prefix checks (`- `, `+ `) MUST come before the context hash check (`#HASH:`), because diff lines also contain hashes. Error prefix checks (`[E_`, `[`+`Error:`) MUST come before generic pass-through.

| Line pattern | Color | Example |
|---|---|---|
| Starts with `- ` | `toolDiffRemoved` | `-  5#ABC:old line` |
| Starts with `+ ` | `toolDiffAdded` | `+  5#DEF:new line` |
| Has `#HASH:` pattern & starts with spaces | `toolDiffContext` | `   3#GHI:context` |
| Starts with `[E_` | `error` | `[E_STALE_ANCHOR] ...` |
| Starts with `[` and contains `Error:` | `error` | `[/path] Error: file not found` |
| Contains `Warnings:` or `DSL warnings:` | `warning` | `Warnings: trailing whitespace` |
| Contains `No change` | `dim` | `[path] No change...` |
| Exactly `---` | `dim` | `---` |
| Everything else | Pass through | `[/path] Updated lines 5-7.` or `[/path] Recovered stale anchors. Updated file.` |

### details population

In `execute()` return, change `details: {}` to:
```typescript
details: {
  fileCount: sections.size,
  paths: [...sections.keys()].map(p => resolve(ctx.cwd, p)),
  changedFileCount: results.filter(r => r.includes('Updated lines') || r.includes('Recovered')).length,
}
```

## Key Decisions

- **Decision to color in renderResult, not execute**: Keeps display concerns out of edit logic. No ANSI escapes in stored text.
- **Prefix-based line detection over regex**: Faster, simpler, unambiguous given the fixed output format.
- **10-line preview threshold matching READ**: Consistent UX across tools.
- **Single Text component**: Returns one `new Text(text, 0, 0)` with theme.fg() composed per line, matching existing pattern. No per-line Text components needed.

## Architecture

**Before:**
```
execute() → { content: [{ type: "text", text }], details: {}, isError }
renderResult(_, _options, theme) → new Text(textContent, 0, 0)
```

**After:**
```
execute() → { content: [{ type: "text", text }], details: { fileCount, paths, changedFileCount }, isError }
renderResult(_, options, theme) → parse lines → color per prefix → truncate if needed → new Text(coloredText, 0, 0)
```

## Data Flow

1. User runs `edit` tool in Pi agent
2. `execute()` runs, produces text output with `[path]`, `-`/`+` lines, warnings, errors
3. `renderResult()` called with result and `options.expanded` (from Ctrl+O state)
4. Lines parsed and colorized based on prefix patterns
5. Truncated to 10 lines if not expanded and result > 10 lines
6. Colored text rendered in TUI via `Text` component

## Changes

### File: `src/edit.ts`

#### 1. `renderResult` (lines 279-293) — rewrite

**Signature**: `renderResult(result, _options, theme, _context)` → `renderResult(result, options, theme, _context)`

**Body**: Replace with color + truncation logic:
- Extract text from `result.content[0]`
- Handle empty case (keep `theme.fg("dim", "No changes")`)
- Handle `isError`: still apply line-level coloring (differentiate error types)
- Split text into lines
- Apply 10-line preview truncation based on `options.expanded`
- Map each line through color function
- Join and return `new Text(...)`

#### 2. `execute` details (lines 266-269) — populate

Change:
```typescript
return {
  content: [{ type: "text", text: results.join("\n---\n") }],
  details: {},
  isError: hasError,
};
```
To:
```typescript
return {
  content: [{ type: "text", text: results.join("\n---\n") }],
  details: {
    fileCount: sections.size,
    paths: [...sections.keys()].map(p => resolve(ctx.cwd, p)),
    changedFileCount: results.filter(r =>
      r.includes('Updated lines') || r.includes('Recovered')
    ).length,
  },
  isError: hasError,
};
```

#### 3. Add helper function (after `registerEditTool`)

Add a `colorEditOutputLine(line: string, theme: Theme): string` function that applies `theme.fg()` based on prefix patterns. `Theme` type is from `@earendil-works/pi-tui` (already imported as `Text`).

Pseudocode (evaluation order is significant — check diffs before context, errors before pass-through):
```typescript
function colorEditOutputLine(line: string, theme: Theme): string {
  if (line.startsWith("- ")) return theme.fg("toolDiffRemoved", line);
  if (line.startsWith("+ ")) return theme.fg("toolDiffAdded", line);
  if (/^\s+\d+#[A-Z]+:/.test(line)) return theme.fg("toolDiffContext", line);
  if (line.startsWith("[E_")) return theme.fg("error", line);
  if (line.startsWith("[") && line.includes("Error:")) return theme.fg("error", line);
  if (line.includes("Warnings:") || line.includes("DSL warnings:")) return theme.fg("warning", line);
  if (line.includes("No change")) return theme.fg("dim", line);
  if (line === "---") return theme.fg("dim", line);
  return line; // pass through — Updated lines, Recovered stale, headers
}
```

`Theme` is available from `@earendil-works/pi-tui` (already imported for `Text`). No need to import separately.

## Dependencies

None. Uses existing `theme.fg()` API and `Text` component from `@earendil-works/pi-tui`.

## Risks & Open Questions

- **Risk: Peer deps not runnable outside Pi runtime** — Can't `npm run build` or typecheck. Must verify by reloading extension in Pi and running manual smoke tests. Accepted.
- **Risk: Line color mapping false positive** — A file context line that starts with `- ` (possible if content starts with dash) would be colored as removed. Mitigation: formatHashlineRegion always prepends spaces, so context lines never start with `-` at position 0. Acceptable.
- **Risk: Preview truncation hides errors (stale anchor in file 3 of 5)** — Same behavior as READ: truncated content can hide info. User can Ctrl+O to expand. Accepted.
- **Open: Should stale anchor errors get a distinct color (e.g. `warning` + `error`)?** — Currently all errors use `theme.fg("error")`. Punting to implementation; `[E_STALE_ANCHOR]` prefix is already descriptive enough.
