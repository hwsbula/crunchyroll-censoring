export const LIMITS = Object.freeze({
  notes: 200,
  url: 2048,
  title: 240,
  text: 5000,
  quote: 2000,
  importBytes: 5_000_000,
});
export const STORAGE_KEY = 'pageNotesState';

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_PAGE'
  | 'CONFLICT'
  | 'LIMIT_REACHED'
  | 'STORAGE_ERROR'
  | 'CORRUPT_DATA'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export interface NoteInput {
  url: string;
  title: string;
  text: string;
  quote: string;
}
export interface Note extends NoteInput {
  createdAt: number;
  updatedAt: number;
  revision: string;
}
export interface State {
  schemaVersion: 1;
  revision: string;
  notes: Note[];
}
export interface Backup {
  format: 'page-notes';
  version: 1;
  exportedAt: string;
  notes: Note[];
}
export interface ImportSummary {
  added: number;
  updated: number;
  kept: number;
  total: number;
}
export interface PageSelection {
  url: string;
  title: string;
  selection: string;
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError('INVALID_INPUT', 'Expected an object.');
  }
  return value as Record<string, unknown>;
}

export function string(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new AppError(
      'INVALID_INPUT',
      `${label} must be text with no more than ${max.toLocaleString('en-US')} characters.`,
    );
  }
  return value;
}

export function canonicalUrl(value: unknown): string {
  const raw = string(value, LIMITS.url, 'Page address');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('UNSUPPORTED_PAGE', 'Open a regular HTTP or HTTPS webpage to take a note.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AppError(
      'UNSUPPORTED_PAGE',
      'Only HTTP and HTTPS pages without embedded credentials are supported.',
    );
  }
  if (
    url.hostname === 'chromewebstore.google.com' ||
    (url.hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/.test(url.pathname))
  ) {
    throw new AppError(
      'UNSUPPORTED_PAGE',
      'Chrome protects the Web Store. Open another webpage to take a note.',
    );
  }
  url.hash = '';
  if (url.href.length > LIMITS.url)
    throw new AppError('INVALID_INPUT', 'This page address is too long to save.');
  return url.href;
}

export function revision(value: unknown): string {
  const result = string(value, 80, 'Revision');
  if (!result) throw new AppError('INVALID_INPUT', 'A revision is required.');
  return result;
}

export function parseNoteInput(value: unknown): NoteInput {
  const raw = object(value);
  const url = canonicalUrl(raw.url);
  const title = string(raw.title, LIMITS.title, 'Title').trim() || new URL(url).hostname;
  const text = string(raw.text, LIMITS.text, 'Note').trim();
  const quote = string(raw.quote, LIMITS.quote, 'Selected text').trim();
  if (!text && !quote)
    throw new AppError('INVALID_INPUT', 'Write a note or capture selected text before saving.');
  return { url, title, text, quote };
}

function timestamp(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 8_640_000_000_000_000
  ) {
    throw new AppError('INVALID_INPUT', 'The saved date is invalid.');
  }
  return value;
}

export function parseNote(value: unknown): Note {
  const raw = object(value);
  const result = {
    ...parseNoteInput(raw),
    createdAt: timestamp(raw.createdAt),
    updatedAt: timestamp(raw.updatedAt),
    revision: revision(raw.revision),
  };
  if (result.updatedAt < result.createdAt)
    throw new AppError('INVALID_INPUT', 'A note has inconsistent dates.');
  return result;
}

export function parseState(value: unknown): State {
  const raw = object(value);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.notes) || raw.notes.length > LIMITS.notes) {
    throw new AppError(
      'CORRUPT_DATA',
      'Saved data uses an unsupported format. It has been left untouched.',
    );
  }
  const notes = raw.notes.map(parseNote);
  if (new Set(notes.map((note) => note.url)).size !== notes.length) {
    throw new AppError(
      'CORRUPT_DATA',
      'Saved data has duplicate page addresses. It has been left untouched.',
    );
  }
  return { schemaVersion: 1, revision: revision(raw.revision), notes };
}

export function parseBackup(value: unknown): Backup {
  const raw = object(value);
  if (
    raw.format !== 'page-notes' ||
    raw.version !== 1 ||
    !Array.isArray(raw.notes) ||
    raw.notes.length > LIMITS.notes
  ) {
    throw new AppError(
      'INVALID_INPUT',
      'Choose a Page Notes version 1 backup with at most 200 notes.',
    );
  }
  const exportedAt = string(raw.exportedAt, 50, 'Export date');
  if (!Number.isFinite(Date.parse(exportedAt)))
    throw new AppError('INVALID_INPUT', 'The backup date is invalid.');
  return { format: 'page-notes', version: 1, exportedAt, notes: raw.notes.map(parseNote) };
}

export function createBackup(notes: Note[]): Backup {
  return { format: 'page-notes', version: 1, exportedAt: new Date().toISOString(), notes };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
