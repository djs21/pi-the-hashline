/**
 * Hashline hashing: FNV-1a 32-bit with surrounding-line context.
 *
 * FNV-1a chosen over xxHash32 because:
 * - Zero dependencies, synchronous, ~20 lines
 * - Same collision properties at 8-16 bit output width (output bits dominate)
 * - No async init, no WASM dependency
 */

const NIBBLE_STR = "ZPMQVRWSNKTXJBYH";
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Normalize a line for hashing: strip \r, trimEnd trailing whitespace */
export function normalizeHashInput(line: string): string {
  return line.replace(/\r$/, "").trimEnd();
}

/** Encode a hex string fragment into NIBBLE_STR of given length */
export function encodeNibbleStr(hexPart: string, length: number): string {
  let result = "";
  for (let i = 0; i < length && i < hexPart.length; i++) {
    const nibble = parseInt(hexPart[i], 16);
    result += NIBBLE_STR[nibble];
  }
  return result;
}

/** FNV-1a 32-bit hash of context triple */
function fnvHash(prev: string, curr: string, next: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < prev.length; i++) {
    hash = Math.imul(hash ^ prev.charCodeAt(i), FNV_PRIME);
  }
  hash = Math.imul(hash ^ 0, FNV_PRIME);
  for (let i = 0; i < curr.length; i++) {
    hash = Math.imul(hash ^ curr.charCodeAt(i), FNV_PRIME);
  }
  hash = Math.imul(hash ^ 0, FNV_PRIME);
  for (let i = 0; i < next.length; i++) {
    hash = Math.imul(hash ^ next.charCodeAt(i), FNV_PRIME);
  }
  return hash >>> 0;  // Math.imul returns signed 32-bit; convert to unsigned
}

/** Compute context-based hash for a line at index within the file lines array */
export function computeLineHash(lines: string[], index: number, hashLength: number): string {
  const prev = index > 0 ? normalizeHashInput(lines[index - 1]) : "";
  const curr = normalizeHashInput(lines[index]);
  const next = index < lines.length - 1 ? normalizeHashInput(lines[index + 1]) : "";
  const hash = fnvHash(prev, curr, next);
  const hex = hash.toString(16).toUpperCase();
  const useHex = hex.slice(-hashLength);
  return encodeNibbleStr(useHex, hashLength);
}

/** Compute hash for all lines (batch) */
export function computeAllLineHashes(lines: string[], hashLength: number): string[] {
  return lines.map((_, i) => computeLineHash(lines, i, hashLength));
}
