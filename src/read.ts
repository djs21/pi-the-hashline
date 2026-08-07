import { Type } from "typebox";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { computeAllLineHashes } from "./hash.js";
import { loadConfig } from "./config.js";
import { formatHashlineRegion } from "./format.js";
import { readTextFile, detectFileKind } from "./fs.js";
import { snapshotStore } from "./snapshot.js";
import { noopGuard } from "./noop-guard.js";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_LINES = 400;
const MAX_BYTES = 32768;

export function registerReadTool(pi: ExtensionAPI): void {
  const config = loadConfig();
  const promptGuidelines = [
    "Use read to examine files - each line shows as LINE#HASH:content",
    "Include the hash prefix (LINE#HASH:) when referencing lines in edit tool",
    "Use raw:true to read without hashline formatting",
    "Use offset/limit for large files to keep output focused",
  ];
  if (config.grep) {
    promptGuidelines.push("For locating specific strings/patterns/definitions, use grep first — it returns hashline anchors directly");
  }

  pi.registerTool({
    name: "read",
    label: "read (hashline)",
    description: "Read files with hashline anchors. Each line prefixed LINE#HASH:content. Use raw:true for plain output. Raw output capped at 400 lines or 32 KiB by default; use offset/limit to continue.",
    promptSnippet: "read: Read files with hashline anchors (LINE#HASH:content). Use raw:true for plain text.",
    promptGuidelines,
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to read" }),
      offset: Type.Optional(Type.Integer({ description: "Starting line number (1-indexed)", minimum: 1 })),
      limit: Type.Optional(Type.Integer({ description: "Maximum lines to read", minimum: 1, maximum: 400 })),
      raw: Type.Optional(Type.Boolean({ description: "If true, output plain content without hashline prefixes" })),
    }),
    executionMode: "sequential",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const absPath = resolve(ctx.cwd, params.path);
      const config = loadConfig();
      onUpdate?.({ content: [{ type: "text", text: `Reading ${params.path}...` }], details: {} });

      const kind = detectFileKind(absPath);

      // Images pass through to native handler
      if (kind === "image") {
        const buf = readFileSync(absPath);
        return {
          content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }],
          details: {},
        };
      }

      const text = readTextFile(absPath);
      const lines = text.split("\n");
      // Remove trailing empty line from split
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

      const offset = params.offset ?? 1;
      const limit = params.limit ?? MAX_LINES;

      if (params.raw) {
        const rawLines = lines.slice(offset - 1, offset - 1 + limit);
        const rawText = rawLines.join("\n");
        const truncated = offset - 1 + limit < lines.length;
        const result = truncated
          ? rawText + `\n...(truncated, nextOffset=${offset + limit})`
          : rawText;
        return {
          content: [{ type: "text", text: result }],
          details: {},
        };
      }

      // Compute hashes for requested range only (efficient)
      const hashes = computeAllLineHashes(lines, config.hashLength);
      const formatted = formatHashlineRegion(lines, hashes, offset - 1, limit);
      const endLine = Math.min(offset - 1 + limit, lines.length);

      // Record snapshot for edit recovery
      const seenLines = new Set<number>();
      for (let i = offset; i <= endLine; i++) seenLines.add(i);
      await snapshotStore.record(absPath, lines.join("\n"), seenLines);

      // Clear noop guard on deliberate re-read
      noopGuard.clear(absPath);

      let output = formatted.join("\n");

      if (endLine < lines.length) {
        output += `\n...(truncated, nextOffset=${endLine + 1})`;
      }

      return {
        content: [{ type: "text", text: output }],
        details: { path: absPath, totalLines: lines.length },
      };
    },
    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("read "));
      const path = args.path || "";
      text += theme.fg("accent", path);
      if (args.offset || args.limit) {
        const start = args.offset ?? 1;
        const end = args.limit ? start + args.limit - 1 : "";
        text += theme.fg("warning", `:${start}${end ? `-${end}` : ""}`);
      }
      return new Text(text, 0, 0);
    },
    renderResult(result, options, theme, _context) {
      const txt = result.content[0];
      if (txt?.type !== "text" || !txt.text) {
        return new Text("", 0, 0);
      }

      const lines = txt.text.split("\n");
      const maxPreviewLines = 10;

      if (!options.expanded && lines.length > maxPreviewLines) {
        const preview = lines.slice(0, maxPreviewLines).join("\n");
        const remaining = lines.length - maxPreviewLines;
        const msg = theme.fg("muted", `\n... (${remaining} more lines, Ctrl+O to expand)`);
        return new Text(preview + msg, 0, 0);
      }

      return new Text(txt.text, 0, 0);
    },
  });
}
