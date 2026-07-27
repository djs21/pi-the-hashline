import { Type } from "typebox";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { initHash, computeLineHash } from "./hash.js";
import { loadConfig } from "./config.js";
import { formatHashline } from "./format.js";
import { readTextFile } from "./fs.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerGrepTool(pi: ExtensionAPI): void {
  const config = loadConfig();
  if (!config.grep) return;

  // Check if ripgrep is available
  try {
    execSync("rg --version", { stdio: "ignore" });
  } catch {
    console.warn("[pi-the-hashline] grep tool disabled: ripgrep (rg) not found on PATH");
    return;
  }

  pi.registerTool({
    name: "grep",
    label: "grep (hashline)",
    description: "Search files with ripgrep, output in hashline format (LINE#HASH:content). Requires rg on PATH and grep:true in config.",
    promptSnippet: "grep: Search file contents using ripgrep, returns hashline-formatted matches.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Search pattern (regex)" }),
      path: Type.Optional(Type.String({ description: "Directory or file to search" })),
      glob: Type.Optional(Type.String({ description: "File glob pattern (e.g., *.ts)" })),
      ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search" })),
      literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string" })),
      context: Type.Optional(Type.Integer({ description: "Lines of context before/after match", minimum: 0, maximum: 5 })),
      limit: Type.Optional(Type.Integer({ description: "Maximum results", minimum: 1, maximum: 200 })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await initHash();
      const config = loadConfig();

      const searchPath = params.path ? resolve(ctx.cwd, params.path) : ctx.cwd;
      const limit = params.limit ?? 50;
      const context = params.context ?? 0;

      // Build rg command
      const args = ["rg", "--line-number", "--no-heading", "--color", "never"];
      if (params.ignoreCase) args.push("-i");
      if (params.literal) args.push("-F");
      if (context > 0) {
        args.push("-C", String(context));
      }
      args.push("--max-count", String(limit));
      args.push(params.pattern);
      args.push(searchPath);

      try {
        const output = execSync(args.join(" "), { encoding: "utf-8", maxBuffer: 1024 * 1024 });
        const rgLines = output.trim().split("\n").filter(Boolean);

        // Parse rg output: path:line:content
        const fileResults = new Map<string, { lineNo: number; content: string }[]>();

        for (const line of rgLines) {
          const match = line.match(/^(.+?):(\d+):(.*)$/);
          if (!match) continue;

          const [, filePath, lineNoStr, content] = match;
          const lineNo = parseInt(lineNoStr, 10);

          if (!fileResults.has(filePath)) {
            fileResults.set(filePath, []);
          }
          fileResults.get(filePath)!.push({ lineNo, content });
        }

        // Format hits with hashline
        const results: string[] = [];
        for (const [filePath, hits] of fileResults) {
          try {
            const text = readTextFile(filePath);
            const lines_arr = text.split("\n");

            const minLine = Math.max(1, hits[0].lineNo - context);
            const maxLine = Math.min(lines_arr.length, hits[hits.length - 1].lineNo + context);

            const hashes = lines_arr.map((_, i) => computeLineHash(lines_arr, i, config.hashLength));

            const fileBlock: string[] = [`[${filePath}]`];
            for (let i = minLine - 1; i < maxLine; i++) {
              fileBlock.push(formatHashline(i + 1, hashes[i], lines_arr[i]));
            }
            results.push(fileBlock.join("\n"));
          } catch {
            results.push(`[${filePath}] (binary or unreadable)`);
          }
        }

        return {
          content: [{ type: "text", text: results.join("\n\n") || "No matches found." }],
          details: {},
        };
      } catch (err: any) {
        // rg returns non-zero for "no matches" — that's not an error
        if (err.status === 1) {
          return {
            content: [{ type: "text", text: `No matches for pattern: ${params.pattern}` }],
            details: {},
          };
        }
        throw err;
      }
    },
  });
}
