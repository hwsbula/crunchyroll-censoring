import { digest, parseSettings, record, STORAGE_KEY } from '../core/settings.ts';
import type { SavedState, Settings } from '../core/types.ts';
import type { Store, SettingsRepository } from './repository.ts';

export const SYNC_PREFIX = 'crunchyroll.preferences.v1.';
export const SYNC_HEAD = `${SYNC_PREFIX}head`;
export const SYNC_META = 'crunchyroll.sync-local.v1';
export const SYNC_BUDGET = 44_000; // Reserve room for old and new generations below Chrome's 100 KB.
const MAX_CHUNKS = 64;
export interface SyncStore {
  read(): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}
export interface SyncStatus {
  enabled: boolean;
  phase: 'ready' | 'local' | 'pending' | 'conflict' | 'error';
  message: string;
}
interface Meta {
  version: 1;
  enabled: boolean;
  lastHash: string | null;
  pending: boolean;
  conflict: boolean;
}
interface Head {
  version: 1;
  hash: string;
  count: number;
}
export interface Bundle {
  head: Head;
  items: Record<string, unknown>;
  settings: Settings;
}
function size(items: Record<string, unknown>): number {
  return Object.entries(items).reduce(
    (n, [key, value]) =>
      n + key.length + new TextEncoder().encode(JSON.stringify(value)).byteLength,
    0,
  );
}
export async function syncBundle(value: unknown): Promise<Bundle> {
  const settings = parseSettings(value);
  const text = JSON.stringify(settings);
  const hash = await digest(text);
  const items: Record<string, unknown> = {};
  // 1,000 UTF-16 units remain below 8 KB/item even with JSON escaping or non-ASCII terms.
  for (let start = 0, n = 0; start < text.length; start += 1000, n++)
    items[`${SYNC_PREFIX}${hash}.${n}`] = text.slice(start, start + 1000);
  const head: Head = { version: 1, hash, count: Object.keys(items).length };
  if (head.count > MAX_CHUNKS || size(items) + size({ [SYNC_HEAD]: head }) > SYNC_BUDGET)
    throw new Error(
      'Preferences exceed the safe Chrome Sync size limit. They are saved locally; reduce custom terms or use a settings backup.',
    );
  return { head, items, settings };
}
export async function readSyncBundle(data: Record<string, unknown>): Promise<Bundle | null> {
  if (data[SYNC_HEAD] === undefined) return null;
  const head = record(data[SYNC_HEAD]);
  if (
    head.version !== 1 ||
    typeof head.hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(head.hash) ||
    !Number.isInteger(head.count) ||
    Number(head.count) < 1 ||
    Number(head.count) > MAX_CHUNKS
  )
    throw new Error(
      'Unsupported synced profile. Local settings are preserved. Update all installations or restore a backup.',
    );
  const parts: string[] = [];
  for (let n = 0; n < Number(head.count); n++) {
    const chunk = data[`${SYNC_PREFIX}${head.hash}.${n}`];
    if (chunk === undefined)
      throw new Error(
        'Waiting for the complete synced profile. Local settings remain active; retry after Chrome finishes syncing.',
      );
    if (typeof chunk !== 'string' || chunk.length > 1000)
      throw new Error('Invalid synced profile chunk. Local settings are preserved.');
    parts.push(chunk);
  }
  const text = parts.join('');
  if ((await digest(text)) !== head.hash)
    throw new Error('Synced profile failed its integrity check. Local settings are preserved.');
  const bundle = await syncBundle(JSON.parse(text));
  if (bundle.head.hash !== head.hash)
    throw new Error(
      'Synced profile is not canonical or uses unsupported terms. Local settings are preserved.',
    );
  return bundle;
}

// Serialized preference edits and remote application. The local repository remains the
// durable playback source. No cues, exceptions, account identity or frame data enter Sync.
export class SettingsSync {
  private repository: SettingsRepository;
  private local: Store;
  private remote: SyncStore;
  private changed: (state: SavedState) => Promise<void>;
  private blocked = false;
  private meta: Meta = {
    version: 1,
    enabled: true,
    lastHash: null,
    pending: false,
    conflict: false,
  };
  private tail: Promise<unknown> = Promise.resolve();
  private status: SyncStatus = {
    enabled: true,
    phase: 'pending',
    message: 'Checking Chrome settings sync…',
  };
  constructor(
    repository: SettingsRepository,
    local: Store,
    remote: SyncStore,
    changed: (state: SavedState) => Promise<void>,
  ) {
    this.repository = repository;
    this.local = local;
    this.remote = remote;
    this.changed = changed;
  }
  private queue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async remember(): Promise<void> {
    await this.local.set({ [SYNC_META]: this.meta });
  }
  private report(phase: SyncStatus['phase'], message: string): void {
    this.status = { enabled: this.meta.enabled, phase, message };
  }
  private fail(error: unknown): void {
    this.report(
      'error',
      error instanceof Error
        ? error.message
        : 'Chrome Sync is unavailable. Settings are saved locally; retry later.',
    );
  }
  async getStatus(): Promise<SyncStatus> {
    await this.tail;
    return { ...this.status };
  }
  start(): Promise<void> {
    return this.queue(async () => {
      try {
        const raw = (await this.local.get(SYNC_META))[SYNC_META];
        if (raw !== undefined) {
          this.blocked = true;
          const m = record(raw);
          if (
            m.version !== 1 ||
            typeof m.enabled !== 'boolean' ||
            typeof m.pending !== 'boolean' ||
            typeof m.conflict !== 'boolean' ||
            !(
              m.lastHash === null ||
              (typeof m.lastHash === 'string' && /^[a-f0-9]{64}$/.test(m.lastHash))
            )
          ) {
            this.blocked = true;
            throw new Error(
              'Saved sync metadata is unsupported. Existing data has been preserved.',
            );
          }
          this.meta = {
            version: 1,
            enabled: m.enabled,
            pending: m.pending,
            conflict: m.conflict,
            lastHash: m.lastHash as string | null,
          };
          this.blocked = false;
        }
        const hadLocal = (await this.local.get(STORAGE_KEY))[STORAGE_KEY] !== undefined;
        // A first-time install waits for Chrome's existing profile instead of uploading defaults.
        if (raw === undefined && hadLocal) this.meta.pending = true;
        await this.reconcile();
      } catch (error) {
        this.fail(error);
      }
    });
  }
  private async publish(bundle: Bundle, data: Record<string, unknown>): Promise<void> {
    this.meta.pending = true;
    await this.remember();
    const current = await readSyncBundle(data);
    // Keep the currently committed snapshot until the new head is published. Only
    // obsolete keys in our own namespace are pruned; partial new snapshots never apply.
    const keep = new Set([
      SYNC_HEAD,
      ...Object.keys(bundle.items),
      ...Object.keys(current?.items ?? {}),
    ]);
    const garbage = Object.keys(data).filter(
      (key) => key.startsWith(SYNC_PREFIX) && !keep.has(key),
    );
    if (garbage.length) await this.remote.remove(garbage);
    await this.remote.set(bundle.items);
    await this.remote.set({ [SYNC_HEAD]: bundle.head });
    this.meta.lastHash = bundle.head.hash;
    this.meta.pending = false;
    this.meta.conflict = false;
    await this.remember();
    this.report(
      'ready',
      'Saved to Chrome Sync storage. Delivery to other devices is managed by Chrome.',
    );
  }
  private async accept(bundle: Bundle): Promise<void> {
    const state = await this.repository.apply(bundle.settings);
    this.meta.lastHash = bundle.head.hash;
    this.meta.pending = false;
    this.meta.conflict = false;
    await this.remember();
    await this.changed(state);
    this.report('ready', 'Synced preferences applied. Local occurrence exceptions were retained.');
  }
  private async reconcile(): Promise<void> {
    if (this.blocked)
      throw new Error(
        'Unsupported sync metadata has been preserved. Export your settings before removing synced settings to reset sync.',
      );
    if (!this.meta.enabled) {
      this.report('local', 'Sync is off on this device. Preferences are saved locally.');
      return;
    }
    const data = await this.remote.read();
    const incoming = await readSyncBundle(data);
    const state = await this.repository.read();
    const local = await syncBundle(state.settings);
    const dirty =
      this.meta.pending || (this.meta.lastHash !== null && local.head.hash !== this.meta.lastHash);
    if (incoming?.head.hash === local.head.hash) {
      this.meta.lastHash = local.head.hash;
      this.meta.pending = false;
      this.meta.conflict = false;
      await this.remember();
      this.report(
        'ready',
        'Preferences match Chrome Sync storage. Chrome controls cross-device delivery.',
      );
    } else if (
      incoming &&
      (this.meta.conflict || (dirty && incoming.head.hash !== this.meta.lastHash))
    ) {
      this.meta.conflict = true;
      await this.remember();
      this.report(
        'conflict',
        'This device and Chrome Sync have different preferences. Export a backup, then choose which profile to use. Nothing has been overwritten.',
      );
    } else if (dirty) {
      await this.publish(local, data);
    } else if (incoming && incoming.head.hash !== this.meta.lastHash) {
      await this.accept(incoming);
    } else {
      await this.remember();
      this.report(
        'ready',
        incoming
          ? 'Preferences match Chrome Sync storage. Chrome controls cross-device delivery.'
          : 'No synced profile received yet. Save preferences or upload this device to create one.',
      );
    }
  }
  refresh(): Promise<void> {
    return this.queue(async () => {
      try {
        await this.reconcile();
      } catch (error) {
        this.fail(error);
      }
    });
  }
  private edit(operation: () => Promise<SavedState>): Promise<SavedState> {
    return this.queue(async () => {
      const state = await operation(); // local durability first; sync failure must not lose the edit
      await this.changed(state);
      this.meta.pending = true;
      try {
        if (this.blocked)
          throw new Error(
            'Preferences saved locally. Unsupported sync metadata is preserved; export a backup before resetting sync.',
          );
        await this.remember();
        await this.reconcile();
      } catch (error) {
        this.fail(error);
      }
      return state;
    });
  }
  save(settings: unknown, revision: unknown): Promise<SavedState> {
    return this.edit(() => this.repository.save(settings, revision));
  }
  patch(patch: Partial<Pick<Settings, 'enabled' | 'mode' | 'reveal'>>): Promise<SavedState> {
    return this.edit(() => this.repository.patch(patch));
  }
  toggle(enabled: boolean): Promise<void> {
    return this.queue(async () => {
      if (this.blocked)
        throw new Error(
          'Unsupported sync metadata has been preserved. Export a backup before resetting sync.',
        );
      this.meta.enabled = enabled;
      await this.remember();
      try {
        await this.reconcile();
      } catch (error) {
        this.fail(error);
      }
    });
  }
  resolve(choice: 'local' | 'remote'): Promise<void> {
    return this.queue(async () => {
      if (this.blocked)
        throw new Error(
          'Unsupported sync metadata has been preserved. Export a backup before resetting sync.',
        );
      if (!this.meta.enabled) throw new Error('Enable Chrome settings sync first.');
      try {
        const data = await this.remote.read();
        if (choice === 'remote') {
          const bundle = await readSyncBundle(data);
          if (!bundle) throw new Error('No complete synced profile is available.');
          await this.accept(bundle);
        } else {
          await this.publish(await syncBundle((await this.repository.read()).settings), data);
        }
      } catch (error) {
        this.fail(error);
      }
    });
  }
  clear(): Promise<void> {
    return this.queue(async () => {
      // Disable locally before deletion so our own change event cannot recreate the profile.
      this.meta.enabled = false;
      this.meta.lastHash = null;
      this.meta.pending = false;
      this.meta.conflict = false;
      this.blocked = false;
      await this.remember();
      const data = await this.remote.read();
      const keys = Object.keys(data).filter((key) => key.startsWith(SYNC_PREFIX));
      if (keys.length) await this.remote.remove(keys);
      this.report(
        'local',
        'Synced preferences removed and sync disabled here. Other enabled devices can upload again after an edit. Local preferences remain.',
      );
    });
  }
}
