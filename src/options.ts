import { BUILTINS, normalizeTerms, parseState } from './core/settings.ts';
import type { SavedState } from './core/types.ts';
import { send } from './shared/protocol.ts';
import { element, errorMessage, message } from './shared/ui.ts';
let state: SavedState | null = null;
let formRevision = 0;
const builtins = element('#builtins');
for (const term of BUILTINS) {
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = term;
  checkbox.name = 'builtin';
  label.append(checkbox, document.createTextNode(term));
  builtins.append(label);
}
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
