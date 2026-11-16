export interface Interval {
  start: number;
  end: number;
  ids: string[];
}
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const value of [...intervals].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && value.start <= last.end) {
      last.end = Math.max(last.end, value.end);
      last.ids = [...new Set([...last.ids, ...value.ids])];
    } else merged.push({ start: Math.max(0, value.start), end: value.end, ids: [...value.ids] });
  }
  return merged;
}
export interface Media extends EventTarget {
  currentTime: number;
  duration?: number;
  playbackRate: number;
  paused: boolean;
  seeking: boolean;
  readyState: number;
  ended: boolean;
  muted: boolean;
  volume: number;
}
// Own the media's muted property only while attached. Explicit user/page writes,
// including setting true when already censored, are recorded separately.
export class MuteGate {
  private media: Media;
  private native: PropertyDescriptor;
  private previous: PropertyDescriptor | undefined;
  private userMuted: boolean;
  private censoring = false;
  constructor(media: Media) {
    this.media = media;
    this.previous = Object.getOwnPropertyDescriptor(media, 'muted');
    let prototype: object | null = media;
    let descriptor: PropertyDescriptor | undefined;
    while (prototype && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, 'muted');
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    if (!descriptor?.get || !descriptor.set || this.previous?.configurable === false)
      throw new Error('Player mute control is unavailable.');
    this.native = descriptor;
    this.userMuted = Boolean(descriptor.get.call(media));
    Object.defineProperty(media, 'muted', {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      get: () => Boolean(this.native.get!.call(media)),
      set: (value: unknown) => {
        this.userMuted = Boolean(value);
        this.apply();
      },
    });
  }
  private apply(): void {
    const desired = this.censoring || this.userMuted;
    if (Boolean(this.native.get!.call(this.media)) !== desired)
      this.native.set!.call(this.media, desired);
  }
  set(active: boolean): boolean {
    this.censoring = active;
    this.apply();
    return active && !this.userMuted;
  }
  release(): void {
    this.set(false);
  }
  dispose(): void {
    this.release();
    if (this.previous) Object.defineProperty(this.media, 'muted', this.previous);
    else Reflect.deleteProperty(this.media, 'muted');
  }
}
export class CueScheduler {
  intervals: Interval[] = [];
  private originalIntervals: Interval[] = [];
  private media: Media;
  private gate: MuteGate;
  constructor(media: Media, gate: MuteGate) {
    this.media = media;
    this.gate = gate;
  }
  setIntervals(intervals: readonly Interval[]): void {
    this.originalIntervals = [...intervals];
    this.intervals = mergeIntervals(intervals);
    this.tick();
  }
  tick(): string[] {
    const time = this.media.currentTime;
    const interval = this.intervals.find((value) => value.start <= time && value.end > time);
    const playable =
      !this.media.paused &&
      !this.media.seeking &&
      !this.media.ended &&
      this.media.readyState >= 3 &&
      this.media.playbackRate > 0;
    return this.gate.set(!!interval && playable)
      ? [
          ...new Set(
            this.originalIntervals
              .filter((value) => value.start <= time && value.end > time)
              .flatMap((value) => value.ids),
          ),
        ]
      : [];
  }
  release(): void {
    this.gate.release();
  }
  delay(): number {
    const next = this.intervals
      .flatMap((value) => [value.start, value.end])
      .find((time) => time > this.media.currentTime);
    return Math.max(
      4,
      Math.min(
        25,
        next === undefined
          ? 25
          : ((next - this.media.currentTime) * 1000) / Math.max(0.1, this.media.playbackRate),
      ),
    );
  }
}
