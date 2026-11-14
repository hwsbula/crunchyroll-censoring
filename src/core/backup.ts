import { parseSettings, record } from './settings.ts';
import type { Settings } from './types.ts';

export const BACKUP_LIMIT = 512_000;
export function settingsBackup(settings: Settings): string {
  return (
    JSON.stringify(
      { format: 'crunchyroll-censoring-settings', version: 1, settings: parseSettings(settings) },
      null,
      2,
    ) + '\n'
  );
}
export function readSettingsBackup(text: string): Settings {
  if (new TextEncoder().encode(text).byteLength > BACKUP_LIMIT)
    throw new Error('Settings backup must be smaller than 512 KB.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const raw = record(value);
  if (raw.format !== 'crunchyroll-censoring-settings' || raw.version !== 1)
    throw new Error('Unsupported settings backup. Export a backup from CrunchyRoll Censoring.');
  return parseSettings(raw.settings);
}
