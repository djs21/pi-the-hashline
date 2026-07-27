import { Type } from "typebox";
import { resolve } from "node:path";
import { readTextFile, writeFileAtomically } from "./fs.js";
import { initHash, computeAllLineHashes } from "./hash.js";
import { loadConfig } from "./config.js";
import { formatHashlineRegion } from "./format.js";
import { parseDiff, resolveBlockEdits } from "./parser.js";
import { applyEdits } from "./apply.js";
import { snapshotStore } from "./snapshot.js";
import { tryRecover } from "./recovery.js";
import { noopGuard } from "./noop-guard.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerEditTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "edit",
    label: "edit (hashline)",
    description: "Edit files using hashline-anchored DSL or native edit format. Validates line hashes before applying.",
    promptSnippet: "edit: Edit files using hashline DSL (SWAP N.=M:, DEL N, INS.PRE N:, INS.POST N:, INS.HEAD:, INS.TAIL:, SWAP.BLK N:, DEL.BLK N, INS.BLK.POST N:)",
    promptGuidelines: [
      "Use edit with hashline DSL: [path#TAG] header then SWAP/DEL/INS ops",
      "SWAP N.=M: replaces lines N through M with payload",
      "DEL N.=M deletes lines N through M",
      "INS.PRE N: inserts payload before line N, INS.POST N: inserts after",
      "INS.HEAD: inserts at file start, INS.TAIL: inserts at file end",
      "SWAP.BLK N:/DEL.BLK N/INS.BLK.POST N: operate on brace-delimited blocks",
      "Always use exact LINE#HASH: from read output as anchor reference",
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "File path (for native format)" })),
      edits: Type.Optional(Type.Array(Type.Object({
        diff: Type.Optional(Type.String()),
      }), { description: "Edits array (native format)" })),
      diff: Type.Optional(Type.String({ description: "Hashline DSL diff text" })),
    }),
    executionMode: "sequential",
    prepareArguments(args: any) {
      // Normalize native Pi edit format to our DSL format
      if (args.edits && Array.isArray(args.edits)) {
        for (const edit of args.edits) {
          if (edit.diff) {
            args.diff = edit.diff;
            break;
          }
        }
      }
      return args;
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await initHash();
      const config = loadConfig();

      if (!params.diff && (!params.edits || params.edits.length === 0)) {
        return {
          content: [{ type: "text", text: "[E_NO_DIFF] No diff or edits provided." }],
          details: {},
          isError: true,
        };
      }

      const diff = params.diff ?? "";

      // Parse the DSL
      const sections = parseDiff(diff);
      if (sections.size === 0) {
        return {
          content: [{ type: "text", text: "[E_NO_SECTIONS] No valid edit sections found. Use [path#TAG] header." }],
          details: {},
          isError: true,
        };
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
            // Compute a simple file-level tag from first 4 line hashes
            const computedTag = liveHashes.slice(0, Math.min(4, liveHashes.length)).join("").slice(0, config.hashLength);

            if (section.tag !== computedTag && !isHeadTailOnly(section.edits)) {
              // Try recovery
              const recovered = tryRecover(absPath, text, section.edits, section.tag);
              if (recovered) {
                // Apply recovered version
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

              // Recovery failed
              const msg = `[E_STALE_ANCHOR] File ${absPath} has changed since read. ` +
                `Expected tag ${section.tag} but computed ${computedTag}. ` +
                `Re-read the file with read to get fresh anchors.`;
              results.push(msg);
              hasError = true;
              continue;
            }
          }

          // Apply edits
          const applyResult = applyEdits(text, section.edits);

          // Check for noop
          if (applyResult.text === text) {
            // Compute payload key for noop guard
            const payloadKey = section.edits.map(e => `${e.kind}:${e.anchorLine}:${e.payload.join("|")}`).join("||");
            noopGuard.track(absPath, payloadKey);
            results.push(`[${absPath}] No change - content already matches requested edit.`);
            continue;
          }

          // Clear noop guard on success
          noopGuard.clear(absPath);

          // Write atomically
          writeFileAtomically(absPath, applyResult.text);

          // Record new snapshot
          await snapshotStore.record(absPath, applyResult.text);

          // Generate preview
          const newLines = applyResult.text.split("\n");
          if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();
          const newHashes = computeAllLineHashes(newLines, config.hashLength);

          // Show affected region plus context
          const previewStart = Math.max(1, applyResult.firstChangedLine - 2);
          const previewEnd = Math.min(newLines.length, applyResult.lastChangedLine + 2);
          const preview = formatHashlineRegion(
            newLines, newHashes,
            previewStart - 1,
            previewEnd - previewStart + 1
          );

          const warnings = applyResult.warnings.length > 0
            ? `\nWarnings: ${applyResult.warnings.join("; ")}`
            : "";

          results.push(
            `[${absPath}] Updated lines ${applyResult.firstChangedLine}-${applyResult.lastChangedLine}.${warnings}\n` +
            preview.join("\n")
          );

          if (section.warnings.length > 0) {
            results.push(`DSL warnings: ${section.warnings.join("; ")}`);
          }
        } catch (err: any) {
          results.push(`[${absPath}] Error: ${err.message}`);
          hasError = true;
        }
      }

      return {
        content: [{ type: "text", text: results.join("\n---\n") }],
        details: {},
        isError: hasError,
      };
    },
  });
}

function isHeadTailOnly(edits: any[]): boolean {
  return edits.every(e => e.kind === "insert_head" || e.kind === "insert_tail");
}
