import { record, validOccurrenceId, LIMITS, parseTimingOffset } from '../core/settings.ts';
import type { PlayerSnapshot } from '../core/types.ts';
import { siteUrl } from '../integration/metadata.ts';
export interface Target {
  tabId: number;
  frameId: number;
  documentId: string;
  instance: string;
  episode: string | null;
  version: string | null;
}
export interface RoutedPlayer {
  target: Target;
  snapshot: PlayerSnapshot & { hasMedia: boolean };
}
export function trustedUi(
  sender: { id?: string; url?: string; tab?: unknown },
  id: string,
): boolean {
  if (sender.id !== id || !sender.url) return false;
  try {
    const u = new URL(sender.url);
    return (
      u.protocol === 'chrome-extension:' &&
      u.hostname === id &&
      ['/popup.html', '/options.html'].includes(u.pathname)
    );
  } catch {
    return false;
  }
}
export function trustedContent(
  sender: {
    id?: string;
    url?: string;
    tab?: { id?: number | undefined };
    frameId?: number;
    documentId?: string;
  },
  id: string,
): boolean {
  return (
    sender.id === id &&
    typeof sender.tab?.id === 'number' &&
    typeof sender.frameId === 'number' &&
    typeof sender.documentId === 'string' &&
    !!sender.url &&
    siteUrl(sender.url)
  );
}
export function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error('Invalid tab/frame identity.');
  return Number(value);
}
export function parseTarget(value: unknown): Target {
  const t = record(value);
  if (
    typeof t.documentId !== 'string' ||
    t.documentId.length > 80 ||
    typeof t.instance !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(t.instance)
  )
    throw new Error('Invalid player identity.');
  for (const key of ['episode', 'version'])
    if (
      t[key] !== null &&
      (typeof t[key] !== 'string' || !/^[-a-z0-9]{1,80}$/i.test(t[key] as string))
    )
      throw new Error('Invalid episode identity.');
  return {
    tabId: integer(t.tabId),
    frameId: integer(t.frameId),
    documentId: t.documentId,
    instance: t.instance,
    episode: t.episode as string | null,
    version: t.version as string | null,
  };
}
export function parseSnapshot(value: unknown): PlayerSnapshot & { hasMedia: boolean } {
  const raw = record(value);
  if (raw.audioTiming !== undefined) {
    const timing = record(raw.audioTiming);
    if (
      timing.track !== null &&
      (typeof timing.track !== 'string' || !/^[a-f0-9]{64}$/.test(timing.track))
    )
      throw new Error('Invalid timing correction track.');
    parseTimingOffset(timing.offset);
    if (
      timing.automaticOffset !== undefined &&
      (typeof timing.automaticOffset !== 'number' ||
        !Number.isFinite(timing.automaticOffset) ||
        timing.automaticOffset < 0 ||
        timing.automaticOffset > 86400)
    )
      throw new Error('Invalid automatic caption offset.');
  }
  if (
    typeof raw.instance !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(raw.instance) ||
    typeof raw.hasMedia !== 'boolean' ||
    !Number.isFinite(raw.time) ||
    Number(raw.time) < 0 ||
    Number(raw.time) > 86400 ||
    !Number.isSafeInteger(raw.total) ||
    Number(raw.total) < 0
  )
    throw new Error('Invalid player report.');
  for (const key of ['episode', 'version', 'audioLanguage', 'subtitleLanguage'])
    if (raw[key] !== null && (typeof raw[key] !== 'string' || (raw[key] as string).length > 80))
      throw new Error('Invalid language report.');
  for (const key of ['mode', 'trackSummary'])
    if (typeof raw[key] !== 'string' || (raw[key] as string).length > 1500)
      throw new Error('Invalid player report.');
  for (const key of ['audio', 'subtitles']) {
    const status = record(raw[key]);
    if (
      !['loading', 'active', 'unavailable', 'disabled', 'error'].includes(String(status.phase)) ||
      typeof status.reason !== 'string' ||
      status.reason.length > 1500
    )
      throw new Error('Invalid filter status.');
  }
  if (
    !Array.isArray(raw.occurrences) ||
    raw.occurrences.length > LIMITS.occurrences ||
    Number(raw.total) < raw.occurrences.length
  )
    throw new Error('Invalid occurrence list.');
  for (const item of raw.occurrences) {
    const row = record(item);
    if (
      !validOccurrenceId(row.id) ||
      typeof row.track !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.track) ||
      typeof row.cue !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.cue) ||
      typeof row.text !== 'string' ||
      row.text.length > 8000 ||
      typeof row.term !== 'string' ||
      !row.term ||
      row.term.length > 100
    )
      throw new Error('Invalid occurrence.');
    if (
      !Number.isInteger(row.start) ||
      !Number.isInteger(row.end) ||
      Number(row.start) < 0 ||
      Number(row.end) <= Number(row.start) ||
      Number(row.end) > row.text.length ||
      !Number.isFinite(row.time) ||
      !Number.isFinite(row.endTime) ||
      Number(row.time) < 0 ||
      Number(row.endTime) <= Number(row.time) ||
      Number(row.endTime) > 86400
    )
      throw new Error('Invalid occurrence timing.');
    for (const key of ['ignored', 'audioCensored', 'textCensored'])
      if (typeof row[key] !== 'boolean') throw new Error('Invalid occurrence flags.');
    if (row.timingUnreliable !== undefined && typeof row.timingUnreliable !== 'boolean')
      throw new Error('Invalid occurrence timing flag.');
    if (
      row.playbackTime !== undefined &&
      row.playbackTime !== null &&
      (typeof row.playbackTime !== 'number' ||
        !Number.isFinite(row.playbackTime) ||
        row.playbackTime < 0 ||
        row.playbackTime > 86400)
    )
      throw new Error('Invalid corrected timestamp.');
  }
  return raw as unknown as PlayerSnapshot & { hasMedia: boolean };
}
export async function send<T = unknown>(request: unknown): Promise<T> {
  const response = record((await chrome.runtime.sendMessage(request)) as unknown);
  if (response.ok !== true)
    throw new Error(
      typeof response.error === 'string'
        ? response.error
        : 'The extension could not complete the request.',
    );
  return response.data as T;
}
