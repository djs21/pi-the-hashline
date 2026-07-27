import type xxhashWasm from "xxhash-wasm";

const NIBBLE_STR = "ZPMQVRWSNKTXJBYH";
let h32: ReturnType<Awaited<typeof xxhashWasm>>["h32ToString"] | null = null;
let initPromise: Promise<void> | null = null;

export async function initHash(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const xxh = await import("xxhash-wasm");
    const wasm = await xxh.default();
    h32 = wasm.h32ToString;
  })();
  return initPromise;
}

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

/** Compute context-based hash for a line at index within the file lines array */
export function computeLineHash(lines: string[], index: number, hashLength: number): string {
  if (!h32) throw new Error("Hash not initialized. Call initHash() first.");
  
  const prev = index > 0 ? normalizeHashInput(lines[index - 1]) : "";
  const curr = normalizeHashInput(lines[index]);
  const next = index < lines.length - 1 ? normalizeHashInput(lines[index + 1]) : "";
  
  const hashHex = h32(prev + "\0" + curr + "\0" + next);
  // Take low (hashLength * 4) bits = hashLength nibbles from the end
  return encodeNibbleStr(hashHex.slice(-hashLength), hashLength);
}

/** Compute hash for all lines (batch) */
export function computeAllLineHashes(lines: string[], hashLength: number): string[] {
  return lines.map((_, i) => computeLineHash(lines, i, hashLength));
}
