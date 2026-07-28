import { Type } from "typebox";
import { resolve } from "node:path";
import { readTextFile, writeFileAtomically } from "./fs.js";
import { initHash, computeAllLineHashes, computeLineHash } from "./hash.js";
import { loadConfig } from "./config.js";
import { formatHashlineRegion } from "./format.js";
import { parseDiff, resolveBlockEdits } from "./parser.js";
import { applyEdits } from "./apply.js";
import { snapshotStore } from "./snapshot.js";
import { tryRecover } from "./recovery.js";
import { noopGuard } from "./noop-guard.js";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerEditTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "edit",
    label: "edit (hashline)",
    description: "Edit files using hashline DSL or Pi native replace_text format. Supports both hashline [path#TAG] ops and legacy oldText/newText via op:replace_text.",
    promptSnippet: "edit: Edit files using hashline DSL (SWAP N.=M:, DEL N, INS.PRE N:, INS.POST N:, INS.HEAD:, INS.TAIL:, SWAP.BLK N:, DEL.BLK N, INS.BLK.POST N:)",
    promptGuidelines: [
      "Use hashline DSL: edits: [{op: 'hashline', diff: '[path#TAG]...'}]",
      "OR use Pi native format: edits: [{op: 'replace_text', oldText: '...', newText: '...'}]",
      "SWAP N.=M: replaces lines N through M with payload",
      "DEL N.=M deletes lines N through M",
      "INS.PRE N: inserts payload before line N, INS.POST N: inserts after",
      "INS.HEAD: inserts at file start, INS.TAIL: inserts at file end",
      "SWAP.BLK N:/DEL.BLK N/INS.BLK.POST N: operate on brace-delimited blocks",
      "Always use exact LINE#HASH: from read output as anchor reference",
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "File path" })),
      edits: Type.Optional(Type.Array(Type.Object({
        op: Type.Optional(Type.String({ description: "Operation type: 'replace_text' or 'hashline'" })),
        oldText: Type.Optional(Type.String({ description: "Exact text to find (replace_text op)" })),
        newText: Type.Optional(Type.String({ description: "Replacement text (replace_text op)" })),
        diff: Type.Optional(Type.String({ description: "Hashline DSL (hashline op or legacy format)" })),
      }), { description: "Edit operations" })),
      diff: Type.Optional(Type.String({ description: "Hashline DSL (alternative to edits)" })),
    }),
    renderShell: "default",
    executionMode: "sequential",
    prepareArguments(args: any) {
      // Normalize old-style { diff } to top-level diff for backward compat
      if (args.edits && Array.isArray(args.edits)) {
        for (const edit of args.edits) {
          if (edit.diff && !edit.op) {
            args.diff = edit.diff;
            break;
          }
        }
      }
      return args;
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      await initHash();
      onUpdate?.({ content: [{ type: "text", text: "Parsing..." }], details: {} });
      const config = loadConfig();

      if (!params.diff && (!params.edits || params.edits.length === 0)) {
        throw new Error("[E_NO_DIFF] No diff or edits provided.");
      }

      // --- Handle replace_text edits ---
      const replaceTextEdits = (params.edits || []).filter(
        (e: any) => e.oldText !== undefined || e.op === "replace_text"
      );

      if (replaceTextEdits.length > 0) {
        if (config.replaceText === false) {
          throw new Error("[E_REPLACE_TEXT_DISABLED] Set replaceText: true in hashline.json to enable");
        }
        if (!params.path) {
          throw new Error("[E_NO_PATH] path required for replace_text edits");
        }
      }

      let replaceSections = new Map<string, { tag: string; edits: any[]; warnings: string[] }>();
      if (replaceTextEdits.length > 0) {
        const absPath = resolve(ctx.cwd, params.path!);
        let content: string;
        try {
          content = readTextFile(absPath);
        } catch (err: any) {
          throw new Error(`[${absPath}] Error reading file: ${err.message}`);
        }
        const result = convertReplaceTextEdits(replaceTextEdits, params.path!, content, config);
        if (result.errors.length > 0) {
          throw new Error(result.errors.join("\n"));
        }
        replaceSections = result.sections;
      }

      // --- Handle hashline DSL ---
      const diff = params.diff ?? "";
      const dslSections = parseDiff(diff);
      onUpdate?.({ content: [{ type: "text", text: diff ? `Editing: ${diff.slice(0, 60)}...` : "No diff provided" }], details: {} });

      // Merge replace_text sections into dslSections
      for (const [path, section] of replaceSections) {
        dslSections.set(path, section);
      }
      const sections = dslSections;

      onUpdate?.({ content: [{ type: "text", text: `Found ${sections.size} section(s) to apply` }], details: {} });
      if (sections.size === 0) {
        throw new Error("[E_NO_SECTIONS] No valid edit sections found. Use [path#TAG] header or replace_text edits.");
      }

      const results: string[] = [];
      let hasError = false;

      for (const [filePath, section] of sections) {
        const absPath = resolve(ctx.cwd, filePath);

        try {
          const text = readTextFile(absPath);
          const lines = text.split("\n");
          if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

          // Get live file hashes
          const liveHashes = computeAllLineHashes(lines, config.hashLength);

          // Resolve block edits
          resolveBlockEdits(text, section.edits, section.warnings);

          // Validate hashes if tag is provided
          if (section.tag) {
            const tagValid = liveHashes.includes(section.tag);
            const computedTag = section.tag;

            if (!tagValid && !isHeadTailOnly(section.edits)) {
              // Try recovery
              const recovered = tryRecover(absPath, text, section.edits, section.tag);
              if (recovered) {
                writeFileAtomically(absPath, recovered.text);
                const newLines = recovered.text.split("\n");
                if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();
                const newHashes = computeAllLineHashes(newLines, config.hashLength);
                await snapshotStore.record(absPath, recovered.text);
                noopGuard.clear(absPath);

                const preview = formatHashlineRegion(newLines, newHashes, 1, Math.min(10, newLines.length));
                results.push(
                  `[${absPath}] Recovered stale anchors. Updated file.\n` +
                  preview.join("\n")
                );
                continue;
              }

              const msg = `[E_STALE_ANCHOR] File ${absPath} has changed since read. ` +
                `Tag ${section.tag} not found in file. ` +
                `Re-read the file with read to get fresh anchors.`;
              results.push(msg);
              hasError = true;
              continue;
            }
          }

          onUpdate?.({ content: [{ type: "text", text: `Applying edits to ${filePath}...` }], details: {} });

          // Apply edits
          const applyResult = applyEdits(text, section.edits);

          // Check for noop
          if (applyResult.text === text) {
            const payloadKey = section.edits.map(e => `${e.kind}:${e.anchorLine}:${e.payload.join("|")}`).join("||");
            noopGuard.track(absPath, payloadKey);
            results.push(`[${absPath}] No change - content already matches requested edit.`);
            continue;
          }

          noopGuard.clear(absPath);

          onUpdate?.({ content: [{ type: "text", text: `Writing ${filePath}...` }], details: {} });
          writeFileAtomically(absPath, applyResult.text);

          await snapshotStore.record(absPath, applyResult.text);

          const newLines = applyResult.text.split("\n");
          if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();
          const newHashes = computeAllLineHashes(newLines, config.hashLength);
          const oldLines = text.split("\n");
          if (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines.pop();
          const oldHashes = computeAllLineHashes(oldLines, config.hashLength);

          // Build compact diff
          const diffLines: string[] = [];
          const start = applyResult.firstChangedLine;
          const end = applyResult.lastChangedLine;

          // Show old (removed) lines
          for (let i = start; i <= end; i++) {
            const idx = i - 1;
            if (idx < oldLines.length && oldLines[idx] !== undefined) {
              if (idx < newLines.length && newLines[idx] === oldLines[idx]) continue; // unchanged
              const oh = oldHashes[idx] || "??";
              diffLines.push("-" + `  ${i}#${oh}:` + oldLines[idx]);
            }
          }
          // Show new (added) lines
          for (let i = start; i <= end; i++) {
            const idx = i - 1;
            if (idx < newLines.length && newLines[idx] !== undefined) {
              if (idx < oldLines.length && oldLines[idx] === newLines[idx]) continue; // unchanged
              const nh = newHashes[idx] || "??";
              diffLines.push("+" + `  ${i}#${nh}:` + newLines[idx]);
            }
          }

          // Context lines (2 before, 2 after)
          const previewStart = Math.max(1, start - 2);
          const previewEnd = Math.min(newLines.length, end + 2);
          const context = formatHashlineRegion(
            newLines, newHashes,
            previewStart - 1,
            previewEnd - previewStart + 1
          );

          const allPreview = diffLines.length > 0
            ? diffLines.join("\n") + "\n" + context.join("\n")
            : context.join("\n");

          const warnings = applyResult.warnings.length > 0
            ? `\nWarnings: ${applyResult.warnings.join("; ")}`
            : "";

          results.push(
            `[${absPath}] Updated lines ${applyResult.firstChangedLine}-${applyResult.lastChangedLine}.${warnings}\n` +
            allPreview
          );

          if (section.warnings.length > 0) {
            results.push(`DSL warnings: ${section.warnings.join("; ")}`);
          }
        } catch (err: any) {
          results.push(`[${absPath}] Error: ${err.message}`);
          hasError = true;
        }
      }

      onUpdate?.({ content: [{ type: "text", text: `Done. Applied ${results.length} file(s).` }], details: {} });
      if (hasError) {
        throw new Error(results.join("\n---\n"));
      }
      return {
        content: [{ type: "text", text: results.join("\n---\n") }],
        details: {
          fileCount: sections.size,
          paths: [...sections.keys()].map(p => resolve(ctx.cwd, p)),
          changedFileCount: results.filter(r =>
            r.includes('Updated lines') || r.includes('Recovered')
          ).length,
        },
      };
    },
    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("edit "));
      const diff = args.diff || "";
      const firstLine = diff.split("\n")[0] || "";
      text += theme.fg("muted", firstLine);
      return new Text(text, 0, 0);
    },
    renderResult(result, options, theme, _context) {
      const txt = result.content[0];
      const textContent = txt?.type === "text" ? txt.text : "";

      if (!textContent) {
        return new Text(theme.fg("dim", "No changes"), 0, 0);
      }

      const lines = textContent.split("\n");
      const maxPreviewLines = 10;

      let displayLines = lines;
      let remaining = 0;
      if (!options.expanded && lines.length > maxPreviewLines) {
        displayLines = lines.slice(0, maxPreviewLines);
        remaining = lines.length - maxPreviewLines;
      }

      const colored = displayLines.map(line => colorEditOutputLine(line, theme));

      if (remaining > 0) {
        colored.push(theme.fg("muted", `... (${remaining} more lines, Ctrl+O to expand)`));
      }

      return new Text(colored.join("\n"), 0, 0);
    },
  });
}

function colorEditOutputLine(line: string, theme: any): string {
  if (line.startsWith("- ")) return theme.fg("toolDiffRemoved", line);
  if (line.startsWith("+ ")) return theme.fg("toolDiffAdded", line);
  if (/^\s+\d+#[A-Z]+:/.test(line)) return theme.fg("toolDiffContext", line);
  if (line.startsWith("[E_")) return theme.fg("error", line);
  if (line.startsWith("[") && line.includes("Error:")) return theme.fg("error", line);
  if (line.includes("Warnings:") || line.includes("DSL warnings:")) return theme.fg("warning", line);
  if (line.includes("No change")) return theme.fg("dim", line);
  if (line === "---") return theme.fg("dim", line);
  return line;
}

function isHeadTailOnly(edits: any[]): boolean {
  return edits.every(e => e.kind === "insert_head" || e.kind === "insert_tail");
}

function convertReplaceTextEdits(
  edits: any[],
  relPath: string,
  content: string,
  config: any
): { sections: Map<string, { tag: string; edits: any[]; warnings: string[] }>; errors: string[] } {
  const sections = new Map<string, { tag: string; edits: any[]; warnings: string[] }>();
  const errors: string[] = [];
  const lines = content.split("\n");

  for (const edit of edits) {
    const oldText = edit.oldText;
    const newText = edit.newText ?? "";

    // Guard: empty oldText
    if (!oldText || !oldText.trim()) {
      errors.push("[E_EMPTY_OLDTEXT] oldText must be non-empty");
      continue;
    }

    // Guard: exact match first
    const idx = content.indexOf(oldText);

    if (idx === -1) {
      // P1 Fallback: normalized whitespace match
      const oldLines = oldText.split("\n").map((l: string) => l.trimEnd());
      const contentLines = content.split("\n");
      let foundIdx = -1;
      for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
        let match = true;
        for (let j = 0; j < oldLines.length; j++) {
          if (contentLines[i + j].trimEnd() !== oldLines[j]) { match = false; break; }
        }
        if (match) {
          if (foundIdx !== -1) { foundIdx = -2; break; }
          foundIdx = i;
        }
      }
      if (foundIdx === -2 || foundIdx === -1) {
        errors.push(`[E_TEXT_NOT_FOUND] oldText not found in file${foundIdx === -2 ? ' (multiple fuzzy matches)' : ''}. Re-read with \`read\` to get current content.`);
        continue;
      }

      const actualOldText = contentLines.slice(foundIdx, foundIdx + oldLines.length).join("\n");
      const actualIdx = content.indexOf(actualOldText);
      if (actualIdx === -1) {
        errors.push("[E_TEXT_NOT_FOUND] Could not locate exact oldText after fuzzy match");
        continue;
      }

      // already 1-indexed
      const lineBefore = content.slice(0, actualIdx).split("\n").length;
      const oldTextLinesArr = oldText.split("\n");
      const startLine = lineBefore;
      const endLine = startLine + oldTextLinesArr.length - 1;
      const newLines = newText.split("\n");

      const tag = computeLineHash(lines, startLine - 1, config.hashLength);

      const existing = sections.get(relPath);
      if (existing) {
        existing.edits.push({
          kind: "replace",
          anchorLine: startLine,
          endLine,
          payload: newLines,
        });
      } else {
        sections.set(relPath, {
          tag,
          edits: [{
            kind: "replace",
            anchorLine: startLine,
            endLine,
            payload: newLines,
          }],
          warnings: [],
        });
      }
      continue;
    }

    // Guard P0: duplicate match
    const lastIdx = content.lastIndexOf(oldText);
    if (lastIdx !== idx) {
      errors.push("[E_AMBIGUOUS_MATCH] oldText appears multiple times in file. Use hashline DSL for precise targeting.");
      continue;
    }

    // Compute line range from position
    const lineBefore = content.slice(0, idx).split("\n").length;  // already 1-indexed
    const oldTextLines = oldText.split("\n");
    const startLine = lineBefore;
    const endLine = startLine + oldTextLines.length - 1;
    let newLines = newText.split("\n");

    // Fix: when oldText is a substring within a single line, preserve surrounding text
    // instead of replacing the entire line
    if (startLine === endLine) {
      const originalLine = lines[startLine - 1];
      const pos = originalLine.indexOf(oldText);
      if (pos !== -1) {
        const linePrefix = originalLine.slice(0, pos);
        const lineSuffix = originalLine.slice(pos + oldText.length);
        newLines = newLines.map((l, i) => {
          if (i === 0 && i === newLines.length - 1) return linePrefix + l + lineSuffix;
          if (i === 0) return linePrefix + l;
          if (i === newLines.length - 1) return l + lineSuffix;
          return l;
        });
      }
    }

    // Synthetic tag for stale-anchor validation (P1)
    const tag = computeLineHash(lines, startLine - 1, config.hashLength);

    const existing = sections.get(relPath);
    if (existing) {
      existing.edits.push({
        kind: "replace",
        anchorLine: startLine,
        endLine,
        payload: newLines,
      });
    } else {
      sections.set(relPath, {
        tag,
        edits: [{
          kind: "replace",
          anchorLine: startLine,
          endLine,
          payload: newLines,
        }],
        warnings: [],
      });
    }
  }

  return { sections, errors };
}