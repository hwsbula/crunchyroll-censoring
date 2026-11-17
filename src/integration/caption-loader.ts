import type { Session } from '../core/types.ts';
import { loadSession } from './metadata.ts';
import type { Resource } from './metadata.ts';

export class CaptionDownloadError extends Error {
  readonly retryable: boolean;
  constructor(retryable: boolean) {
    super('Caption download unavailable.');
    this.retryable = retryable;
  }
}
interface Load {
  episode: string;
  version: string;
  audio: string | null;
  resources: Resource[];
  cache: Map<string, string>;
  failed: Set<string>;
  transient: Set<string>;
  abort: AbortController;
  attempts: number;
  pending: Promise<Session> | null;
  recovered: (session: Session) => void;
}

// Current, observed English resources only. URLs and caption bodies stay in
// this page's memory, never storage or logs. Navigation cancels the whole job.
export class CaptionLoader {
  private current: Load | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private read: (resource: Resource, signal: AbortSignal) => Promise<string>;
  private delays: readonly number[];
  constructor(
    read: (resource: Resource, signal: AbortSignal) => Promise<string>,
    delays: readonly number[] = [500, 1500, 4000],
  ) {
    this.read = read;
    this.delays = delays;
  }
  start(
    episode: string,
    version: string,
    audio: string | null,
    resources: Resource[],
    recovered: (session: Session) => void,
  ): Promise<Session> {
    this.stop();
    const job: Load = {
      episode,
      version,
      audio,
      resources: resources.slice(0, 6),
      recovered,
      cache: new Map(),
      failed: new Set(),
      transient: new Set(),
      abort: new AbortController(),
      attempts: 0,
      pending: null,
    };
    this.current = job;
    return this.run(job);
  }
  private run(job: Load, manual = false): Promise<Session> {
    if (job.pending) return job.pending;
    const operation = loadSession(
      job.episode,
      job.version,
      job.audio,
      job.resources,
      async (resource) => {
        const cached = job.cache.get(resource.url);
        if (cached !== undefined) return cached;
        if (!manual && job.failed.has(resource.url) && !job.transient.has(resource.url))
          throw new CaptionDownloadError(false);
        try {
          const text = await this.read(resource, job.abort.signal);
          job.cache.set(resource.url, text);
          job.failed.delete(resource.url);
          job.transient.delete(resource.url);
          return text;
        } catch (error) {
          job.failed.add(resource.url);
          if (!(error instanceof CaptionDownloadError) || error.retryable)
            job.transient.add(resource.url);
          else job.transient.delete(resource.url);
          throw error;
        }
      },
    );
    job.pending = operation;
    void operation
      .finally(() => {
        job.pending = null;
        this.schedule(job);
      })
      .catch(() => undefined);
    return operation;
  }
  private schedule(job: Load): void {
    const delay = this.delays[job.attempts];
    if (this.current !== job || !job.transient.size || delay === undefined || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      job.attempts++;
      void this.run(job)
        .then((session) => {
          if (this.current === job) job.recovered(session);
        })
        .catch(() => undefined);
    }, delay);
  }
  async retry(): Promise<void> {
    const job = this.current;
    if (!job || !job.failed.size) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    job.attempts = 0;
    const session = await this.run(job, true);
    if (this.current === job) job.recovered(session);
  }
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.current?.abort.abort();
    this.current = null;
  }
}
