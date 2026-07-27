import { tokenize, type TokenType } from "./tokenizer.js";
import type { EditOp } from "./types.js";
import { findBraceBlock } from "./block-resolver.js";

export interface ParseResult {
  edits: ParsedEdit[];
  warnings: string[];
}

/** An edit with its original token type preserved */
export interface ParsedEdit extends EditOp {
  originalToken: TokenType;
}

/**
 * Parse a hashline DSL diff text into per-file sections.
 * Each section is keyed by file path.
 */
export function parseDiff(diff: string): Map<string, { tag: string; edits: ParsedEdit[]; warnings: string[] }> {
  const sections = new Map<string, { tag: string; edits: ParsedEdit[]; warnings: string[] }>();
  let currentPath: string | null = null;
  let currentSection: { tag: string; edits: ParsedEdit[]; warnings: string[] } | null = null;
  let pendingOp: Partial<ParsedEdit> | null = null;
  let payload: string[] = [];

  const ops = new Set<TokenType>([
    "OP_SWAP", "OP_DEL", "OP_INS_PRE", "OP_INS_POST",
    "OP_INS_HEAD", "OP_INS_TAIL",
    "OP_SWAP_BLK", "OP_DEL_BLK", "OP_INS_BLK_POST"
  ]);

  for (const token of tokenize(diff)) {
    if (token.type === "HEADER") {
      flushPending();
      currentPath = token.path!;
      currentSection = { tag: token.tag!, edits: [], warnings: [] };
      sections.set(currentPath, currentSection);
    } else if (ops.has(token.type)) {
      flushPending();
      if (!currentSection) {
        currentSection = { tag: "", edits: [], warnings: [] };
        sections.set("", currentSection);
      }
      pendingOp = {
        kind: tokenTypeToKind(token.type),
        originalToken: token.type,
        anchorLine: token.anchorLine ?? 0,
        endLine: token.endLine,
        payload: [],
        rawText: token.raw,
      };
      payload = [];
    } else if (token.type === "PAYLOAD") {
      if (pendingOp) payload.push(token.raw);
    } else if (token.type === "ABORT") {
      flushPending();
      break;
    }
    // BLANK and RAW: skip
  }

  flushPending();

  function flushPending() {
    if (pendingOp && pendingOp.kind && currentSection) {
      pendingOp.payload = [...payload];
      currentSection.edits.push(pendingOp as ParsedEdit);
    }
    pendingOp = null;
    payload = [];
  }

  return sections;
}

function tokenTypeToKind(t: TokenType): EditOp["kind"] {
  switch (t) {
    case "OP_SWAP": case "OP_SWAP_BLK": return "replace";
    case "OP_DEL": case "OP_DEL_BLK": return "delete";
    case "OP_INS_PRE": return "insert_before";
    case "OP_INS_POST": case "OP_INS_BLK_POST": return "insert_after";
    case "OP_INS_HEAD": return "insert_head";
    case "OP_INS_TAIL": return "insert_tail";
    default: return "replace";
  }
}

/**
 * Resolve block edits (/*_BLK* / ops) into concrete line ranges
 * using brace-matching block resolver.
 */
export function resolveBlockEdits(
  fileText: string,
  edits: ParsedEdit[],
  warnings: string[]
): void {
  const BLOCK_OPS = new Set<TokenType>(["OP_SWAP_BLK", "OP_DEL_BLK", "OP_INS_BLK_POST"]);

  for (const edit of edits) {
    if (!BLOCK_OPS.has(edit.originalToken)) continue;

    const block = findBraceBlock(fileText, edit.anchorLine);
    if (!block) {
      warnings.push(`Could not resolve block at line ${edit.anchorLine} (indent-based language or unbalanced braces)`);
      continue;
    }

    // Convert block span to concrete line range
    edit.anchorLine = block.startLine;
    edit.endLine = block.endLine;

    // Re-map kind
    switch (edit.originalToken) {
      case "OP_SWAP_BLK": edit.kind = "replace"; break;
      case "OP_DEL_BLK": edit.kind = "delete"; break;
      case "OP_INS_BLK_POST": edit.kind = "insert_after"; break;
    }
  }
}
