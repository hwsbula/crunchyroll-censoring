import { canonicalTerm, normalizeTerms, parseState } from './core/settings.ts';
import { TERM_GROUPS } from './core/terms.ts';
import type { SavedState } from './core/types.ts';
import { send } from './shared/protocol.ts';
import { element, errorMessage, message } from './shared/ui.ts';
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
void load();
