import { digest, english, LIMITS, record } from '../core/settings.ts';
import { parseCaptions } from '../core/captions.ts';
import type { Session, Track } from '../core/types.ts';

export const SITE_ORIGIN = 'https://www.crunchyroll.com';
export const PLAYER_ORIGIN = 'https://static.crunchyroll.com';
export function siteUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.origin === SITE_ORIGIN ||
      (u.origin === PLAYER_ORIGIN && u.pathname === '/vilos-v2/web/vilos/player.html')
    );
  } catch {
    return false;
  }
}
export function episodeId(url: string): string | null {
  try {
    return /\/watch\/([A-Z0-9]+)(?:\/|$)/i.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
export function playbackVersion(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.origin !== SITE_ORIGIN) return null;
    return (
      /^\/playback\/v4\/([A-Z0-9]+)\/web\/(?:chrome|firefox)\/play$/i.exec(u.pathname)?.[1] ?? null
    );
  } catch {
    return null;
  }
}
export function resourceKey(url: string): string {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password)
    throw new Error('Unsupported caption resource.');
  return u.origin + u.pathname;
}
export function audioMetadata(value: unknown): Map<string, string> {
  const data = record(value).data;
  const result = new Map<string, string>();
  if (!Array.isArray(data)) return result;
  for (const item of data.slice(0, 20)) {
    const raw = record(item);
    if (typeof raw.id !== 'string' || !raw.episode_metadata) continue;
    const language = record(raw.episode_metadata).audio_locale;
    if (
      typeof language === 'string' &&
      /^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(language) &&
      language.length <= 35
    )
      result.set(raw.id, language);
  }
  return result;
}
export interface Resource {
  language: string;
  kind: Track['kind'];
  format: 'ass' | 'vtt';
  url: string;
  key: string;
}
export function captionResources(value: unknown, onlyEnglish = true): Resource[] {
  const playback = record(value);
  const resources: Resource[] = [];
  for (const kind of ['captions', 'subtitles'] as const) {
    const tracks = playback[kind];
    if (!tracks || typeof tracks !== 'object' || Array.isArray(tracks)) continue;
    for (const [key, value] of Object.entries(tracks).slice(0, 40)) {
      const track = record(value);
      const language = typeof track.language === 'string' ? track.language : key;
      if (
        (onlyEnglish && !english(language)) ||
        !/^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(language) ||
        typeof track.url !== 'string' ||
        track.url.length > 8192
      )
        continue;
      const format = String(track.format ?? '').toLowerCase();
      if (format !== 'ass' && format !== 'vtt') continue;
      resourceKey(track.url);
      resources.push({ language, kind, format, url: track.url, key });
      if (resources.length >= (onlyEnglish ? 6 : 60)) return resources;
    }
  }
  return resources;
}
export function englishResources(value: unknown): Resource[] {
  return captionResources(value);
}
export async function loadSession(
  episode: string,
  version: string,
  audioLanguage: string | null,
  resources: Resource[],
  read: (resource: Resource) => Promise<string>,
): Promise<Session> {
  let captionIssue: string | undefined;
  const values = await Promise.all(
    resources.map(async (resource) => {
      let original: string;
      try {
        original = await read(resource);
      } catch {
        if (resource.kind === 'captions')
          captionIssue =
            'English dialogue/CC was supplied, but could not be loaded (network/CORS, timeout, or caption size limit).';
        return null;
      }
      try {
        const document = await parseCaptions(original, resource.format);
        const id = await digest(
          JSON.stringify([
            episode,
            version,
            resource.kind,
            resource.key,
            resource.language,
            resource.format,
          ]),
        );
        return {
          id,
          resource: resourceKey(resource.url),
          language: resource.language,
          version,
          kind: resource.kind,
          document,
        };
      } catch {
        if (resource.kind === 'captions')
          captionIssue =
            'English dialogue/CC was supplied, but its caption format or timing could not be parsed safely.';
        return null;
      }
    }),
  );
  const tracks: Track[] = values.filter((value): value is Track => value !== null);
  return { episode, version, audioLanguage, tracks, ...(captionIssue ? { captionIssue } : {}) };
}
export function selectedSubtitleResource(
  session: Session,
  url: string,
): NonNullable<Session['available']>[number] | null {
  const matches = session.available?.filter((track) => track.requestUrl === url) ?? [];
  // Ambiguous resource metadata cannot establish a selected subtitle language.
  return matches.length === 1 ? matches[0]! : null;
}
export type SessionEnvelope = Omit<Session, 'tracks'> & {
  tracks: Array<
    Omit<Track, 'document'> & { document: Pick<Track['document'], 'format' | 'original'> }
  >;
};
export function sessionEnvelope(session: Session): SessionEnvelope {
  return {
    ...session,
    tracks: session.tracks.map((track) => ({
      ...track,
      document: { format: track.document.format, original: track.document.original },
    })),
  };
}
// The cross-frame site channel is unprivileged. Validate it before it can control
// a media element. Resource URLs stay in page memory, never in the extension
// bridge/storage. Receivers only compare them; this channel cannot request fetches.
export function parseSession(value: unknown): SessionEnvelope {
  const raw = record(value);
  if (
    typeof raw.episode !== 'string' ||
    !/^[-a-z0-9]{1,80}$/i.test(raw.episode) ||
    typeof raw.version !== 'string' ||
    !/^[-a-z0-9]{1,80}$/i.test(raw.version)
  )
    throw new Error('Invalid episode identity.');
  if (
    raw.audioLanguage !== null &&
    (typeof raw.audioLanguage !== 'string' ||
      raw.audioLanguage.length > 35 ||
      !/^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(raw.audioLanguage))
  )
    throw new Error('Invalid audio language.');
  if (!Array.isArray(raw.tracks) || raw.tracks.length > 6) throw new Error('Invalid tracks.');
  for (const item of raw.tracks) {
    const track = record(item);
    if (
      typeof track.id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(track.id) ||
      track.version !== raw.version ||
      !english(String(track.language)) ||
      !['captions', 'subtitles'].includes(String(track.kind)) ||
      typeof track.resource !== 'string' ||
      track.resource.length > 8192
    )
      throw new Error('Invalid track.');
    const url = new URL(track.resource);
    if (resourceKey(track.resource) !== track.resource || url.search || url.hash)
      throw new Error('Invalid resource identity.');
    const document = record(track.document);
    if (
      !['ass', 'vtt'].includes(String(document.format)) ||
      typeof document.original !== 'string' ||
      document.original.length > LIMITS.trackBytes
    )
      throw new Error('Invalid caption data.');
    // Full cue maps are not trusted; receivers reparse original source instead.
  }
  if (
    raw.captionIssue !== undefined &&
    (typeof raw.captionIssue !== 'string' || raw.captionIssue.length > 500)
  )
    throw new Error('Invalid caption status.');
  if (raw.available !== undefined) {
    if (!Array.isArray(raw.available) || raw.available.length > 60)
      throw new Error('Invalid subtitle descriptors.');
    for (const item of raw.available) {
      const descriptor = record(item);
      if (
        typeof descriptor.resource !== 'string' ||
        descriptor.resource.length > 8192 ||
        resourceKey(descriptor.resource) !== descriptor.resource ||
        typeof descriptor.requestUrl !== 'string' ||
        descriptor.requestUrl.length > 8192 ||
        resourceKey(descriptor.requestUrl) !== descriptor.resource ||
        typeof descriptor.language !== 'string' ||
        !/^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(descriptor.language) ||
        typeof descriptor.format !== 'string' ||
        descriptor.format.length > 15 ||
        !['captions', 'subtitles'].includes(String(descriptor.kind))
      )
        throw new Error('Invalid subtitle descriptor.');
    }
  }
  return raw as unknown as SessionEnvelope;
}
