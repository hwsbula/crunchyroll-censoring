import { record, parseTimingOffset } from './core/settings.ts';
import { SettingsRepository } from './shared/repository.ts';
import type { Store } from './shared/repository.ts';
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
import { SettingsSync, SYNC_PREFIX } from './shared/settings-sync.ts';
import { readSettingsBackup, settingsBackup } from './core/backup.ts';
import { retryableInitialization } from './shared/recovery.ts';

const local = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
} satisfies Store;
const repository = new SettingsRepository(local);
const preferences = new SettingsSync(
  repository,
  local,
  {
    read: () => chrome.storage.sync.get(null),
    set: (items) => chrome.storage.sync.set(items),
    remove: (keys) => chrome.storage.sync.remove(keys),
  },
  broadcast,
);
const ready = retryableInitialization(async () => {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
  await preferences.start();
});
void ready().catch(() => undefined);
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
async function frameCommand(
  target: Target,
  action: string,
  id?: string,
  offset?: number,
): Promise<void> {
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
          ...(offset === undefined ? {} : { offset }),
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
      return preferences.save(raw.settings, raw.revision);
    }
    case 'settings:export':
      return settingsBackup((await repository.read()).settings);
    case 'settings:import':
      if (typeof raw.backup !== 'string') throw new Error('Choose a settings backup first.');
      return preferences.save(readSettingsBackup(raw.backup), raw.revision);
    case 'sync:status':
      return preferences.getStatus();
    case 'sync:retry':
      await preferences.refresh();
      return preferences.getStatus();
    case 'sync:toggle':
      if (typeof raw.enabled !== 'boolean') throw new Error('Invalid sync preference.');
      await preferences.toggle(raw.enabled);
      return preferences.getStatus();
    case 'sync:resolve':
      if (!['local', 'remote'].includes(String(raw.choice)))
        throw new Error('Choose a valid sync profile.');
      await preferences.resolve(raw.choice as 'local' | 'remote');
      return preferences.getStatus();
    case 'sync:clear':
      if (raw.confirm !== true) throw new Error('Confirm removal of synced settings first.');
      await preferences.clear();
      return preferences.getStatus();
    case 'preferences:patch': {
      const patch = record(raw.patch);
      if (
        !Object.keys(patch).length ||
        Object.keys(patch).some((key) => !['enabled', 'mode', 'reveal'].includes(key))
      )
        throw new Error('Invalid preference.');
      return preferences.patch(patch as Partial<Pick<Settings, 'enabled' | 'mode' | 'reveal'>>);
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
      if (raw.action === 'timing') {
        const offset = parseTimingOffset(raw.offset);
        if (typeof raw.id !== 'string' || raw.id !== current.snapshot.audioTiming?.track)
          throw new Error('The English CC track changed. Refresh the popup.');
        await frameCommand(target, 'timing', raw.id, offset);
        return null;
      }
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
      await ready();
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
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some((key) => key.startsWith(SYNC_PREFIX)))
    void ready()
      .then(() => preferences.refresh())
      .catch(() => undefined);
});
