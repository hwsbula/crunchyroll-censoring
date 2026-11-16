import { record } from './settings.ts';
import type { CaptionTimeline } from './types.ts';

// A single continuous, timeline-included MAIN segment has the same media and
// presentation clock. Other layouts require a richer mapping, not a guessed sum.
export function parseCaptionTimeline(value: unknown): CaptionTimeline {
  const raw = record(value);
  if (raw.kind === 'unavailable') return { kind: 'unavailable' };
  if (
    raw.kind !== 'stitched-main' ||
    typeof raw.start !== 'number' ||
    typeof raw.end !== 'number' ||
    typeof raw.duration !== 'number' ||
    !Number.isFinite(raw.start) ||
    !Number.isFinite(raw.end) ||
    !Number.isFinite(raw.duration) ||
    raw.start < 0 ||
    raw.end <= raw.start ||
    raw.duration !== raw.end ||
    raw.duration > 86400
  )
    throw new Error('Invalid caption timeline.');
  return { kind: 'stitched-main', start: raw.start, end: raw.end, duration: raw.duration };
}

export function automaticOffset(timeline: CaptionTimeline | undefined): number {
  return timeline?.kind === 'stitched-main' ? timeline.start : 0;
}
