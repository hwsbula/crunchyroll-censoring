import { canonicalTerm } from './settings.ts';
import type { Match } from './types.ts';

function normalized(text: string): { text: string; positions: Array<[number, number]> } {
  let result = '';
  const positions: Array<[number, number]> = [];
  // Keep source UTF-16 offsets even when a character expands under normalization.
  for (let i = 0; i < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(i)!);
    const part = /\s/u.test(character) ? ' ' : canonicalTerm(character);
    if (part === ' ' && result.endsWith(' '))
      positions[positions.length - 1]![1] = i + character.length;
    else
      for (const unit of part) {
        result += unit;
        for (let n = 0; n < unit.length; n++) positions.push([i, i + character.length]);
      }
    i += character.length;
  }
  return { text: result, positions };
}
function word(character: string | undefined): boolean {
  return !!character && /[\p{L}\p{N}_]/u.test(character);
}
export function findMatches(text: string, terms: readonly string[]): Match[] {
  const normalizedText = normalized(text);
  const matches: Match[] = [];
  for (const term of [...new Set(terms.map(canonicalTerm))].filter(Boolean)) {
    let from = 0;
    while (from < normalizedText.text.length) {
      const start = normalizedText.text.indexOf(term, from);
      if (start === -1) break;
      const end = start + term.length;
      const before = Array.from(normalizedText.text.slice(0, start)).at(-1);
      const after = Array.from(normalizedText.text.slice(end))[0];
      if ((!word(term[0]) || !word(before)) && (!word(term.at(-1)) || !word(after))) {
        matches.push({
          start: normalizedText.positions[start]![0],
          end: normalizedText.positions[end - 1]![1],
          term,
        });
      }
      from = start + 1;
    }
  }
  // Long phrases own overlapping words; repeated non-overlapping matches remain separate.
  const chosen: Match[] = [];
  for (const match of matches.sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) || a.start - b.start || a.term.localeCompare(b.term),
  )) {
    if (!chosen.some((other) => match.start < other.end && other.start < match.end))
      chosen.push(match);
  }
  return chosen.sort((a, b) => a.start - b.start);
}
export function redact(text: string, matches: readonly Match[]): string {
  let result = text;
  for (const match of [...matches].sort((a, b) => b.start - a.start))
    result = result.slice(0, match.start) + '****' + result.slice(match.end);
  return result;
}
