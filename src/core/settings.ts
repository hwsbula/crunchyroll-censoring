import type { SavedState, Settings } from './types.ts';

// Literal, explicit variants: no hidden stemming or user-supplied regular expressions.
export const BUILTINS = [
  'ass',
  'asshole',
  'assholes',
  'bastard',
  'bastards',
  'bitch',
  'bitches',
  'bullshit',
  'crap',
  'damn',
  'damned',
  'dick',
  'dicks',
  'fuck',
  'fucked',
  'fucker',
  'fuckers',
  'fucking',
  'hell',
  'motherfucker',
  'motherfuckers',
  'piss',
  'pissed',
  'shit',
  'shits',
  'shitty',
  'son of a bitch',
] as const;
export const STORAGE_KEY = 'quietroll.v1';
export const LIMITS = {
  terms: 250,
  termLength: 100,
  exceptions: 1000,
  occurrences: 1000,
  cues: 12000,
  trackBytes: 3_000_000,
};
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'auto',
  reveal: false,
  beforeMs: 80,
  afterMs: 100,
  custom: [],
  disabledBuiltins: [],
};
export function canonicalTerm(term: string): string {
  return term.normalize('NFKC').replace(/[’‘]/g, "'").trim().replace(/\s+/gu, ' ').toLowerCase();
}
export function normalizeTerms(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > LIMITS.terms)
    throw new Error('Use at most 250 terms.');
  const terms = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') throw new Error('Every term must be text.');
    const term = canonicalTerm(value);
    if (!term || term.length > LIMITS.termLength || /[\p{Cc}]/u.test(term))
      throw new Error('Use nonempty terms of at most 100 characters.');
    terms.add(term);
  }
  return [...terms];
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid data.');
  return value as Record<string, unknown>;
}
export function parseSettings(value: unknown): Settings {
  const raw = record(value);
  if (
    typeof raw.enabled !== 'boolean' ||
    typeof raw.reveal !== 'boolean' ||
    !['auto', 'english', 'japanese'].includes(String(raw.mode))
  )
    throw new Error('Invalid preferences.');
  for (const field of ['beforeMs', 'afterMs']) {
    if (!Number.isInteger(raw[field]) || Number(raw[field]) < 0 || Number(raw[field]) > 300)
      throw new Error('Padding must be 0–300 milliseconds.');
  }
  const disabledBuiltins = normalizeTerms(raw.disabledBuiltins);
  if (disabledBuiltins.some((term) => !(BUILTINS as readonly string[]).includes(term)))
    throw new Error('Unknown built-in term.');
  return {
    enabled: raw.enabled,
    reveal: raw.reveal,
    mode: raw.mode as Settings['mode'],
    beforeMs: Number(raw.beforeMs),
    afterMs: Number(raw.afterMs),
    custom: normalizeTerms(raw.custom),
    disabledBuiltins,
  };
}
export function freshState(): SavedState {
  return { version: 1, revision: 0, settings: structuredClone(DEFAULT_SETTINGS), exceptions: [] };
}
export function parseState(value: unknown): SavedState {
  if (value === undefined) return freshState();
  const raw = record(value);
  if (raw.version !== 1 || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0)
    throw new Error('Saved data has an unsupported format. It has been preserved.');
  if (
    !Array.isArray(raw.exceptions) ||
    raw.exceptions.length > LIMITS.exceptions ||
    !raw.exceptions.every(validOccurrenceId)
  )
    throw new Error('Saved exceptions are invalid. They have been preserved.');
  return {
    version: 1,
    revision: Number(raw.revision),
    settings: parseSettings(raw.settings),
    exceptions: [...new Set(raw.exceptions as string[])],
  };
}
export function validOccurrenceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{64}\.[a-f0-9]{64}\.\d{1,6}\.\d{1,6}\.[a-f0-9]{64}$/.test(value)
  );
}
export function activeTerms(settings: Settings): string[] {
  return [
    ...new Set([
      ...BUILTINS.filter((term) => !settings.disabledBuiltins.includes(term)),
      ...settings.custom,
    ]),
  ];
}
export function english(language: string | null): boolean {
  return !!language && /^en(?:[-_][a-z0-9]+)*$/i.test(language);
}
export function japanese(language: string | null): boolean {
  return !!language && /^ja(?:[-_][a-z0-9]+)*$/i.test(language);
}
export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
