import { readPageSelection } from './content.ts';
import { AppError, LIMITS, canonicalUrl, object, string } from './shared/model.ts';
import type { PageSelection } from './shared/model.ts';
import { isTrustedSender, parseRequest } from './shared/protocol.ts';
import type { Request, Response } from './shared/protocol.ts';
import { NoteRepository } from './shared/repository.ts';

const repository = new NoteRepository({
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
});

// Keep registration synchronous. Initialization is awaited within each handler.
// Readiness resolves even on failure so an idle worker never has an unhandled rejection.
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).then(
  () => true,
  () => false,
);

async function capture(tabId: number, expectedUrl: string): Promise<PageSelection> {
  try {
    const before = await chrome.tabs.get(tabId);
    if (!before.active || canonicalUrl(before.url) !== expectedUrl) {
      throw new AppError(
        'CONFLICT',
        'The page changed. Reopen the extension on the page you want to annotate.',
      );
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: 'ISOLATED',
      func: readPageSelection,
    });
    const raw = object(results[0]?.result);
    const url = canonicalUrl(raw.url);
    const after = await chrome.tabs.get(tabId);
    if (url !== expectedUrl || canonicalUrl(after.url) !== expectedUrl) {
      throw new AppError(
        'CONFLICT',
        'The page navigated during capture. Reopen the extension and try again.',
      );
    }
    return {
      url,
      title: string(raw.title, LIMITS.title, 'Title'),
      selection: string(raw.selection, LIMITS.quote, 'Selected text'),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'UNSUPPORTED_PAGE',
      'Chrome cannot capture text here. Reopen the extension on a regular webpage; browser pages, protected viewers, and frames may be unavailable.',
    );
  }
}

async function handle(request: Request): Promise<unknown> {
  if (!(await ready))
    throw new AppError(
      'STORAGE_ERROR',
      'Chrome could not initialize private storage. Reload the extension and try again.',
    );
  switch (request.type) {
    case 'state:get':
      return repository.getState();
    case 'note:get':
      return repository.getNote(request.url);
    case 'note:save':
      return repository.save(request.note, request.expectedRevision);
    case 'note:delete':
      return repository.delete(request.url, request.expectedRevision);
    case 'notes:clear':
      return repository.clear(request.expectedRevision);
    case 'notes:import':
      return repository.import(request.backup);
    case 'selection:capture':
      return capture(request.tabId, request.url);
  }
}

chrome.runtime.onMessage.addListener(
  (value: unknown, sender, sendResponse: (response: Response<unknown>) => void) => {
    if (!isTrustedSender(sender, chrome.runtime.id)) {
      sendResponse({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'This request is not allowed.' },
      });
      return false;
    }
    // A literal true keeps the channel open on all supported Chrome versions.
    void Promise.resolve()
      .then(() => handle(parseRequest(value)))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error:
              error instanceof AppError
                ? { code: error.code, message: error.message }
                : {
                    code: 'INTERNAL_ERROR',
                    message: 'The operation could not be completed. Please try again.',
                  },
          }),
      );
    return true;
  },
);
