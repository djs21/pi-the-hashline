/** Result of block resolution */
export interface BlockSpan {
  startLine: number;  // 1-indexed
  endLine: number;
  startCol: number;
  endCol: number;
}

/**
 * Find the brace block at the given line in the text.
 * Uses character-level state machine, skipping strings, comments, regex.
 * Returns null for indent-based languages or unbalanced braces.
 */
export function findBraceBlock(text: string, anchorLine: number): BlockSpan | null {
  const lines = text.split("\n");
  if (anchorLine < 1 || anchorLine > lines.length) return null;

  const anchorIdx = anchorLine - 1;
  const anchorText = lines[anchorIdx];

  // Find the opening brace on the anchor line
  const openCol = findOpeningBrace(anchorText);
  if (openCol === -1) return null;

  // Now scan forward for matching closing brace
  let depth = 1;
  let inSingle = false, inDouble = false, inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inRegex = false;
  let prevChar = "";

  for (let lineIdx = anchorIdx; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const startCol = lineIdx === anchorIdx ? openCol + 1 : 0;

    for (let col = startCol; col < line.length; col++) {
      const ch = line[col];
      const next = col + 1 < line.length ? line[col + 1] : "";

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }

      if (inBlockComment) {
        if (ch === "*" && next === "/") { inBlockComment = false; col++; }
        continue;
      }

      if (inSingle && ch === "'" && prevChar !== "\\") { inSingle = false; continue; }
      if (inDouble && ch === '"' && prevChar !== "\\") { inDouble = false; continue; }
      if (inBacktick && ch === "`" && prevChar !== "\\") { inBacktick = false; continue; }

      if (inRegex && ch === "/" && prevChar !== "\\") { inRegex = false; continue; }

      if (!inSingle && !inDouble && !inBacktick && !inBlockComment) {
        if (ch === "/" && next === "/") { inLineComment = true; col++; continue; }
        if (ch === "/" && next === "*") { inBlockComment = true; col++; continue; }

        // Regex detection heuristic
        if (ch === "/" && !inRegex && isRegexStart(prevChar, line, col)) {
          inRegex = true;
          continue;
        }
      }

      if (!inSingle && !inDouble && !inBacktick && !inBlockComment && !inLineComment && !inRegex) {
        if (ch === "'") { inSingle = true; }
        else if (ch === '"') { inDouble = true; }
        else if (ch === "`") { inBacktick = true; }
        else if (ch === "{") { depth++; }
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            return {
              startLine: anchorIdx + 1,
              endLine: lineIdx + 1,
              startCol: openCol,
              endCol: col,
            };
          }
        }
      }

      prevChar = ch;
    }

    // End of line resets line comment and regex
    inLineComment = false;
    inRegex = false;
    prevChar = "\n";
  }

  // Unbalanced
  return null;
}

function findOpeningBrace(line: string): number {
  let inSingle = false, inDouble = false, inBacktick = false;
  let inLineComment = false;
  let prevChar = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : "";

    if (inLineComment) break;
    if (inSingle && ch === "'" && prevChar !== "\\") { inSingle = false; continue; }
    if (inDouble && ch === '"' && prevChar !== "\\") { inDouble = false; continue; }
    if (inBacktick && ch === "`" && prevChar !== "\\") { inBacktick = false; continue; }

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") { i++; continue; }
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "'") inSingle = true;
      else if (ch === '"') inDouble = true;
      else if (ch === "`") inBacktick = true;
      else if (ch === "{") return i;
    }

    prevChar = ch;
  }

  return -1;
}

/** Heuristic: is '/' at this position a regex start or division operator? */
function isRegexStart(prev: string, line: string, col: number): boolean {
  // After operators, keywords, or at line start → likely regex
  const regexStarters = new Set(["=", "(", "[", "{", ",", ";", "!", "&", "|", "?", ":", "~", "%", "^", "*", "+", "-", "/", "=>", "...", "??", "&&", "||"]);
  if (col === 0 || prev.trim() === "") return true;
  if (regexStarters.has(prev)) return true;
  if (prev === "return" || prev === "throw" || prev === "typeof" || prev === "instanceof" || prev === "void" || prev === "delete") return true;
  // Check for keyword-like patterns (e.g., "case", "default")
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(prev) && !["in", "of", "as", "from"].includes(prev)) return false;
  return false;
}
