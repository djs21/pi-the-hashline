import { structuredPatch, applyPatch } from "diff";
import { snapshotStore } from "./snapshot.js";
import type { EditOp } from "./types.js";
import { applyEdits } from "./apply.js";

export interface RecoveryResult {
  text: string;
  warnings: string[];
}

/**
 * Attempt to recover from stale anchors by 3-way merging.
 * Tries each historical snapshot as merge base.
 */
export function tryRecover(
  path: string,
  liveText: string,
  edits: EditOp[],
  fileHash: string
): RecoveryResult | null {
  const versions = snapshotStore.versions(path);

  for (const snap of versions) {
    // Skip versions that match live content (no merge needed)
    if (snap.text === liveText) continue;

    try {
      // Apply edits to snapshot (the historical base)
      const baseResult = applyEdits(snap.text, edits);
      if (baseResult.warnings.some(w => w.startsWith("[E_RANGE_OOB]"))) continue;

      // Compute patch from snapshot → snapshot+edits
      const patch = structuredPatch(
        path, path,
        snap.text, baseResult.text,
        "", "", { context: 3 }
      );

      // Apply patch to live text with fuzzFactor 0 (no sliding)
      const merged = applyPatch(liveText, patch, { fuzzFactor: 0 });
      if (typeof merged === "string") {
        return {
          text: merged,
          warnings: [
            `Recovered stale anchors using snapshot version (hash: ${snap.hash.slice(0, 8)}...)`,
            ...baseResult.warnings,
          ],
        };
      }
    } catch {
      // Try next version
      continue;
    }
  }

  return null;
}
