import { computeLineHash } from "./hash.js";

/** Format a single line as hashline: "  LINE#HASH:content" */
export function formatHashline(
  lineNo: number,
  hash: string,
  content: string
): string {
  const padded = String(lineNo).padStart(4, " ");
  return `${padded}#${hash}:${content}`;
}

/** Format a range of lines as hashlined output */
export function formatHashlineRegion(
  lines: string[],
  hashes: string[],
  offset: number,
  limit: number
): string[] {
  const end = Math.min(offset + limit, lines.length);
  const result: string[] = [];
  for (let i = offset; i < end; i++) {
    result.push(formatHashline(i + 1, hashes[i], lines[i]));
  }
  return result;
}

/** Parse a hashline back: return {lineNo, hash, content} or null */
export function parseHashline(line: string): { lineNo: number; hash: string; content: string } | null {
  // Pattern: /^\s*(\d+)#([A-Z]+):(.*)$/
  const match = line.match(/^\s*(\d+)#([A-Z]+?):(.*)$/);
  if (!match) return null;
  return {
    lineNo: parseInt(match[1], 10),
    hash: match[2],
    content: match[3],
  };
}

/** Extract hash from a [path#TAG] header */
export function parseFileHeader(line: string): { path: string; tag: string } | null {
  const match = line.match(/^\s*\[([^\]]+)#([A-Z0-9]+)\]/);
  if (!match) return null;
  return { path: match[1].trim(), tag: match[2] };
}
