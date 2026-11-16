import type { Cue, Match, Session, Track } from '../core/types.ts';

export interface SubtitleSelection {
  language: string | null;
  track: Track | null;
}

// These are track labels, not the site's interface language. Katamari's
// source-inspected menu distinguishes CLOSED_CAPTION with the literal [CC].
export function resolveSubtitleLabel(session: Session, label: string): SubtitleSelection {
  const normalized = label.trim().replace(/\s+/g, ' ').toLowerCase();
  if (normalized === 'none' || normalized === 'off') return { language: 'off', track: null };
  const cc = /\s*\[cc\]$/.test(normalized);
  const name = normalized.replace(/\s*\[cc\]$/, '').trim();
  const kind = cc ? 'captions' : 'subtitles';
  const available =
    session.available ??
    session.tracks.map((track) => ({
      ...track,
      format: track.document.format,
    }));
  const candidates = available.filter((item) => {
    if (item.kind !== kind) return false;
    const language = item.language.replaceAll('_', '-');
    const aliases = new Set([language.toLowerCase()]);
    try {
      const display = new Intl.DisplayNames(['en'], { type: 'language' });
      aliases.add(display.of(language)!.toLowerCase());
      aliases.add(display.of(language.split('-')[0]!)!.toLowerCase());
      if (/^en(?:-|$)/i.test(language)) {
        aliases.add('english');
        const region = new Intl.Locale(language).region;
        if (region) {
          aliases.add(`english (${region.toLowerCase()})`);
          aliases.add(
            `english (${new Intl.DisplayNames(['en'], { type: 'region' }).of(region)!.toLowerCase()})`,
          );
          if (region === 'GB') aliases.add('english (uk)');
        }
      }
    } catch {
      // Invalid/unknown display aliases do not establish a track identity.
    }
    return aliases.has(name);
  });
  const unique = [
    ...new Map(
      candidates.map((item) => [
        JSON.stringify([item.resource, item.language, item.kind, item.format]),
        item,
      ]),
    ).values(),
  ];
  if (unique.length !== 1) return { language: null, track: null };
  const selected = unique[0]!;
  const tracks = session.tracks.filter(
    (track) =>
      track.version === session.version &&
      track.resource === selected.resource &&
      track.language === selected.language &&
      track.kind === selected.kind &&
      track.document.format === selected.format,
  );
  return { language: selected.language, track: tracks.length === 1 ? tracks[0]! : null };
}

function compact(text: string): { text: string; map: Array<[number, number]> } {
  let result = '';
  const map: Array<[number, number]> = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i]!)) {
      const start = i;
      while (i + 1 < text.length && /\s/.test(text[i + 1]!)) i++;
      if (result && i + 1 < text.length) {
        result += ' ';
        map.push([start, i + 1]);
      }
    } else {
      result += text[i];
      map.push([i, i + 1]);
    }
  }
  return { text: result, map };
}

// Project exact cue matches onto DOM text without changing inline elements,
// punctuation, whitespace outside matches, or real/synthetic line breaks.
// Whitespace layout may differ; other textual differences are not guessed.
export function projectCaptionMatches(
  expected: string,
  displayed: string,
  matches: readonly Match[],
): Match[] | null {
  const cue = compact(expected);
  const dom = compact(displayed);
  if (cue.text !== dom.text) return null;
  if (
    matches.some(
      (match) => match.start < 0 || match.end > expected.length || match.end <= match.start,
    )
  )
    return null;
  return matches.map((match) => {
    const first = cue.map.findIndex((range) => range[1] > match.start);
    let last = first;
    while (last + 1 < cue.map.length && cue.map[last + 1]![0] < match.end) last++;
    return { ...match, start: dom.map[first]![0], end: dom.map[last]![1] };
  });
}

export type DisplayCueMatch =
  | { kind: 'matched'; cues: readonly Cue[]; matches: Match[]; timing: 'current' | 'text' }
  | { kind: 'missing' }
  | { kind: 'ambiguous' };

// Text-only fallback: bind the complete displayed line to a unique cue in the
// already selected track. Never infer a language, choose a different track,
// invent audio timing, or transfer an Ignore choice between repeated lines.
export class DisplayCueIndex {
  private byText = new Map<string, Cue[]>();
  private timingVerified = true;
  constructor(cues: readonly Cue[]) {
    for (const cue of cues) {
      const text = compact(cue.text).text;
      if (!text) continue;
      const values = this.byText.get(text) ?? [];
      values.push(cue);
      this.byText.set(text, values);
    }
  }
  match(
    displayed: string,
    active: readonly Cue[],
    policy: ReadonlyMap<string, readonly Match[]>,
  ): DisplayCueMatch {
    const project = (cues: readonly Cue[], timing: 'current' | 'text'): DisplayCueMatch => {
      if (!cues.length) return { kind: 'missing' };
      let offset = 0;
      const matches: Match[] = [];
      for (const cue of cues) {
        for (const match of policy.get(cue.key) ?? [])
          matches.push({ ...match, start: match.start + offset, end: match.end + offset });
        offset += cue.text.length + 1;
      }
      const projected = projectCaptionMatches(
        cues.map((cue) => cue.text).join('\n'),
        displayed,
        matches,
      );
      return projected
        ? { kind: 'matched', cues, matches: projected, timing }
        : { kind: 'missing' };
    };
    const plans = active.length > 1 ? [active, ...active.map((cue) => [cue])] : [active];
    let found: DisplayCueMatch = { kind: 'missing' };
    for (const cues of plans) {
      const candidate = project(cues, 'current');
      if (candidate.kind !== 'matched') continue;
      if (found.kind === 'matched') return { kind: 'ambiguous' };
      found = candidate;
    }
    const candidates = this.byText.get(compact(displayed).text) ?? [];
    if (found.kind === 'matched') {
      // After observed drift, a repeated line cannot use the same unverified
      // clock to borrow another occurrence's exception. A unique aligned cue
      // establishes current-time association again (also after a seek).
      if (found.cues.length === 1 && candidates.length === 1) this.timingVerified = true;
      return this.timingVerified ? found : { kind: 'ambiguous' };
    }
    if (candidates.length > 1) return { kind: 'ambiguous' };
    const fallback = project(candidates, 'text');
    if (fallback.kind === 'matched') this.timingVerified = false;
    return fallback;
  }
}

export function redactDisplaySegments(
  segments: readonly string[],
  matches: readonly Match[],
): string[] {
  const source = segments.join('');
  const insert = new Map(matches.map((match) => [match.start, '****']));
  const remove = new Set<number>();
  for (const match of matches)
    for (let i = match.start; i < match.end; i++)
      if (source[i] !== '\n' && source[i] !== '\r') remove.add(i);
  let offset = 0;
  return segments.map((segment) => {
    let result = '';
    for (let i = 0; i < segment.length; i++, offset++) {
      result += insert.get(offset) ?? '';
      if (!remove.has(offset)) result += segment[i];
    }
    return result;
  });
}
