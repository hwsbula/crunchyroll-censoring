import {
  AppError,
  LIMITS,
  object,
  canonicalUrl,
  parseBackup,
  parseNoteInput,
  revision,
} from './model.ts';
import type {
  Backup,
  ErrorCode,
  ImportSummary,
  Note,
  NoteInput,
  PageSelection,
  State,
} from './model.ts';

export type Request =
  | { type: 'state:get' }
  | { type: 'note:get'; url: string }
  | { type: 'note:save'; note: NoteInput; expectedRevision: string | null }
  | { type: 'note:delete'; url: string; expectedRevision: string }
  | { type: 'notes:clear'; expectedRevision: string }
  | { type: 'notes:import'; backup: Backup }
  | { type: 'selection:capture'; tabId: number; url: string };

export interface ResultMap {
  'state:get': State;
  'note:get': Note | null;
  'note:save': Note;
  'note:delete': null;
  'notes:clear': null;
  'notes:import': ImportSummary;
  'selection:capture': PageSelection;
}
export type Response<T> =
  { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };

export function parseRequest(value: unknown): Request {
  const raw = object(value);
  switch (raw.type) {
    case 'state:get':
      return { type: raw.type };
    case 'note:get':
      return { type: raw.type, url: canonicalUrl(raw.url) };
    case 'note:save':
      return {
        type: raw.type,
        note: parseNoteInput(raw.note),
        expectedRevision: raw.expectedRevision === null ? null : revision(raw.expectedRevision),
      };
    case 'note:delete':
      return {
        type: raw.type,
        url: canonicalUrl(raw.url),
        expectedRevision: revision(raw.expectedRevision),
      };
    case 'notes:clear':
      return { type: raw.type, expectedRevision: revision(raw.expectedRevision) };
    case 'notes:import': {
      if (new TextEncoder().encode(JSON.stringify(raw.backup)).byteLength > LIMITS.importBytes) {
        throw new AppError('INVALID_INPUT', 'The backup is larger than 5 MB.');
      }
      return { type: raw.type, backup: parseBackup(raw.backup) };
    }
    case 'selection:capture': {
      if (!Number.isSafeInteger(raw.tabId) || (raw.tabId as number) < 0)
        throw new AppError('INVALID_INPUT', 'The selected tab is invalid.');
      return { type: raw.type, tabId: raw.tabId as number, url: canonicalUrl(raw.url) };
    }
    default:
      throw new AppError('INVALID_INPUT', 'This request is not supported.');
  }
}

// Extension IDs alone are insufficient: content scripts share our ID.
export function isTrustedSender(
  sender: { id?: string; url?: string },
  extensionId: string,
): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === 'chrome-extension:' &&
      url.hostname === extensionId &&
      ['/popup.html', '/options.html'].includes(url.pathname)
    );
  } catch {
    return false;
  }
}

export async function send<R extends Request>(request: R): Promise<ResultMap[R['type']]> {
  let response: Response<ResultMap[R['type']]> | undefined;
  try {
    response = (await chrome.runtime.sendMessage(request)) as
      Response<ResultMap[R['type']]> | undefined;
  } catch {
    throw new AppError(
      'INTERNAL_ERROR',
      'The extension could not connect. Reload the extension and reopen this page.',
    );
  }
  if (!response || typeof response.ok !== 'boolean')
    throw new AppError('INTERNAL_ERROR', 'The extension did not respond. Reopen it and try again.');
  if (!response.ok) throw new AppError(response.error.code, response.error.message);
  return response.data;
}
