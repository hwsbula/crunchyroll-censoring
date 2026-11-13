import { AppError, LIMITS, createBackup, parseBackup } from './shared/model.ts';
import type { Note, State } from './shared/model.ts';
import { send } from './shared/protocol.ts';
import { confirmAction, element, setStatus, showError } from './shared/ui.ts';

const list = element('#notes-list');
const search = element<HTMLInputElement>('#search');
const fileInput = element<HTMLInputElement>('#import-file');
const template = element<HTMLTemplateElement>('#note-template');
let state: State | null = null;
let busy = false;

function updateControls(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('main button, header button'))
    button.disabled = busy;
  element<HTMLButtonElement>('#export-notes').disabled = busy || !state;
  element<HTMLButtonElement>('#clear-notes').disabled = busy || !state?.notes.length;
  fileInput.disabled = busy || !state;
  element('#library').setAttribute('aria-busy', String(busy));
}

function render(): void {
  const query = search.value.toLocaleLowerCase().trim();
  const notes = (state?.notes ?? [])
    .filter((note) =>
      `${note.title}\n${note.url}\n${note.text}\n${note.quote}`.toLocaleLowerCase().includes(query),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt || a.url.localeCompare(b.url));
  list.replaceChildren();
  element('#note-count').textContent = `${state?.notes.length ?? 0} / ${LIMITS.notes} notes`;
  element('#empty-state').hidden = notes.length > 0;
  element('#empty-title').textContent = query
    ? 'No matching notes'
    : 'Keep a thought with the page';
  element('#empty-description').textContent = query
    ? 'Try another title, address, or word from a note.'
    : 'Open a webpage, click the Page Notes toolbar icon, and save your first note.';
  for (const note of notes) {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const title = fragment.querySelector<HTMLElement>('.note-title');
    const address = fragment.querySelector<HTMLAnchorElement>('.note-address');
    const text = fragment.querySelector<HTMLElement>('.note-text');
    const quote = fragment.querySelector<HTMLElement>('.note-quote');
    const date = fragment.querySelector<HTMLTimeElement>('time');
    const open = fragment.querySelector<HTMLAnchorElement>('.open-note');
    const remove = fragment.querySelector<HTMLButtonElement>('.delete-note');
    if (!title || !address || !text || !quote || !date || !open || !remove)
      throw new Error('The note template is incomplete.');
    title.textContent = note.title;
    address.href = note.url;
    address.textContent = note.url;
    text.textContent = note.text;
    text.hidden = !note.text;
    quote.textContent = note.quote;
    quote.hidden = !note.quote;
    date.dateTime = new Date(note.updatedAt).toISOString();
    date.textContent = new Date(note.updatedAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    open.href = note.url;
    open.setAttribute('aria-label', `Open page: ${note.title}`);
    remove.setAttribute('aria-label', `Delete note for ${note.title}`);
    remove.addEventListener('click', () => {
      void removeNote(note);
    });
    list.append(fragment);
  }
  updateControls();
}

async function refresh(): Promise<void> {
  state = await send({ type: 'state:get' });
  render();
}

async function run(operation: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  updateControls();
  try {
    await operation();
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    updateControls();
  }
}

async function removeNote(note: Note): Promise<void> {
  await run(async () => {
    if (
      !(await confirmAction(
        'Delete this note?',
        `Remove “${note.title}” from this device?`,
        'Delete note',
      ))
    )
      return;
    await send({ type: 'note:delete', url: note.url, expectedRevision: note.revision });
    await refresh();
    setStatus('Note deleted.');
    search.focus();
  });
}

search.addEventListener('input', render);
element('#refresh-notes').addEventListener('click', () => {
  void run(async () => {
    await refresh();
    setStatus('Notes refreshed.');
  });
});

element('#export-notes').addEventListener('click', () => {
  void run(async () => {
    await refresh();
    if (!state) return;
    const data = JSON.stringify(createBackup(state.notes), null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `page-notes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Leave the URL alive until Chrome has accepted the user-initiated download.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setStatus('Backup download requested. The file contains your notes and page addresses.');
  });
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  void run(async () => {
    if (file.size > LIMITS.importBytes)
      throw new AppError('INVALID_INPUT', 'Choose a JSON backup smaller than 5 MB.');
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text()) as unknown;
    } catch {
      throw new AppError(
        'INVALID_INPUT',
        'This file is not valid JSON. Choose a Page Notes backup.',
      );
    }
    const backup = parseBackup(raw);
    if (
      !(await confirmAction(
        'Import this backup?',
        `Merge ${backup.notes.length} notes. For matching page addresses, the note with the later saved date wins. Existing notes are kept on equal dates.`,
        'Import notes',
      ))
    )
      return;
    const result = await send({ type: 'notes:import', backup });
    await refresh();
    setStatus(
      `Import complete: ${result.added} added, ${result.updated} updated, ${result.kept} kept.`,
    );
  });
});

element('#clear-notes').addEventListener('click', () => {
  void run(async () => {
    if (!state) return;
    const expectedRevision = state.revision;
    if (
      !(await confirmAction(
        'Clear all notes?',
        `Permanently remove ${state.notes.length} notes from this device? Export a backup first if you want to keep them.`,
        'Clear all notes',
      ))
    )
      return;
    await send({ type: 'notes:clear', expectedRevision });
    await refresh();
    setStatus('All notes cleared.');
    search.focus();
  });
});

void run(async () => {
  await refresh();
  setStatus('Your notes stay in this Chrome profile.');
});
