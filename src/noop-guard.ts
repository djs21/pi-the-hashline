interface GuardEntry {
  payloadKey: string;
  count: number;
}

class NoopGuard {
  private store = new Map<string, GuardEntry>();
  private readonly LIMIT = 3;

  /**
   * Track a noop edit. Throws if same payload seen LIMIT consecutive times.
   * @param path - canonical file path
   * @param payloadKey - hash of the edit payload for identity
   */
  track(path: string, payloadKey: string): void {
    const key = `${path}::${payloadKey}`;
    const entry = this.store.get(key);

    if (entry) {
      entry.count++;
      if (entry.count >= this.LIMIT) {
        this.store.delete(key);
        throw new Error(
          `[E_NOOP_LOOP] Edit produces no change after ${this.LIMIT} consecutive attempts on ${path}. ` +
          `The file content already matches the requested change.`
        );
      }
    } else {
      this.store.set(key, { payloadKey, count: 1 });
    }
  }

  /** Clear guard for a path (after successful non-noop) */
  clear(path: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(path + "::")) {
        this.store.delete(key);
      }
    }
  }

  /** Reset all guards */
  reset(): void {
    this.store.clear();
  }
}

export const noopGuard = new NoopGuard();
