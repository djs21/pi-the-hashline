# Context for: EDIT tool display/output UX

## Relevant Files

- `src/edit.ts` — EDIT tool registration: `renderCall` (line 272), `renderResult` (line 279), `execute` (line 54). This is the primary target for display changes.
- `src/read.ts` — READ tool reference implementation: `renderResult` (line 108) with 10-line preview truncation and "Ctrl+O to expand". The golden example to match.
- `src/format.ts` — `formatHashline()` and `formatHashlineRegion()` for LINE#HASH:content formatting. Used by both tools.
- `src/apply.ts` — Edit application engine. Returns `ApplyResult` with `text`, `firstChangedLine`, `lastChangedLine`, `warnings[]`. No display logic.
- `src/types.ts` — `ApplyResult`, `EditOp`, `EditSection`, `EditParams` types.
- `src/index.ts` — Extension entry point. Registers read, edit, grep tools. No display logic.
- `src/parser.ts` — Hashline DSL parser. Produces warnings during parsing.
- `src/recovery.ts` — Stale anchor recovery via 3-way merge. Produces warning messages.

## Project Structure

```
src/
  index.ts        — entry, registers tools
  read.ts         — read tool (TUI preview reference)
  edit.ts         — edit tool (target for improvement)
  grep.ts         — grep tool
  format.ts       — hashline string formatting helpers
  apply.ts        — edit application engine (no display logic)
  parser.ts       — hashline DSL parser
  tokenizer.ts    — DSL tokenizer
  block-resolver.ts — brace-block resolution
  recovery.ts     — stale anchor 3-way merge recovery
  hash.ts         — xxHash32 line hashing
  config.ts       — config loading
  fs.ts           — file I/O
  snapshot.ts     — file snapshot store for recovery
  noop-guard.ts   — guard against repeated no-op edits
  types.ts        — shared types
```

All tool registration follows the same pattern:
1. `pi.registerTool({ name, label, description, parameters, executionMode, execute, renderCall, renderResult })`
2. `renderCall` and `renderResult` return `Text` components from `@earendil-works/pi-tui`

## Conventions

- Tools return `AgentToolResult` with `{ content: [{ type: "text", text }], details: {}, isError?: boolean }`.
- `renderCall` shows a one-line title: `<theme.fg("toolTitle", bold("toolname "))><theme.fg("accent"|"muted", args)>`
- `renderResult` returns `new Text(content, paddingX, paddingY)`.
- Theme colors available: `accent`, `border`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `toolTitle`, `toolOutput`, `toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`, `md*`, `syntax*`, and more (see `ThemeColor` type in `pi-coding-agent`).
- Error results set `isError: true` and use `theme.fg("error", text)` in renderResult.
- The `options.expanded` boolean (from `ToolRenderResultOptions`) controls preview truncation — toggled by Ctrl+O in TUI.

## Dependencies

- `@earendil-works/pi-tui` — `Text` component for rendering. Constructor: `new Text(text, paddingX, paddingY, customBgFn?)`. Methods: `setText()`, `render(width)`.
- `@earendil-works/pi-coding-agent` — Provides `ExtensionAPI`, `AgentToolResult`, `ToolDefinition`, `ToolRenderResultOptions`, `Theme` (with `.fg(color, text)`, `.bold(text)`).

## Key Findings

### Read Tool Display Flow

1. **execute()**: Reads file, splits lines, computes hashes, formats via `formatHashlineRegion()`, returns `{ content: [{ type: "text", text: formatted }], details: { path, totalLines } }`.
2. **renderCall()**: `read <path>:<range>` in toolTitle+accent colors.
3. **renderResult()** (lines 108-125):
   - Checks `options.expanded` (from TUI Ctrl+O).
   - If `!expanded && lines.length > 10`: shows only first 10 lines, appends `"... (N more lines, Ctrl+O to expand)"` in `theme.fg("muted", ...)`.
   - If expanded: shows full text.
   - Returns `new Text(text, 0, 0)` — **no padding**.

### Edit Tool Display Flow (Success)

1. **execute()** (lines 54-271): For each file section:
   - Applies edits via `applyEdits()`.
   - On no-op: `"[path] No change - content already matches."`
   - On success: Builds compact diff with `- LINE#HASH:old` and `+ LINE#HASH:new` prefix, plus 2-line context before/after via `formatHashlineRegion()`.
   - Warnings appended after diff.
   - Multiple files separated by `\n---\n`.
   - Final return: `{ content: [{ type: "text", text: results.join("\n---\n") }], details: {}, isError: hasError }`.
2. **renderCall()** (lines 272-278): `edit <first diff line>` in toolTitle+muted.
3. **renderResult()** (lines 279-293):
   - If `isError`: wraps whole output in `theme.fg("error", text)`.
   - If empty text: `theme.fg("dim", "No changes")`.
   - **Otherwise: returns raw textContent as-is — NO preview truncation, NO theme coloring on diff lines, ignores `options.expanded` entirely** (parameter is `_options` — unused).

### Edit Tool Display Flow (Failure)

Error cases in execute():
| Error | Condition | Returns |
|-------|-----------|---------|
| `[E_NO_DIFF]` | No diff or edits | `isError: true` |
| `[E_REPLACE_TEXT_DISABLED]` | replaceText:false in config | `isError: true` |
| `[E_NO_PATH]` | path missing for replace_text | `isError: true` |
| File read error | `readTextFile` throws | `isError: true` |
| `convertReplaceTextEdits` errors | oldText not found, ambiguous, etc. | `isError: true` |
| `[E_NO_SECTIONS]` | No valid edit sections after parsing | `isError: true` |
| `[E_STALE_ANCHOR]` | Tag not found + recovery failed | Accumulated in results, `hasError = true` |
| Generic catch | Any exception during edit | Accumulated in results, `hasError = true` |
| No-op (not error) | Edit produces same content | Normal result, no isError |

All errors are plain text wrapped in `theme.fg("error", text)` by renderResult. No special formatting per error type.

### Key Differences: READ vs EDIT

| Feature | READ | EDIT |
|---------|------|------|
| Preview truncation (10 lines) | Yes — checks `options.expanded` | **No** — ignores `_options` |
| "Ctrl+O to expand" hint | Yes — `theme.fg("muted", ...)` | **No** |
| Diff coloring (`toolDiffAdded`/`toolDiffRemoved`) | N/A (no diff) | **No** — raw `- LINE#HASH:` / `+ LINE#HASH:` text |
| Context coloring (`toolDiffContext`) | N/A | **No** |
| Success indicator | Implicit (file content shown) | Header `[path] Updated lines X-Y.` |
| Warning styling | N/A | Plain text, not colored |
| Error styling | N/A | Red via `theme.fg("error")` |
| Padding on Text component | `new Text(text, 0, 0)` | `new Text(text, 0, 0)` |
| `details` usage | `{ path, totalLines }` | `{}` (empty) |

## Gotchas

- **EDIT's `renderResult` ignores `options.expanded`**: The second parameter is named `_options` (with underscore convention for unused), so it doesn't participate in Ctrl+O expand/collapse. This is the primary gap.
- **Diff output is raw text**: The `-`/`+` prefixed diff lines in EDIT's output are plain ASCII text, not ANSI-colored. Theme has `toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext` colors available but unused.
- **Error display is monochrome red**: All errors get the same `theme.fg("error")` treatment — no distinction between warnings, stale anchors, or fatal errors.
- **No result summary in renderResult**: The `onUpdate` at line 265 shows "Done. Applied N file(s)." but the final renderResult doesn't show a clean summary — it dumps the entire raw diff output.
- **Multiple files produce long output**: With `\n---\n` separators, multi-file edits can produce very long result text with no truncation mechanism at all.
- **`theme.fg()` is composable**: `theme.fg("toolTitle", theme.bold("text"))` works. Can nest `fg()` calls for multi-colored output blocks.
- **Text component accepts customBgFn**: The 4th arg to `new Text(text, paddingX, paddingY, customBgFn?)` could be used for line-level background coloring if desired.
