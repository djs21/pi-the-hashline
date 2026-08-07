import { Type } from "typebox";
import { resolve as pathResolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, chmodSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { computeLineHash } from "./hash.js";
import { loadConfig } from "./config.js";
import { formatHashline } from "./format.js";
import { readTextFile } from "./fs.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

let _rgPath: string | null = null;

function decodeField(field: { text?: string; bytes?: string } | undefined): string {
  if (!field) return "";
  if (field.text !== undefined) return field.text;
  if (field.bytes !== undefined) {
    return Buffer.from(field.bytes, "base64").toString("utf8");
  }
  return "";
}

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
    promptGuidelines: [
      "Use grep to search for patterns — more efficient than read for finding matches",
      "Grep output is hashline-formatted: LINE#HASH:content — anchors usable directly in edit tool",
      "Use context:N for surrounding lines, ignoreCase for case-insensitive search",
    ],
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

      const searchPath = params.path ? pathResolve(_ctx.cwd, params.path) : _ctx.cwd;
      const limit = params.limit ?? 50;
      const context = params.context ?? 0;

      // Build rg command
      const args = ["--json", "--line-number", "--no-heading", "--color", "never"];
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

      onUpdate?.({ content: [{ type: "text", text: `grep: ${params.pattern}` }], details: {} });

      return new Promise<{ content: { type: "text"; text: string }[]; details: any }>((resolvePromise, rejectPromise) => {
        let settled = false;
        const resolve = (val: any) => {
          if (!settled) {
            settled = true;
            resolvePromise(val);
          }
        };
        const reject = (err: Error) => {
          if (!settled) {
            settled = true;
            rejectPromise(err);
          }
        };

        const child = spawn(rgPath, args, { cwd: _ctx.cwd });

        const fileLines = new Map<string, Set<number>>();
        const pendingContext = new Map<string, number[]>();
        let matchCount = 0;
        let limitReached = false;
        let stderrData = "";

        child.on("error", (err: any) => {
          reject(new Error(`Error spawning ripgrep: ${err.message}`));
        });

        child.stderr.on("data", (chunk) => {
          stderrData += chunk.toString();
        });

        // Use readline to parse stdout line by line
        const rl = createInterface({
          input: child.stdout,
          crlfDelay: Infinity,
        });

        rl.on("line", (line) => {
          if (limitReached) return;
          try {
            const record = JSON.parse(line);
            if (record.type === "match") {
              const filePath = decodeField(record.data.path);
              if (filePath) {
                if (!fileLines.has(filePath)) {
                  fileLines.set(filePath, new Set<number>());
                }
                const linesSet = fileLines.get(filePath)!;
                linesSet.add(record.data.line_number);

                const pending = pendingContext.get(filePath);
                if (pending) {
                  for (const lineNo of pending) {
                    linesSet.add(lineNo);
                  }
                  pendingContext.set(filePath, []);
                }

                matchCount++;
                if (matchCount >= limit) {
                  limitReached = true;
                  rl.close();
                  child.kill();
                }
              }
            } else if (record.type === "context") {
              const filePath = decodeField(record.data.path);
              if (filePath) {
                if (!pendingContext.has(filePath)) {
                  pendingContext.set(filePath, []);
                }
                pendingContext.get(filePath)!.push(record.data.line_number);
              }
            } else if (record.type === "end") {
              const filePath = decodeField(record.data.path);
              if (filePath && pendingContext.has(filePath)) {
                const pending = pendingContext.get(filePath)!;
                if (pending.length > 0) {
                  if (!fileLines.has(filePath)) {
                    fileLines.set(filePath, new Set<number>());
                  }
                  const linesSet = fileLines.get(filePath)!;
                  for (const lineNo of pending) {
                    linesSet.add(lineNo);
                  }
                  pendingContext.set(filePath, []);
                }
              }
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        });

        child.on("close", (code, signal) => {
          if (limitReached) {
            resolve(formatResults());
            return;
          }
          if (code === 0 || code === 1) {
            resolve(formatResults());
            return;
          }
          const errMsg = stderrData.trim() || `ripgrep exited with code ${code} (signal: ${signal})`;
          reject(new Error(`Grep error: ${errMsg}`));
        });

        function formatResults() {
          const results: string[] = [];
          for (const [filePath, linesSet] of fileLines) {
            try {
              const absPath = pathResolve(_ctx.cwd, filePath);
              const text = readTextFile(absPath);
              const lines_arr = text.split("\n");
              if (lines_arr.length > 0 && lines_arr[lines_arr.length - 1] === "") {
                lines_arr.pop();
              }
              const hashes = lines_arr.map((_, i) => computeLineHash(lines_arr, i, config.hashLength));
              const sortedLines = Array.from(linesSet).sort((a, b) => a - b);
              const fileBlock: string[] = [`[${filePath}]`];
              let lastLineNo = -1;
              for (const lineNo of sortedLines) {
                if (lineNo > lines_arr.length) continue;
                if (lastLineNo !== -1 && lineNo > lastLineNo + 1) {
                  fileBlock.push("  ...");
                }
                fileBlock.push(formatHashline(lineNo, hashes[lineNo - 1], lines_arr[lineNo - 1]));
                lastLineNo = lineNo;
              }
              results.push(fileBlock.join("\n"));
            } catch {
              results.push(`[${filePath}] (binary or unreadable)`);
            }
          }

          const outputText = results.join("\n\n") || "No matches found.";
          return {
            content: [{ type: "text", text: outputText }],
            details: {},
          };
        }
      });
    },
  });
}
