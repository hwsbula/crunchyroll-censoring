import { record } from '../core/settings.ts';
import type { CaptionTimeline } from '../core/types.ts';

// Based on the inspected Katamari parser and supplied v4 response shape. Never
// request manifests/media or interpret signed video URLs to derive a timeline.
export function stitchedMain(
  value: unknown,
): { main: Record<string, unknown> | null; timeline: CaptionTimeline } | undefined {
  const raw = record(value);
  if (raw.stitchedElements === undefined) return undefined;
  if (Array.isArray(raw.stitchedElements) && raw.stitchedElements.length === 0) return undefined;
  const unavailable = { main: null, timeline: { kind: 'unavailable' as const } };
  if (!Array.isArray(raw.stitchedElements) || raw.stitchedElements.length > 40) return unavailable;
  const elements = raw.stitchedElements.map(record);
  const mains = elements.filter((element) => element.type === 'main');
  if (mains.length !== 1) return unavailable;
  const main = mains[0]!;
  let end = 0;
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index]!;
    if (
      typeof element.start !== 'number' ||
      typeof element.end !== 'number' ||
      !Number.isFinite(element.start) ||
      !Number.isFinite(element.end) ||
      element.start !== end ||
      element.end <= element.start ||
      element.end > 86400 ||
      element.timeline !== true ||
      typeof element.track !== 'boolean' ||
      !Array.isArray(element.textTracks) ||
      !Array.isArray(element.audioTracks) ||
      (index === elements.length - 1
        ? element !== main || element.track !== true
        : !['promo', 'logo'].includes(String(element.type)))
    )
      return { main, timeline: { kind: 'unavailable' } };
    end = element.end;
  }
  return {
    main,
    timeline: { kind: 'stitched-main', start: main.start as number, end, duration: end },
  };
}
