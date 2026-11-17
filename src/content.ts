import { record, parseState } from './core/settings.ts';
import { parseSnapshot } from './shared/protocol.ts';
import { siteUrl } from './integration/metadata.ts';
import { ConnectionRecovery } from './shared/recovery.ts';

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
const connection = new ConnectionRecovery(
  async () => {
    const response = record(
      (await chrome.runtime.sendMessage({ type: 'player:register' })) as unknown,
    );
    if (response.ok !== true) throw new Error('Could not register this player frame.');
    return parseState(response.data);
  },
  (next) => {
    // A newer broadcast can arrive while registration is waiting for storage.
    if (!state || next.revision >= state.revision) state = next;
    post('init', state);
  },
);
function command(payload: unknown): Promise<unknown> {
  const requestId = crypto.randomUUID();
  // A rescan may include a five-second caption request plus parsing/analysis.
  const timeoutMs = record(payload).action === 'retry' ? 10000 : 5000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('The player did not respond. Reload the episode and retry.'));
    }, timeoutMs);
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
      // Unauthenticated page messages cannot trigger privileged work. The
      // registration's own retry budget handles missing initial settings.
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
      const next = parseState(message.state);
      if (!state || next.revision >= state.revision) state = next;
      post('init', state);
      respond({ ok: true });
    } catch {
      respond({ ok: false });
    }
    return false;
  }
  if (message.type === 'frame:probe') {
    if (!snapshot) {
      if (state) post('init', state);
      else connection.start();
    }
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
window.addEventListener('pagehide', () => {
  connection.stop();
  snapshot = null;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error('The player page was suspended.'));
  }
  pending.clear();
});
window.addEventListener('pageshow', (event: PageTransitionEvent) => {
  if (event.persisted) connection.start();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !state) connection.start();
});
connection.start();
