import { AppError, LIMITS, canonicalUrl } from './shared/model.ts';
import type { Note } from './shared/model.ts';
import { send } from './shared/protocol.ts';
import { confirmAction, element, setStatus, showError } from './shared/ui.ts';

const form = element<HTMLFormElement>('#note-form');
const fields = element<HTMLFieldSetElement>('#note-fields');
const textarea = element<HTMLTextAreaElement>('#note-text');
const saveButton = element<HTMLButtonElement>('#save-note');
const deleteButton = element<HTMLButtonElement>('#delete-note');
let page: { tabId: number; url: string; title: string } | null = null;
let saved: Note | null = null;
let quote = '';
let busy = false;

function updateControls(): void {
  fields.disabled = busy || !page;
  saveButton.disabled = busy || !page || (!textarea.value.trim() && !quote);
  deleteButton.hidden = saved === null;
  element('#quote-section').hidden = !quote;
  element('#quote').textContent = quote;
  element('#character-count').textContent = `${textarea.value.length.toLocaleString()} / 5,000`;
  form.setAttribute('aria-busy', String(busy));
}

function markDraft(): void {
  updateControls();
  setStatus('Unsaved changes. Save before closing.');
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

async function ensureSamePage(): Promise<void> {
  if (!page) throw new AppError('UNSUPPORTED_PAGE', 'Open a webpage first.');
  const tab = await chrome.tabs.get(page.tabId);
  if (canonicalUrl(tab.url) !== page.url)
    throw new AppError(
      'CONFLICT',
      'This tab navigated to another page. Copy your draft and reopen the popup.',
    );
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void run(async () => {
    if (!page) return;
    await ensureSamePage();
    saved = await send({
      type: 'note:save',
      note: { url: page.url, title: page.title, text: textarea.value, quote },
      expectedRevision: saved?.revision ?? null,
    });
    textarea.value = saved.text;
    quote = saved.quote;
    setStatus('Saved on this device.');
  });
});

textarea.addEventListener('input', markDraft);

element('#capture-selection').addEventListener('click', () => {
  void run(async () => {
    if (!page) return;
    const result = await send({ type: 'selection:capture', tabId: page.tabId, url: page.url });
    if (!result.selection) {
      setStatus('No text selected. Select text on the webpage, then reopen this popup.');
      return;
    }
    quote = result.selection;
    setStatus('Selection added. Save the note to keep it.');
  });
});

element('#remove-quote').addEventListener('click', () => {
  quote = '';
  markDraft();
});

deleteButton.addEventListener('click', () => {
  void run(async () => {
    if (!saved) return;
    if (
      !(await confirmAction(
        'Delete this note?',
        'This removes the saved note and selected text for this page.',
        'Delete note',
      ))
    )
      return;
    await send({ type: 'note:delete', url: saved.url, expectedRevision: saved.revision });
    saved = null;
    textarea.value = '';
    quote = '';
    setStatus('Note deleted.');
  });
});

element('#open-library').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage().catch(showError);
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!saveButton.disabled) form.requestSubmit();
  }
});

void run(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url)
    throw new AppError(
      'UNSUPPORTED_PAGE',
      'Open a regular webpage and click the Page Notes toolbar icon.',
    );
  const url = canonicalUrl(tab.url);
  const current = {
    tabId: tab.id,
    url,
    title: (tab.title ?? new URL(url).hostname).slice(0, LIMITS.title),
  };
  element('#page-title').textContent = current.title;
  element('#page-url').textContent = new URL(url).hostname;
  element('#page-url').title = url;
  saved = await send({ type: 'note:get', url });
  page = current;
  textarea.value = saved?.text ?? '';
  quote = saved?.quote ?? '';
  setStatus(
    saved
      ? 'Saved note loaded. Changes need to be saved.'
      : 'Write a note, then save it on this device.',
  );
});
