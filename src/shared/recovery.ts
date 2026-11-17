// A failed worker initialization must not poison every later request until a
// browser restart. Concurrent requests share one attempt; success stays cached.
export function retryableInitialization(initialize: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    pending ??= Promise.resolve()
      .then(initialize)
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  };
}

// Event-triggered registration, not a service-worker keepalive. After success
// there is no timer. Failures have a bounded budget and can be retried on restore.
export class ConnectionRecovery<T> {
  private attempt: () => Promise<T>;
  private accept: (value: T) => void;
  private delays: readonly number[];
  private timeoutMs: number;
  private running = false;
  private generation = 0;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelAttempt: (() => void) | null = null;
  constructor(
    attempt: () => Promise<T>,
    accept: (value: T) => void,
    delays: readonly number[] = [250, 1000, 3000, 10000, 30000],
    timeoutMs = 5000,
  ) {
    this.attempt = attempt;
    this.accept = accept;
    this.delays = delays;
    this.timeoutMs = timeoutMs;
  }
  start(): void {
    if (this.running || this.retryTimer) return;
    this.failures = 0;
    void this.run();
  }
  private async run(): Promise<void> {
    this.running = true;
    const generation = this.generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        this.cancelAttempt = () => reject(new Error('Connection canceled.'));
        timer = setTimeout(() => reject(new Error('Connection timed out.')), this.timeoutMs);
      });
      const value = await Promise.race([Promise.resolve().then(this.attempt), timeout]);
      if (generation === this.generation) this.accept(value);
    } catch {
      const delay = this.delays[this.failures++];
      if (generation === this.generation && delay !== undefined)
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.run();
        }, delay);
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) {
        this.running = false;
        this.cancelAttempt = null;
      }
    }
  }
  stop(): void {
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.cancelAttempt?.();
    this.cancelAttempt = null;
    this.running = false;
  }
}
