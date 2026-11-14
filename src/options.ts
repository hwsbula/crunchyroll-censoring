import { canonicalTerm, normalizeTerms, parseState } from './core/settings.ts';
import { TERM_GROUPS } from './core/terms.ts';
import type { SavedState } from './core/types.ts';
import { send } from './shared/protocol.ts';
import { element, errorMessage, message } from './shared/ui.ts';
import { BACKUP_LIMIT, readSettingsBackup } from './core/backup.ts';
import { record } from './core/settings.ts';
let state: SavedState | null = null;
let formRevision = 0;
const builtins = element('#builtins');
const groups = TERM_GROUPS.map((group) => {
  const section = document.createElement('section');
  section.className = 'term-group';
  section.dataset.category = group.id;
  const heading = document.createElement('h3');
  heading.id = `category-${group.id}`;
  heading.textContent = group.title;
  section.setAttribute('aria-labelledby', heading.id);
  const help = document.createElement('p');
  help.className = 'help';
  help.textContent = group.description;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const list = document.createElement('div');
  list.className = 'builtins';
  const rows = group.terms.map((term) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = term;
    checkbox.name = 'builtin';
    label.append(checkbox, document.createTextNode(term));
    list.append(label);
    return { label, checkbox, term };
  });
  for (const [text, checked] of [
    ['Enable category', true],
    ['Disable category', false],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('aria-label', `${text}: ${group.title}`);
    button.addEventListener('click', () => {
      for (const row of rows) row.checkbox.checked = checked;
      filterTerms();
    });
    actions.append(button);
  }
  section.append(heading, help, actions, list);
  builtins.append(section);
  return { section, rows };
});
function filterTerms(): void {
  const query = canonicalTerm(element<HTMLInputElement>('#term-search').value);
  let visible = 0;
  let enabled = 0;
  let total = 0;
  for (const group of groups) {
    let shown = 0;
    for (const row of group.rows) {
      row.label.hidden = !row.term.includes(query);
      if (!row.label.hidden) shown++;
      if (row.checkbox.checked) enabled++;
      total++;
    }
    group.section.hidden = shown === 0;
    visible += shown;
  }
  element('#term-count').textContent =
    `${total} built-in terms · ${visible} shown · ${enabled} enabled. Save settings to apply.`;
  element('#term-empty').hidden = visible !== 0;
}
element('#term-search').addEventListener('input', filterTerms);
builtins.addEventListener('change', filterTerms);
function counts(): void {
  element('#exception-count').textContent =
    `${state?.exceptions.length ?? 0} saved occurrence exceptions (maximum 1,000).`;
  element<HTMLButtonElement>('#clear').disabled = !state?.exceptions.length;
}
function populate(): void {
  if (!state) return;
  formRevision = state.revision;
  const settings = state.settings;
  element<HTMLInputElement>('#enabled').checked = settings.enabled;
  element<HTMLInputElement>('#reveal').checked = settings.reveal;
  element<HTMLSelectElement>('#mode').value = settings.mode;
  element<HTMLInputElement>('#before').value = String(settings.beforeMs);
  element<HTMLInputElement>('#after').value = String(settings.afterMs);
  element<HTMLTextAreaElement>('#custom').value = settings.custom.join('\n');
  for (const checkbox of builtins.querySelectorAll<HTMLInputElement>('input'))
    checkbox.checked = !settings.disabledBuiltins.includes(checkbox.value);
  filterTerms();
  element<HTMLFieldSetElement>('#fields').disabled = false;
  counts();
}
async function load(): Promise<void> {
  try {
    state = parseState(await send({ type: 'settings:get' }));
    populate();
    message('Settings loaded.');
    await refreshSync();
  } catch (error) {
    message(errorMessage(error), true);
  }
}
element('#settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state) return;
  const revision = formRevision;
  void (async () => {
    try {
      const custom = normalizeTerms(
        element<HTMLTextAreaElement>('#custom')
          .value.split(/\r?\n/)
          .filter((line) => line.trim()),
      );
      const settings = {
        enabled: element<HTMLInputElement>('#enabled').checked,
        reveal: element<HTMLInputElement>('#reveal').checked,
        mode: element<HTMLSelectElement>('#mode').value,
        beforeMs: Number(element<HTMLInputElement>('#before').value),
        afterMs: Number(element<HTMLInputElement>('#after').value),
        custom,
        disabledBuiltins: [...builtins.querySelectorAll<HTMLInputElement>('input')]
          .filter((input) => !input.checked)
          .map((input) => input.value),
      };
      element<HTMLButtonElement>('#save').disabled = true;
      state = parseState(await send({ type: 'settings:save', settings, revision }));
      populate();
      message('Settings saved. Active players have been updated.');
      await refreshSync();
    } catch (error) {
      message(errorMessage(error), true);
    } finally {
      element<HTMLButtonElement>('#save').disabled = false;
    }
  })();
});
element('#reload').addEventListener('click', () => void load());
element('#clear').addEventListener('click', () => {
  element('#clear-confirm').hidden = false;
  element('#confirm-clear').focus();
});
element('#cancel-clear').addEventListener('click', () => {
  element('#clear-confirm').hidden = true;
  element('#clear').focus();
});
element('#confirm-clear').addEventListener('click', () => {
  void (async () => {
    try {
      const previousSettings = JSON.stringify(state?.settings);
      state = parseState(await send({ type: 'exceptions:clear' }));
      if (previousSettings === JSON.stringify(state.settings)) formRevision = state.revision;
      counts();
      element('#clear-confirm').hidden = true;
      message('Saved exceptions cleared. All occurrences are filtered again.');
    } catch (error) {
      message(errorMessage(error), true);
    }
  })();
});
async function refreshSync(value?: unknown): Promise<void> {
  const status = record(value ?? (await send({ type: 'sync:status' })));
  if (typeof status.enabled !== 'boolean' || typeof status.message !== 'string')
    throw new Error('Invalid sync status. Reload settings.');
  element<HTMLInputElement>('#sync-enabled').checked = status.enabled;
  element<HTMLInputElement>('#sync-enabled').disabled = false;
  element('#sync-status').textContent = status.message;
  element('#sync-status').classList.toggle(
    'error',
    status.phase === 'error' || status.phase === 'conflict',
  );
  for (const id of ['#sync-local', '#sync-remote'])
    element<HTMLButtonElement>(id).disabled = !status.enabled;
}
async function syncAction(request: Record<string, unknown>, reload = false): Promise<void> {
  try {
    const result = record(await send(request));
    await refreshSync(result);
    if (reload && result.phase === 'ready') await load();
  } catch (error) {
    element('#sync-status').textContent = errorMessage(error);
  }
}
element('#sync-enabled').addEventListener('change', () => {
  void syncAction({
    type: 'sync:toggle',
    enabled: element<HTMLInputElement>('#sync-enabled').checked,
  });
});
element('#sync-retry').addEventListener('click', () => void syncAction({ type: 'sync:retry' }));
let syncChoice: 'local' | 'remote' | 'clear' | null = null;
for (const choice of ['local', 'remote', 'clear'] as const) {
  element(`#sync-${choice}`).addEventListener('click', () => {
    syncChoice = choice;
    element('#sync-confirm-text').textContent =
      choice === 'local'
        ? 'Replace the synced profile with this device’s saved settings? Other synced installations can receive these preferences and word lists. Export a backup first if you want to keep both profiles.'
        : choice === 'remote'
          ? 'Replace this device’s preferences and word lists with the complete synced profile? Unsaved form edits will be replaced. Local occurrence exceptions stay unchanged.'
          : 'Remove this extension’s synced preferences and turn sync off here? Your local settings stay active. Other enabled devices can upload again after an edit.';
    element('#sync-confirm').hidden = false;
    element('#sync-confirm-yes').focus();
  });
}
element('#sync-confirm-no').addEventListener('click', () => {
  element('#sync-confirm').hidden = true;
  syncChoice = null;
});
element('#sync-confirm-yes').addEventListener('click', () => {
  if (!syncChoice) return;
  const request =
    syncChoice === 'clear'
      ? { type: 'sync:clear', confirm: true }
      : { type: 'sync:resolve', choice: syncChoice };
  const reload = syncChoice === 'remote';
  element('#sync-confirm').hidden = true;
  syncChoice = null;
  void syncAction(request, reload);
});
element('#export-settings').addEventListener('click', () => {
  void (async () => {
    try {
      const text = await send({ type: 'settings:export' });
      if (typeof text !== 'string') throw new Error('Could not create settings backup.');
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'crunchyroll-censoring-settings.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message('Saved settings exported. Keep the backup before changing extension installations.');
    } catch (error) {
      message(errorMessage(error), true);
    }
  })();
});
let pendingBackup: { text: string; revision: number } | null = null;
let importGeneration = 0;
element('#import-settings').addEventListener('change', () => {
  const generation = ++importGeneration;
  pendingBackup = null;
  element('#import-preview').hidden = true;
  void (async () => {
    try {
      const file = element<HTMLInputElement>('#import-settings').files?.[0];
      if (!file || !state) return;
      if (file.size > BACKUP_LIMIT) throw new Error('Settings backup must be smaller than 512 KB.');
      const text = await file.text();
      if (generation !== importGeneration) return;
      const settings = readSettingsBackup(text);
      pendingBackup = { text, revision: formRevision };
      element('#import-summary').textContent =
        `Ready to replace saved preferences with ${settings.custom.length} custom terms and ${settings.disabledBuiltins.length} disabled built-ins, mode ${settings.mode}, filtering ${settings.enabled ? 'on' : 'off'}. Local occurrence exceptions stay unchanged.`;
      element('#import-preview').hidden = false;
      element('#import-confirm').focus();
    } catch (error) {
      message(errorMessage(error), true);
    }
  })();
});
element('#import-cancel').addEventListener('click', () => {
  importGeneration++;
  pendingBackup = null;
  element('#import-preview').hidden = true;
  element<HTMLInputElement>('#import-settings').value = '';
});
element('#import-confirm').addEventListener('click', () => {
  const backup = pendingBackup;
  if (!backup) return;
  void (async () => {
    try {
      state = parseState(
        await send({ type: 'settings:import', backup: backup.text, revision: backup.revision }),
      );
      populate();
      pendingBackup = null;
      element('#import-preview').hidden = true;
      element<HTMLInputElement>('#import-settings').value = '';
      message('Settings imported. Active players have been updated.');
      await refreshSync();
    } catch (error) {
      message(errorMessage(error), true);
    }
  })();
});
chrome.storage.onChanged.addListener((_changes, area) => {
  // Keep unsaved form edits intact. A remote preference change advances the saved
  // revision, so Save/Import rejects a stale draft until the user reloads it.
  if (area === 'sync' || area === 'local') void refreshSync().catch(() => undefined);
});
void load();
