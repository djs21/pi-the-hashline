/** Hash configuration */
export interface HashConfig {
  hashLength: 2 | 3 | 4;
  grep: boolean;
  replaceText?: boolean;
}

/** Snapshot entry for recovery */
export interface SnapshotEntry {
  text: string;
  hash: string;
  seenLines: Set<number> | null;
  mtimeMs: number;
  size: number;
}

/** A resolved, validated edit operation */
export interface EditOp {
  kind: "replace" | "delete" | "insert_before" | "insert_after" | "insert_head" | "insert_tail";
  anchorLine: number;        // 1-indexed
  endLine?: number;          // for replace/delete ranges
  payload: string[];         // replacement/insertion lines (empty for delete)
  rawText?: string;          // original DSL text for error messages
}

/** Parsed edit section: one file with a TAG hash */
export interface EditSection {
  path: string;
  fileHash: string;
  edits: EditOp[];
}

/** Result of applying edits */
export interface ApplyResult {
  text: string;
  firstChangedLine: number;
  lastChangedLine: number;
  warnings: string[];
}

/** Read tool parameters */
export interface ReadParams {
  path: string;
  offset?: number;
  limit?: number;
  raw?: boolean;
}

/** Edit tool parameters (native pi format or our DSL) */
export interface EditParams {
  path?: string;
  edits?: Array<{ diff?: string }>;
  diff?: string;
}
