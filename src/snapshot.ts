import { LRUCache } from "lru-cache";
import { statSync } from "node:fs";
import { computeLineHash } from "./hash.js";
import { loadConfig } from "./config.js";

interface StoredSnapshot {
  text: string;
  hash: string;  // file-level hash
  lineHashes: string[];
  seenLines: Set<number> | null;
  mtimeMs: number;
  size: number;
}

/**
 * Per-path version-ring: stores up to MAX_VERSIONS per path,
 * evicts oldest when full.
 */
class VersionRing {
  private versions: StoredSnapshot[] = [];
  private readonly MAX = 10;

  push(snap: StoredSnapshot): void {
    this.versions.push(snap);
    if (this.versions.length > this.MAX) {
      this.versions.shift();
    }
  }

  head(): StoredSnapshot | undefined {
    return this.versions[this.versions.length - 1];
  }

  byHash(hash: string): StoredSnapshot | undefined {
    // Search newest first
    for (let i = this.versions.length - 1; i >= 0; i--) {
      if (this.versions[i].hash === hash) return this.versions[i];
    }
    return undefined;
  }

  all(): StoredSnapshot[] {
    return [...this.versions];
  }

  clear(): void {
    this.versions = [];
  }
}

class SnapshotStore {
  private cache = new LRUCache<string, VersionRing>({
    max: 100,
  });

  /** Record a new snapshot for a path. Returns file-level hash. */
  async record(path: string, text: string, seenLines?: Set<number>): Promise<string> {
    const stat = statSync(path);
    const lines = text.split("\n");
    const { hashLength } = loadConfig();
    const lineHashes = lines.map((_, i) => computeLineHash(lines, i, hashLength));
    const fileHash = lineHashes.join("|"); // composite hash

    const snap: StoredSnapshot = {
      text,
      hash: fileHash,
      lineHashes,
      seenLines: seenLines ?? null,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };

    let ring = this.cache.get(path);
    if (!ring) {
      ring = new VersionRing();
      this.cache.set(path, ring);
    }
    ring.push(snap);

    return fileHash;
  }

  /** Get the latest snapshot for a path */
  head(path: string): StoredSnapshot | undefined {
    return this.cache.get(path)?.head();
  }

  /** Get snapshot by file-level hash */
  byHash(path: string, hash: string): StoredSnapshot | undefined {
    return this.cache.get(path)?.byHash(hash);
  }

  /** Get all versions for a path, oldest first */
  versions(path: string): StoredSnapshot[] {
    return this.cache.get(path)?.all() ?? [];
  }

  /** Invalidate all snapshots for a path */
  invalidate(path: string): void {
    this.cache.get(path)?.clear();
  }

  /** Clear all snapshots */
  clear(): void {
    this.cache.clear();
  }
}

export const snapshotStore = new SnapshotStore();
