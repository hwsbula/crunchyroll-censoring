import {
  AppError,
  LIMITS,
  STORAGE_KEY,
  canonicalUrl,
  createBackup,
  parseBackup,
  parseNoteInput,
  parseState,
} from './model.ts';
import type { Backup, ImportSummary, Note, NoteInput, State } from './model.ts';

export interface StoragePort {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** The worker is the only writer. A queue protects read/modify/write operations. */
export class NoteRepository {
  #storage: StoragePort;
  #clock: () => number;
  #id: () => string;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(
    storage: StoragePort,
    clock: () => number = Date.now,
    id: () => string = () => crypto.randomUUID(),
  ) {
    this.#storage = storage;
    this.#clock = clock;
    this.#id = id;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async #read(): Promise<State> {
    let data: Record<string, unknown>;
    try {
      data = await this.#storage.get(STORAGE_KEY);
    } catch {
      throw new AppError('STORAGE_ERROR', 'Chrome could not read your notes. Please try again.');
    }
    if (data[STORAGE_KEY] === undefined) {
      const state: State = { schemaVersion: 1, revision: this.#id(), notes: [] };
      await this.#write(state);
      return state;
    }
    try {
      return parseState(data[STORAGE_KEY]);
    } catch {
      throw new AppError(
        'CORRUPT_DATA',
        'Saved data is invalid or from a newer version. It has been left untouched.',
      );
    }
  }

  async #write(state: State): Promise<void> {
    if (
      new TextEncoder().encode(JSON.stringify(createBackup(state.notes), null, 2)).byteLength >
      LIMITS.importBytes
    ) {
      throw new AppError(
        'LIMIT_REACHED',
        'These notes would exceed the 5 MB backup limit. Export and remove some notes first; nothing was changed.',
      );
    }
    try {
      await this.#storage.set({ [STORAGE_KEY]: state });
    } catch {
      throw new AppError(
        'STORAGE_ERROR',
        'Chrome could not save your changes. Storage may be full; export a backup before removing notes.',
      );
    }
  }

  getState(): Promise<State> {
    return this.#enqueue(() => this.#read());
  }

  getNote(url: string): Promise<Note | null> {
    return this.#enqueue(
      async () => (await this.#read()).notes.find((note) => note.url === canonicalUrl(url)) ?? null,
    );
  }

  save(input: NoteInput, expectedRevision: string | null): Promise<Note> {
    return this.#enqueue(async () => {
      const value = parseNoteInput(input);
      const state = await this.#read();
      const old = state.notes.find((note) => note.url === value.url);
      if ((old?.revision ?? null) !== expectedRevision)
        throw new AppError(
          'CONFLICT',
          'This note changed in another window. Copy your draft, then reopen the popup to load the latest note.',
        );
      if (!old && state.notes.length >= LIMITS.notes)
        throw new AppError(
          'LIMIT_REACHED',
          'You have reached 200 notes. Export a backup and remove a note to make room.',
        );
      const now = Math.max(this.#clock(), old?.updatedAt ?? 0);
      const note: Note = {
        ...value,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
        revision: this.#id(),
      };
      await this.#write({
        ...state,
        revision: this.#id(),
        notes: [...state.notes.filter((item) => item.url !== note.url), note],
      });
      return note;
    });
  }

  delete(url: string, expectedRevision: string): Promise<null> {
    return this.#enqueue(async () => {
      const key = canonicalUrl(url);
      const state = await this.#read();
      const old = state.notes.find((note) => note.url === key);
      if (!old || old.revision !== expectedRevision)
        throw new AppError(
          'CONFLICT',
          'This note changed in another window. Refresh before deleting it.',
        );
      await this.#write({
        ...state,
        revision: this.#id(),
        notes: state.notes.filter((note) => note.url !== key),
      });
      return null;
    });
  }

  clear(expectedRevision: string): Promise<null> {
    return this.#enqueue(async () => {
      const state = await this.#read();
      if (state.revision !== expectedRevision)
        throw new AppError(
          'CONFLICT',
          'Your notes changed in another window. Refresh and review them before clearing.',
        );
      await this.#write({ ...state, revision: this.#id(), notes: [] });
      return null;
    });
  }

  import(backup: Backup): Promise<ImportSummary> {
    return this.#enqueue(async () => {
      const input = parseBackup(backup);
      const state = await this.#read();
      const incoming = new Map<string, Note>();
      for (const note of input.notes) {
        if (!incoming.has(note.url) || note.updatedAt > (incoming.get(note.url)?.updatedAt ?? 0))
          incoming.set(note.url, note);
      }
      const merged = new Map(state.notes.map((note) => [note.url, note]));
      const result = { added: 0, updated: 0, kept: 0, total: 0 };
      for (const note of incoming.values()) {
        const old = merged.get(note.url);
        if (!old || note.updatedAt > old.updatedAt) {
          merged.set(note.url, { ...note, revision: this.#id() });
          if (old) result.updated += 1;
          else result.added += 1;
        } else result.kept += 1;
      }
      if (merged.size > LIMITS.notes)
        throw new AppError(
          'LIMIT_REACHED',
          'This import would exceed 200 notes. Nothing was changed.',
        );
      result.total = merged.size;
      if (result.added + result.updated > 0)
        await this.#write({ ...state, revision: this.#id(), notes: [...merged.values()] });
      return result;
    });
  }
}
