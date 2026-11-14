import {
  parseSettings,
  parseState,
  STORAGE_KEY,
  LIMITS,
  validOccurrenceId,
} from '../core/settings.ts';
import type { SavedState, Settings } from '../core/types.ts';
export interface Store {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
export class SettingsRepository {
  private store: Store;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(store: Store) {
    this.store = store;
  }
  async read(): Promise<SavedState> {
    await this.tail;
    return parseState((await this.store.get(STORAGE_KEY))[STORAGE_KEY]);
  }
  private mutate(change: (state: SavedState) => void): Promise<SavedState> {
    const operation = this.tail.then(async () => {
      const state = parseState((await this.store.get(STORAGE_KEY))[STORAGE_KEY]);
      change(state);
      state.revision++;
      await this.store.set({ [STORAGE_KEY]: state });
      return state;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  save(settings: unknown, revision: unknown): Promise<SavedState> {
    const parsed = parseSettings(settings);
    return this.mutate((state) => {
      if (state.revision !== revision)
        throw new Error(
          'Preferences changed in another window. Reload these settings before saving. Your draft is unchanged.',
        );
      state.settings = parsed;
    });
  }
  // A complete validated remote profile replaces preferences only, never local exceptions.
  apply(settings: unknown): Promise<SavedState> {
    const parsed = parseSettings(settings);
    return this.mutate((state) => {
      state.settings = parsed;
    });
  }
  patch(patch: Partial<Pick<Settings, 'enabled' | 'mode' | 'reveal'>>): Promise<SavedState> {
    return this.mutate((state) => {
      state.settings = parseSettings({ ...state.settings, ...patch });
    });
  }
  ignore(id: unknown, ignored: unknown): Promise<SavedState> {
    if (!validOccurrenceId(id) || typeof ignored !== 'boolean')
      throw new Error('Invalid occurrence exception.');
    return this.mutate((state) => {
      state.exceptions = state.exceptions.filter((value) => value !== id);
      if (ignored) {
        if (state.exceptions.length >= LIMITS.exceptions)
          throw new Error(
            'Saved exception limit reached (1,000). Clear exceptions in settings first.',
          );
        state.exceptions.push(id);
      }
    });
  }
  clear(): Promise<SavedState> {
    return this.mutate((state) => {
      state.exceptions = [];
    });
  }
}
