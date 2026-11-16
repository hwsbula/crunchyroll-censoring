// UI-only, local to this installation. Kept out of the synced filtering profile
// so older versions can continue reading that profile without a schema change.
export const DEVELOPER_TOOLS_KEY = 'crunchyroll.developer-tools.v1';

export function parseDeveloperTools(value: unknown): boolean {
  if (value === undefined) return false;
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('enabled' in value) ||
    typeof value.enabled !== 'boolean'
  )
    throw new Error('Developer display settings could not be read. Existing data was preserved.');
  return value.enabled;
}

export async function saveDeveloperTools(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [DEVELOPER_TOOLS_KEY]: { version: 1, enabled } });
}

export function watchDeveloperTools(
  changed: (enabled: boolean) => void,
  failed: (error: unknown) => void,
): void {
  let generation = 0;
  const apply = (value: unknown): void => {
    try {
      changed(parseDeveloperTools(value));
    } catch (error) {
      changed(false);
      failed(error);
    }
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[DEVELOPER_TOOLS_KEY]) return;
    generation++;
    apply(changes[DEVELOPER_TOOLS_KEY].newValue);
  });
  const pending = generation;
  void chrome.storage.local.get(DEVELOPER_TOOLS_KEY).then((data) => {
    if (generation === pending) apply(data[DEVELOPER_TOOLS_KEY]);
  }, failed);
}

export function showDeveloperTools(enabled: boolean, fallback: HTMLElement): void {
  for (const section of document.querySelectorAll<HTMLElement>('[data-developer]')) {
    if (!enabled && section.contains(document.activeElement)) fallback.focus();
    section.hidden = !enabled;
    if (!enabled && section instanceof HTMLDetailsElement) section.open = false;
  }
}
