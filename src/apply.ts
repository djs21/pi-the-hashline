import type { EditOp, ApplyResult } from "./types.js";

/** Lines that are considered "structural closers" for landing-shift */
const CLOSER_RE = /^\s*[}\])]\s*$/;

/**
 * Apply edits to text bottom-up. Returns new text + metadata.
 */
export function applyEdits(text: string, edits: EditOp[]): ApplyResult {
  if (edits.length === 0) {
    return { text, firstChangedLine: 0, lastChangedLine: 0, warnings: [] };
  }

  const lines = text.split("\n");
  const warnings: string[] = [];
  let firstChanged = Infinity;
  let lastChanged = -1;

  // Separate head/tail inserts from positional edits
  const headInserts: string[] = [];
  const tailInserts: string[] = [];
  const positionalEdits: EditOp[] = [];

  for (const edit of edits) {
    if (edit.kind === "insert_head") {
      headInserts.push(...edit.payload);
    } else if (edit.kind === "insert_tail") {
      tailInserts.push(...edit.payload);
    } else {
      positionalEdits.push(edit);
    }
  }

  // Sort positional edits bottom-up (descending anchorLine)
  positionalEdits.sort((a, b) => {
    const aEnd = a.endLine ?? a.anchorLine;
    const bEnd = b.endLine ?? b.anchorLine;
    if (bEnd !== aEnd) return bEnd - aEnd;  // descending by end
    return b.anchorLine - a.anchorLine;      // then by start
  });

  // Apply head inserts first (they shift everything down)
  if (headInserts.length > 0) {
    lines.splice(0, 0, ...headInserts);
    firstChanged = 1;
    lastChanged = headInserts.length;
  }

  // Apply positional edits
  for (const edit of positionalEdits) {
    const idx = edit.anchorLine - 1; // 0-indexed

    switch (edit.kind) {
      case "delete": {
        const endIdx = (edit.endLine ?? edit.anchorLine) - 1;
        if (idx < 0 || endIdx >= lines.length) {
          warnings.push(`[E_RANGE_OOB] Delete range ${edit.anchorLine}..${edit.endLine ?? edit.anchorLine} out of bounds (file has ${lines.length} lines)`);
          continue;
        }
        lines.splice(idx, endIdx - idx + 1);
        firstChanged = Math.min(firstChanged, edit.anchorLine);
        lastChanged = edit.anchorLine;
        break;
      }

      case "replace": {
        const endIdx = (edit.endLine ?? edit.anchorLine) - 1;
        if (idx < 0 || endIdx >= lines.length) {
          warnings.push(`[E_RANGE_OOB] Replace range ${edit.anchorLine}..${edit.endLine ?? edit.anchorLine} out of bounds (file has ${lines.length} lines)`);
          continue;
        }

        let payload = [...edit.payload];

        // Self-healing: if last payload line duplicates first line after range, drop it
        if (payload.length > 0 && endIdx + 1 < lines.length) {
          const nextLine = lines[endIdx + 1];
          const lastPayload = payload[payload.length - 1];
          if (nextLine.trim() === lastPayload.trim() && CLOSER_RE.test(nextLine)) {
            payload.pop();
            warnings.push(`Self-healing: dropped trailing payload line that duplicates structural closer at line ${endIdx + 2}`);
          }
        }

        lines.splice(idx, endIdx - idx + 1, ...payload);
        firstChanged = Math.min(firstChanged, edit.anchorLine);
        lastChanged = Math.max(lastChanged, edit.anchorLine + Math.max(payload.length - 1, 0));
        break;
      }

      case "insert_before": {
        if (idx < 0 || idx > lines.length) {
          warnings.push(`[E_RANGE_OOB] Insert before line ${edit.anchorLine} out of bounds`);
          continue;
        }
        lines.splice(idx, 0, ...edit.payload);
        firstChanged = Math.min(firstChanged, edit.anchorLine);
        lastChanged = Math.max(lastChanged, edit.anchorLine + edit.payload.length - 1);
        break;
      }

      case "insert_after": {
        if (idx < 0 || idx >= lines.length) {
          warnings.push(`[E_RANGE_OOB] Insert after line ${edit.anchorLine} out of bounds`);
          continue;
        }

        // Landing-shift: if anchor is followed by structural closer, insert before it
        let insertIdx = idx + 1;
        while (insertIdx < lines.length && CLOSER_RE.test(lines[insertIdx])) {
          insertIdx++;
        }

        // If we shifted past closers AND the last payload line also matches a closer,
        // it would create a double-closer. Prevent by adjusting.
        const shifted = insertIdx > idx + 1;
        if (shifted) {
          warnings.push(`Landing-shift: INS.POST at line ${edit.anchorLine} shifted past ${insertIdx - idx - 1} structural closer(s)`);
        }

        lines.splice(insertIdx, 0, ...edit.payload);
        firstChanged = Math.min(firstChanged, edit.anchorLine);
        lastChanged = Math.max(lastChanged, insertIdx + edit.payload.length);
        break;
      }
    }
  }

  // Apply tail inserts
  if (tailInserts.length > 0) {
    const beforeLen = lines.length;
    lines.push(...tailInserts);
    firstChanged = Math.min(firstChanged, beforeLen + 1);
    lastChanged = lines.length;
  }

  // Normalize line endings back
  const result = lines.join("\n");

  return {
    text: result,
    firstChangedLine: firstChanged === Infinity ? 0 : firstChanged,
    lastChangedLine: lastChanged === -1 ? 0 : lastChanged,
    warnings,
  };
}
