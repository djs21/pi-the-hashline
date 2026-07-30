import { Type } from "typebox";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, chmodSync } from "node:fs";
import { computeLineHash } from "./hash.js";
import { loadConfig } from "./config.js";
import { formatHashline } from "./format.js";
import { readTextFile } from "./fs.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

let _rgPath: string | null = null;

async function getRgPath(): Promise<string> {
  if (_rgPath) return _rgPath;

  // 1. Try system PATH
  try {
    execSync("rg --version", { stdio: "ignore" });
    _rgPath = "rg";
    return _rgPath;
  } catch {}

  // 2. Try local install
  const localBin = join(homedir(), ".local", "share", "pi", "bin", "rg");
  try {
    execSync(`"${localBin}" --version`, { stdio: "ignore" });
    _rgPath = localBin;
    return _rgPath;
  } catch {}

  // 3. Download latest from GitHub
  const platform = process.platform;
  const arch = process.arch;

  let target: string;
  if (platform === "linux" && arch === "x64") target = "x86_64-unknown-linux-musl";
  else if (platform === "linux" && arch === "arm64") target = "aarch64-unknown-linux-gnu";
  else if (platform === "darwin" && arch === "x64") target = "x86_64-apple-darwin";
  else if (platform === "darwin" && arch === "arm64") target = "aarch64-apple-darwin";
  else throw new Error(`Unsupported platform for ripgrep download: ${platform} ${arch}`);

  const releaseResp = await fetch("https://api.github.com/repos/BurntSushi/ripgrep/releases/latest");
  if (!releaseResp.ok) throw new Error(`Failed to fetch latest ripgrep release: ${releaseResp.status}`);
  const release: any = await releaseResp.json();
  const version = release.tag_name as string;

  const filename = `ripgrep-${version}-${target}.tar.gz`;
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${filename}`;

  const dlResp = await fetch(url);
  if (!dlResp.ok) throw new Error(`Failed to download ripgrep ${version}: ${dlResp.status}`);

  const buf = Buffer.from(await dlResp.arrayBuffer());
  const binDir = dirname(localBin);
  mkdirSync(binDir, { recursive: true });

  const tar = spawnSync("tar", ["-xz", "--strip-components=1", "-C", binDir, "rg"], { input: buf });
  if (tar.status !== 0) throw new Error("Failed to extract ripgrep binary from archive");

  chmodSync(localBin, 0o755);
  _rgPath = localBin;
  return _rgPath;
}

export function registerGrepTool(pi: ExtensionAPI): void {
  const config = loadConfig();
  if (!config.grep) return;

  pi.registerTool({
    name: "grep",
    label: "grep (hashline)",
    description: "Search files with ripgrep, output in hashline format (LINE#HASH:content). Enable with grep:true in hashline config. Auto-downloads rg if not found on PATH.",
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
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {

      const config = loadConfig();
      const rgPath = await getRgPath();

      const searchPath = params.path ? resolve(_ctx.cwd, params.path) : _ctx.cwd;
      const limit = params.limit ?? 50;
      const context = params.context ?? 0;

      // Build rg command
      const args = [rgPath, "--line-number", "--no-heading", "--color", "never"];
      if (params.ignoreCase) args.push("-i");
      if (params.literal) args.push("-F");
      if (context > 0) {
        args.push("-C", String(context));
      }
      args.push("--max-count", String(limit));
      if (params.glob) {
        args.push("-g", params.glob);
      }
      args.push(params.pattern);
      args.push(searchPath);

      try {
        onUpdate?.({ content: [{ type: "text", text: `grep: ${params.pattern}` }], details: {} });
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
