export type TokenType =
  | "HEADER"
  | "OP_SWAP" | "OP_DEL"
  | "OP_INS_PRE" | "OP_INS_POST" | "OP_INS_HEAD" | "OP_INS_TAIL"
  | "OP_SWAP_BLK" | "OP_DEL_BLK" | "OP_INS_BLK_POST"
  | "PAYLOAD" | "BLANK" | "ABORT" | "RAW";

export interface Token {
  type: TokenType;
  raw: string;
  lineNo: number;
  // For ops:
  anchorLine?: number;
  endLine?: number;
  tag?: string;       // for HEADER
  path?: string;      // for HEADER
}

const HEADER_RE = /^\s*\[([^\]]+)#([A-Z0-9]+)\]\s*$/;
const OP_SWAP_RE = /^\s*SWAP\s+(\d+)\.?=?(\d+)?:\s*$/;
const OP_SWAP_SINGLE_RE = /^\s*SWAP\s+(\d+):\s*$/;
const OP_DEL_RE = /^\s*DEL\s+(\d+)\.?=?(\d+)?\s*$/;
const OP_DEL_SINGLE_RE = /^\s*DEL\s+(\d+)\s*$/;
const OP_INS_PRE_RE = /^\s*INS\.PRE\s+(\d+):\s*$/;
const OP_INS_POST_RE = /^\s*INS\.POST\s+(\d+):\s*$/;
const OP_INS_HEAD_RE = /^\s*INS\.HEAD:\s*$/;
const OP_INS_TAIL_RE = /^\s*INS\.TAIL:\s*$/;
const OP_SWAP_BLK_RE = /^\s*SWAP\.BLK\s+(\d+):\s*$/;
const OP_DEL_BLK_RE = /^\s*DEL\.BLK\s+(\d+)\s*$/;
const OP_INS_BLK_POST_RE = /^\s*INS\.BLK\.POST\s+(\d+):\s*$/;
const ABORT_RE = /^\s*ABORT\s*$/;
const PAYLOAD_RE = /^\s{2,}(\S.*)$/; // indented non-empty
const BLANK_RE = /^\s*$/;

export function* tokenize(text: string): Generator<Token> {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;

    let m: RegExpMatchArray | null;

    if (BLANK_RE.test(raw)) {
      yield { type: "BLANK", raw, lineNo };
      continue;
    }

    if (ABORT_RE.test(raw)) {
      yield { type: "ABORT", raw, lineNo };
      break;
    }

    if (m = raw.match(HEADER_RE)) {
      yield { type: "HEADER", raw, lineNo, path: m[1], tag: m[2] };
      continue;
    }

    if (m = raw.match(OP_SWAP_RE)) {
      yield { type: "OP_SWAP", raw, lineNo, anchorLine: parseInt(m[1]), endLine: m[2] ? parseInt(m[2]) : undefined };
      continue;
    }
    if (m = raw.match(OP_SWAP_SINGLE_RE)) {
      yield { type: "OP_SWAP", raw, lineNo, anchorLine: parseInt(m[1]) };
      continue;
    }

    if (m = raw.match(OP_DEL_RE)) {
      yield { type: "OP_DEL", raw, lineNo, anchorLine: parseInt(m[1]), endLine: m[2] ? parseInt(m[2]) : undefined };
      continue;
    }
    if (m = raw.match(OP_DEL_SINGLE_RE)) {
      yield { type: "OP_DEL", raw, lineNo, anchorLine: parseInt(m[1]) };
      continue;
    }

    if (m = raw.match(OP_INS_PRE_RE)) {
      yield { type: "OP_INS_PRE", raw, lineNo, anchorLine: parseInt(m[1]) };
      continue;
    }
    if (m = raw.match(OP_INS_POST_RE)) {
      yield { type: "OP_INS_POST", raw, lineNo, anchorLine: parseInt(m[1]) };
      continue;
    }
    if (OP_INS_HEAD_RE.test(raw)) {
      yield { type: "OP_INS_HEAD", raw, lineNo };
      continue;
    }
    if (OP_INS_TAIL_RE.test(raw)) {
      yield { type: "OP_INS_TAIL", raw, lineNo };
      continue;
    }

    if (m = raw.match(OP_SWAP_BLK_RE)) {
      yield { type: "OP_SWAP_BLK", raw, lineNo, anchorLine: parseInt(m[1]) };
      continue;
    }
    if (m = raw.match(OP_DEL_BLK_RE)) {
      yield { type: "OP_DEL_BLK", raw, lineNo, anchorLine: parseInt(m[1]) };
      continue;
    }
    if (m = raw.match(OP_INS_BLK_POST_RE)) {
      yield { type: "OP_INS_BLK_POST", raw, lineNo, anchorLine: parseInt(m[1]) };
      continue;
    }

    if (m = raw.match(PAYLOAD_RE)) {
      yield { type: "PAYLOAD", raw: m[1], lineNo };  // raw = content without indentation
      continue;
    }

    yield { type: "RAW", raw, lineNo };
  }
}
