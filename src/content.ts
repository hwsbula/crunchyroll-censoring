import { record, parseState } from './core/settings.ts';
import { parseSnapshot } from './shared/protocol.ts';
import { siteUrl } from './integration/metadata.ts';

const token = crypto.randomUUID();
const channel = 'quietroll-v1';
let snapshot: ReturnType<typeof parseSnapshot> | null = null;
let state: ReturnType<typeof parseState> | null = null;
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function post(kind: string, payload: unknown, requestId?: string): void {
  window.postMessage(
    { channel, token, kind, payload, ...(requestId ? { requestId } : {}) },
    location.origin,
  );
}
async function initialize(): Promise<void> {
  try {
    const response = record(
      (await chrome.runtime.sendMessage({ type: 'player:register' })) as unknown,
    );
    if (response.ok !== true) throw new Error('Could not register this player frame.');
    state = parseState(response.data);
    post('init', state);
  } catch {
    /* Popup reports no connection. Never enable a page without valid settings. */
  }
}
function command(payload: unknown): Promise<unknown> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('The player did not respond. Reload the episode and retry.'));
    }, 5000);
    pending.set(requestId, { resolve, reject, timer });
    post('command', payload, requestId);
  });
}
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin || !siteUrl(location.href))
    return;
  try {
    const message = record(event.data);
    if (message.channel !== channel) return;
    if (message.kind === 'hello') {
      if (state) post('init', state);
      return;
    }
    if (message.token !== token) return;
    if (message.kind === 'snapshot') {
      snapshot = parseSnapshot(message.payload);
      return;
    }
    if (message.kind === 'response' && typeof message.requestId === 'string') {
      const request = pending.get(message.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.requestId);
      const response = record(message.payload);
      if (response.ok === true) request.resolve(response);
      else
        request.reject(
          new Error('The player changed or rejected this command. Refresh the popup.'),
        );
    }
  } catch {
    /* Reject malformed page data. Page messages never reach privileged operations. */
  }
});
chrome.runtime.onMessage.addListener((value: unknown, sender, respond) => {
  // Only our worker can route UI operations. Page events have no chrome access.
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    (sender.url && !sender.url.startsWith(chrome.runtime.getURL('background.js')))
  )
    return false;
  let message: Record<string, unknown>;
  try {
    message = record(value);
  } catch {
    return false;
  }
  if (message.type === 'frame:state') {
    try {
      state = parseState(message.state);
      post('settings', state);
      respond({ ok: true });
    } catch {
      respond({ ok: false });
    }
    return false;
  }
  if (message.type === 'frame:probe') {
    respond(snapshot ? { ok: true, data: snapshot } : { ok: false });
    return false;
  }
  if (message.type === 'frame:command') {
    const payload = record(message.command);
    if (
      !snapshot ||
      payload.instance !== snapshot.instance ||
      payload.episode !== snapshot.episode ||
      payload.version !== snapshot.version
    ) {
      respond({ ok: false, error: 'Player changed. Refresh the popup.' });
      return false;
    }
    void command(payload).then(
      () => respond({ ok: true }),
      () =>
        respond({ ok: false, error: 'The player did not accept this action. Refresh and retry.' }),
    );
    return true;
  }
  return false;
});
void initialize();
