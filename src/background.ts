import { record } from './core/settings.ts';
import { SettingsRepository } from './shared/repository.ts';
import {
  integer,
  parseSnapshot,
  parseTarget,
  trustedContent,
  trustedUi,
} from './shared/protocol.ts';
import type { RoutedPlayer, Target } from './shared/protocol.ts';
import type { SavedState, Settings } from './core/types.ts';
import { episodeId, SITE_ORIGIN } from './integration/metadata.ts';

const repository = new SettingsRepository({
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
});
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).then(
  () => true,
  () => false,
);
const registryKey = 'quietroll.frames.v1';
interface Frame {
  tabId: number;
  frameId: number;
  documentId: string;
}
let registryTail: Promise<unknown> = Promise.resolve();
function registryMutation(change: (frames: Frame[]) => Frame[]): Promise<void> {
  const operation = registryTail.then(async () => {
    const data = await chrome.storage.session.get(registryKey);
    const frames = Array.isArray(data[registryKey]) ? (data[registryKey] as Frame[]) : [];
    await chrome.storage.session.set({ [registryKey]: change(frames).slice(-160) });
  });
  registryTail = operation.catch(() => undefined);
  return operation;
}
async function requireTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || !tab.url || new URL(tab.url).origin !== SITE_ORIGIN || !episodeId(tab.url))
    throw new Error('Open the popup on the active Crunchyroll episode tab.');
}
async function players(tabId: number): Promise<RoutedPlayer[]> {
  await requireTab(tabId);
  await registryTail;
  const data = await chrome.storage.session.get(registryKey);
  const frames = (Array.isArray(data[registryKey]) ? (data[registryKey] as Frame[]) : []).filter(
    (frame) => frame.tabId === tabId,
  );
  const valid: RoutedPlayer[] = [];
  await Promise.all(
    frames.map(async (frame) => {
      try {
        const response = record(
          (await chrome.tabs.sendMessage(
            tabId,
            { type: 'frame:probe' },
            { documentId: frame.documentId },
          )) as unknown,
        );
        if (response.ok !== true) return;
        const snapshot = parseSnapshot(response.data);
        valid.push({
          target: {
            ...frame,
            instance: snapshot.instance,
            episode: snapshot.episode,
            version: snapshot.version,
          },
          snapshot,
        });
      } catch {
        /* stale or inaccessible document, never fall back to a different frame */
      }
    }),
  );
  return valid;
}
async function targetPlayer(target: Target): Promise<RoutedPlayer> {
  const all = await players(target.tabId);
  const current = all.find(
    (value) =>
      value.target.documentId === target.documentId &&
      value.target.frameId === target.frameId &&
      value.target.instance === target.instance &&
      value.target.episode === target.episode &&
      value.target.version === target.version,
  );
  if (!current) throw new Error('The episode or player changed. Refresh the popup.');
  return current;
}
async function frameCommand(target: Target, action: string, id?: string): Promise<void> {
  const response = record(
    (await chrome.tabs.sendMessage(
      target.tabId,
      {
        type: 'frame:command',
        command: {
          instance: target.instance,
          episode: target.episode,
          version: target.version,
          action,
          ...(id ? { id } : {}),
        },
      },
      { documentId: target.documentId },
    )) as unknown,
  );
  if (response.ok !== true)
    throw new Error('The player changed or did not respond. Refresh and retry.');
}
async function broadcast(state: SavedState): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: [
      'https://www.crunchyroll.com/*',
      'https://static.crunchyroll.com/vilos-v2/web/vilos/player.html*',
    ],
  });
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) =>
        chrome.tabs.sendMessage(tab.id!, { type: 'frame:state', state }).catch(() => undefined),
      ),
  );
}
async function handleUi(raw: Record<string, unknown>): Promise<unknown> {
  switch (raw.type) {
    case 'settings:get':
      return repository.read();
    case 'settings:save': {
      const state = await repository.save(raw.settings, raw.revision);
      await broadcast(state);
      return state;
    }
    case 'preferences:patch': {
      const patch = record(raw.patch);
      if (
        !Object.keys(patch).length ||
        Object.keys(patch).some((key) => !['enabled', 'mode', 'reveal'].includes(key))
      )
        throw new Error('Invalid preference.');
      const state = await repository.patch(
        patch as Partial<Pick<Settings, 'enabled' | 'mode' | 'reveal'>>,
      );
      await broadcast(state);
      return state;
    }
    case 'exceptions:clear': {
      const state = await repository.clear();
      await broadcast(state);
      return state;
    }
    case 'player:get': {
      const tabId = integer(raw.tabId);
      const all = await players(tabId);
      const withMedia = all.filter((value) => value.snapshot.hasMedia);
      if (withMedia.length !== 1)
        throw new Error(
          withMedia.length
            ? 'Multiple player frames found. Filtering is unavailable until one episode player is active.'
            : 'No accessible player yet. Start the episode, then retry. Reload the page after installing the extension.',
        );
      return withMedia[0];
    }
    case 'player:action': {
      const target = parseTarget(raw.target);
      const current = await targetPlayer(target);
      if (raw.action === 'retry') {
        await frameCommand(target, 'retry');
        return null;
      }
      if (
        typeof raw.id !== 'string' ||
        !current.snapshot.occurrences.some((value) => value.id === raw.id)
      )
        throw new Error('This occurrence is no longer part of this episode.');
      if (raw.action === 'seek') {
        await frameCommand(target, 'seek', raw.id);
        return null;
      }
      if (raw.action === 'ignore' && typeof raw.ignored === 'boolean') {
        await frameCommand(target, 'validate', raw.id);
        // Verify identity again after the asynchronous frame handshake.
        await targetPlayer(target);
        const state = await repository.ignore(raw.id, raw.ignored);
        await broadcast(state);
        return state;
      }
      throw new Error('Invalid player action.');
    }
    default:
      throw new Error('Unsupported request.');
  }
}
// Synchronous listener registration; no precision scheduling or cue data in the worker.
chrome.runtime.onMessage.addListener((value: unknown, sender, respond) => {
  void Promise.resolve()
    .then(async () => {
      if (!(await ready))
        throw new Error('Local storage could not be initialized. Reload the extension.');
      const raw = record(value);
      if (trustedContent(sender, chrome.runtime.id)) {
        if (raw.type !== 'player:register')
          throw new Error('Content scripts cannot change preferences or route player actions.');
        const frame = {
          tabId: sender.tab!.id!,
          frameId: sender.frameId!,
          documentId: sender.documentId!,
        };
        await registryMutation((frames) => [
          ...frames.filter(
            (item) => !(item.tabId === frame.tabId && item.frameId === frame.frameId),
          ),
          frame,
        ]);
        return repository.read();
      }
      if (!trustedUi(sender, chrome.runtime.id)) throw new Error('This sender is not allowed.');
      return handleUi(raw);
    })
    .then(
      (data) => respond({ ok: true, data }),
      (error: unknown) =>
        respond({
          ok: false,
          error: error instanceof Error ? error.message : 'The operation failed. Retry.',
        }),
    );
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void registryMutation((frames) => frames.filter((frame) => frame.tabId !== tabId));
});
