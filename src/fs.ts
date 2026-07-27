import { accessSync, constants, readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const TEXT_EXTENSIONS = new Set([
  ".ts", ".js", ".jsx", ".tsx", ".mjs", ".cjs", ".mts", ".cts",
  ".json", ".yaml", ".yml", ".toml", ".md", ".mdx",
  ".css", ".scss", ".less", ".html", ".htm", ".xml", ".svg",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
  ".sh", ".bash", ".zsh", ".fish",
  ".txt", ".cfg", ".conf", ".ini", ".env", ".gitignore",
  ".sql", ".graphql", ".prisma",
  ".vue", ".svelte", ".astro",
]);

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

export type FileKind = "text" | "image" | "binary" | "directory" | "not_found";

export function detectFileKind(filePath: string): FileKind {
  try {
    const stat = statSync(filePath);
    if (stat.isDirectory()) return "directory";
  } catch {
    return "not_found";
  }
  
  const ext = filePath.toLowerCase().replace(/.*\.(.+)$/, ".$1");
  
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  
  // Check for null bytes to detect binary
  try {
    const buf = readFileSync(filePath);
    if (buf.includes(0)) return "binary";
    return "text";
  } catch {
    return "binary";
  }
}

/** Read file as text, throw descriptive error if not text */
export function readTextFile(filePath: string): string {
  const kind = detectFileKind(filePath);
  if (kind === "not_found") throw new Error(`[E_FILE_NOT_FOUND] File not found: ${filePath}`);
  if (kind === "directory") throw new Error(`[E_IS_DIRECTORY] Path is a directory: ${filePath}`);
  if (kind === "binary") throw new Error(`[E_BINARY_FILE] Cannot read binary file: ${filePath}`);
  if (kind === "image") throw new Error(`[E_IMAGE_FILE] Cannot read image as text: ${filePath}`);
  
  return readFileSync(filePath, "utf-8");
}

/** Atomic write: write to temp file, then rename to target */
export function writeFileAtomically(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  
  const tmpName = `.tmp-${randomBytes(4).toString("hex")}-${Date.now()}`;
  const tmpPath = resolve(dir, tmpName);
  
  writeFileSync(tmpPath, content, "utf-8");
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { accessSync(tmpPath, constants.F_OK); } catch {}
    try { renameSync(tmpPath, filePath); } catch {
      // If rename fails, try to clean up temp file
      writeFileSync(tmpPath, ""); // truncate
      try { renameSync(tmpPath, filePath); } catch {}
    }
    throw err;
  }
}
