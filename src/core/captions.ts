import { digest, LIMITS } from './settings.ts';
import type { CaptionDocument, Cue, Match } from './types.ts';

function timestamp(value: string): number {
  if (!/^(?:\d+:)?[0-5]\d:[0-5]\d[.,]\d{1,3}$/.test(value.trim()))
    throw new Error('Invalid caption timestamp.');
  return value
    .trim()
    .replace(',', '.')
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0);
}
function visible(
  source: string,
  format: 'ass' | 'vtt',
): { text: string; map: Array<[number, number]> } {
  let text = '';
  const map: Array<[number, number]> = [];
  let drawing = false;
  for (let i = 0; i < source.length;) {
    const remainder = source.slice(i);
    const tag = format === 'ass' ? /^\{[^}]*\}/.exec(remainder) : /^<[^>]*>/.exec(remainder);
    if (tag) {
      const p = /\\p(\d+)/.exec(tag[0]);
      if (p) drawing = Number(p[1]) > 0;
      i += tag[0].length;
      continue;
    }
    if (drawing) {
      i++;
      continue;
    }
    const escape =
      format === 'ass'
        ? /^\\[Nnh]/.exec(remainder)
        : /^&(?:amp|lt|gt|nbsp|quot|apos);/.exec(remainder);
    if (escape) {
      const entity: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&nbsp;': ' ',
        '&quot;': '"',
        '&apos;': "'",
        '\\N': '\n',
        '\\n': '\n',
        '\\h': ' ',
      };
      text += entity[escape[0]]!;
      map.push([i, i + escape[0].length]);
      i += escape[0].length;
      continue;
    }
    text += source[i]!;
    map.push([i, i + 1]);
    i++;
  }
  return { text, map };
}
export async function parseCaptions(
  original: string,
  format: 'ass' | 'vtt',
): Promise<CaptionDocument> {
  if (new TextEncoder().encode(original).byteLength > LIMITS.trackBytes)
    throw new Error('Caption track exceeds the 3 MB local limit.');
  if (format === 'vtt' && !/^\uFEFF?WEBVTT(?:[ \t]|\r?$)/m.test(original))
    throw new Error('Missing WebVTT header.');
  const lines = original.replace(/^\uFEFF/, '').split(/\r?\n/);
  const cues: Cue[] = [];
  let fields: string[] = [];
  let inEvents = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let start: number,
      end: number,
      sourceText: string,
      textOffset = 0;
    if (format === 'ass') {
      if (/^\[/.test(line)) {
        inEvents = line.trim().toLowerCase() === '[events]';
        continue;
      }
      if (!inEvents) continue;
      if (/^Format:/i.test(line)) {
        fields = line
          .slice(line.indexOf(':') + 1)
          .split(',')
          .map((s) => s.trim().toLowerCase());
        continue;
      }
      if (!/^Dialogue:/i.test(line)) continue;
      if (fields.at(-1) !== 'text' || !fields.includes('start') || !fields.includes('end'))
        throw new Error('Unsupported ASS event format.');
      const prefix = line.indexOf(':') + 1;
      let offset = prefix;
      const cells: string[] = [];
      for (let f = 0; f < fields.length - 1; f++) {
        const comma = line.indexOf(',', offset);
        if (comma < 0) throw new Error('Malformed ASS dialogue.');
        cells.push(line.slice(offset, comma).trim());
        offset = comma + 1;
      }
      start = timestamp(cells[fields.indexOf('start')]!);
      end = timestamp(cells[fields.indexOf('end')]!);
      sourceText = line.slice(offset);
      textOffset = offset;
    } else {
      if (/^(NOTE(?:\s|$)|STYLE$|REGION$)/.test(line)) {
        while (i + 1 < lines.length && lines[i + 1] !== '') i++;
        continue;
      }
      if (!line.includes('-->')) continue;
      const parts = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(line.trim());
      if (!parts) throw new Error('Malformed WebVTT cue.');
      start = timestamp(parts[1]!);
      end = timestamp(parts[2]!);
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && lines[j] !== ''; j++) body.push(lines[j]!);
      sourceText = body.join('\n');
      if (!sourceText) continue;
      i = j - 1;
    }
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > 86400
    )
      throw new Error('Invalid caption interval.');
    const parsed = visible(sourceText, format);
    if (parsed.text.length > 8000)
      throw new Error('A caption cue exceeds the supported text limit.');
    // source and position form part of the identity, so edited/duplicate cues cannot share exceptions.
    const cueLine = format === 'ass' ? i : i - sourceText.split('\n').length + 1;
    cues.push({
      key: await digest(JSON.stringify([cueLine, start, end, sourceText])),
      start,
      end,
      text: parsed.text,
      map: parsed.map,
      line: cueLine,
      sourceText,
      textOffset,
    });
    if (cues.length > LIMITS.cues) throw new Error('Caption track exceeds 12,000 cues.');
  }
  if (!cues.length) throw new Error('No timed dialogue cues were found.');
  return { original, lines, format, cues };
}
export function redactCueSource(cue: Cue, matches: readonly Match[]): string {
  const remove = new Set<number>();
  const inserts = new Map<number, string>();
  for (const match of matches) {
    const first = cue.map[match.start];
    if (!first) continue;
    inserts.set(first[0], '****');
    for (let i = match.start; i < match.end; i++) {
      if (cue.text[i] === '\n') continue;
      const range = cue.map[i];
      if (range) for (let s = range[0]; s < range[1]; s++) remove.add(s);
    }
  }
  let result = '';
  for (let i = 0; i < cue.sourceText.length; i++) {
    result += inserts.get(i) ?? '';
    if (!remove.has(i)) result += cue.sourceText[i]!;
  }
  return result;
}
export function renderDocument(
  document: CaptionDocument,
  matches: ReadonlyMap<string, readonly Match[]>,
): string {
  if (document.format !== 'ass') return document.original;
  const lines = [...document.lines];
  for (const cue of document.cues)
    lines[cue.line] =
      lines[cue.line]!.slice(0, cue.textOffset) + redactCueSource(cue, matches.get(cue.key) ?? []);
  return lines.join('\n');
}
