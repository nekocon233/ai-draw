interface SaveEntry<T> {
  value: T;
  promise: Promise<boolean>;
  resolve: (saved: boolean) => void;
  timer?: ReturnType<typeof setTimeout>;
  started: boolean;
  result?: boolean;
}

/** Debounce per session, serialize writes, and keep failed drafts available for recovery. */
export class SessionSaveQueue<T> {
  private latest = new Map<string, SaveEntry<T>>();
  private chains = new Map<string, Promise<boolean>>();
  private epoch = 0;
  private write: (sessionId: string, value: T) => Promise<unknown>;
  private delay: number;
  private onResult: (sessionId: string, saved: boolean) => void;

  constructor(write: (sessionId: string, value: T) => Promise<unknown>, options: {
    delay?: number; onResult?: (sessionId: string, saved: boolean) => void;
  } = {}) {
    this.write = write;
    this.delay = options.delay ?? 400;
    this.onResult = options.onResult ?? (() => {});
  }

  save(sessionId: string, value: T, immediate = false): Promise<boolean> {
    const previous = this.latest.get(sessionId);
    if (previous && !previous.started) {
      clearTimeout(previous.timer);
      previous.resolve(false);
    }
    let resolve!: (saved: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    const entry: SaveEntry<T> = { value: structuredClone(value), promise, resolve, started: false };
    this.latest.set(sessionId, entry);
    if (immediate) this.start(sessionId, entry);
    else entry.timer = setTimeout(() => this.start(sessionId, entry), this.delay);
    return promise;
  }

  flush(sessionId: string): Promise<boolean> {
    const entry = this.latest.get(sessionId);
    if (!entry) return this.chains.get(sessionId) ?? Promise.resolve(true);
    if (entry.result === false) return this.save(sessionId, entry.value, true);
    this.start(sessionId, entry);
    return entry.promise;
  }

  draft(sessionId: string): T | undefined {
    const entry = this.latest.get(sessionId);
    return entry ? structuredClone(entry.value) : undefined;
  }

  clear() {
    this.epoch += 1;
    for (const entry of this.latest.values()) {
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    this.latest.clear();
    this.chains.clear();
  }

  private start(sessionId: string, entry: SaveEntry<T>) {
    if (entry.started) return;
    clearTimeout(entry.timer);
    entry.started = true;
    const epoch = this.epoch;
    const chain = (this.chains.get(sessionId) ?? Promise.resolve(true)).then(async () => {
      if (epoch !== this.epoch) return false;
      let saved = false;
      try {
        await this.write(sessionId, entry.value);
        saved = true;
      } catch {
        // The caller receives failure without an unhandled rejection from autosave.
      }
      if (epoch === this.epoch && this.latest.get(sessionId) === entry) {
        if (saved) this.latest.delete(sessionId);
        this.onResult(sessionId, saved);
      }
      return saved;
    });
    this.chains.set(sessionId, chain);
    void chain.then(saved => {
      entry.result = saved;
      entry.resolve(saved);
      if (this.chains.get(sessionId) === chain) this.chains.delete(sessionId);
    });
  }
}
