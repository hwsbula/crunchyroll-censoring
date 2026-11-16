import { activeTerms, parseState, parseTimingOffset } from './core/settings.ts';
import { findMatches, redact } from './core/matcher.ts';
import type { Occurrence, SavedState } from './core/types.ts';
import { send } from './shared/protocol.ts';
import type { RoutedPlayer } from './shared/protocol.ts';
import { element, errorMessage, message, time } from './shared/ui.ts';
import { showDeveloperTools, watchDeveloperTools } from './shared/developer-tools.ts';

let state: SavedState | null = null;
let player: RoutedPlayer | null = null;
let tabId: number | null = null;
let busy = false;
let signature = '';
let timingTarget = '';
let timingDirty = false;
let developerTools = false;
function languageName(value: string | null | undefined): string {
  if (!value) return 'Not identified';
  if (value === 'off') return 'Off';
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'language' }).of(value.replaceAll('_', '-')) ?? value
    );
  } catch {
    return value;
  }
}
function setControlState(): void {
  if (!state) return;
  element<HTMLInputElement>('#enabled').checked = state.settings.enabled;
  element<HTMLInputElement>('#reveal').checked = state.settings.reveal;
  element<HTMLSelectElement>('#mode').value = state.settings.mode;
  element('#mode-summary').textContent =
    `Audio mode: ${{ auto: 'Automatic', english: 'Manual English', japanese: 'Manual Japanese' }[state.settings.mode]}`;
  for (const selector of ['#enabled', '#reveal', '#mode'])
    element<HTMLInputElement>(selector).disabled = false;
}
function context(row: Occurrence): string {
  if (!state) return '';
  const matches = findMatches(row.text, [...activeTerms(state.settings), row.term]);
  const masked = state.settings.reveal ? row.text : redact(row.text, matches);
  const position = state.settings.reveal
    ? row.start
    : row.start +
      matches
        .filter((match) => match.end <= row.start)
        .reduce((n, match) => n + 4 - (match.end - match.start), 0);
  const start = Math.max(0, position - 55),
    end = Math.min(masked.length, position + 115);
  return `${start ? '…' : ''}${masked.slice(start, end)}${end < masked.length ? '…' : ''}`;
}
function renderOccurrences(): void {
  const rows = player?.snapshot.occurrences ?? [];
  const now = player?.snapshot.time ?? 0;
  const nextSignature = JSON.stringify([
    rows,
    state?.settings,
    developerTools,
    rows.map((row) => now < (row.playbackTime ?? row.time)),
  ]);
  if (signature === nextSignature) return;
  signature = nextSignature;
  const list = element<HTMLOListElement>('#occurrences');
  const focus =
    document.activeElement instanceof HTMLButtonElement
      ? { id: document.activeElement.dataset.id, action: document.activeElement.dataset.action }
      : null;
  const scroll = list.scrollTop;
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const li = document.createElement('li');
    li.classList.toggle('ignored', row.ignored);
    const timestamp = document.createElement('button');
    const playbackTime = row.playbackTime === undefined ? row.time : row.playbackTime;
    const unreliable = row.timingUnreliable || playbackTime === null;
    const shownTime = playbackTime ?? row.time;
    timestamp.type = 'button';
    timestamp.className = 'timestamp';
    timestamp.textContent = unreliable ? `Cue ${time(row.time)}` : time(shownTime);
    timestamp.dataset.action = 'seek';
    timestamp.dataset.id = row.id;
    timestamp.disabled = !!unreliable;
    timestamp.title = unreliable
      ? 'Caption-file time; playback timing is unverified. Seeking is disabled.'
      : developerTools
        ? `Caption-file time: ${time(row.time)}. Playback time: ${time(shownTime)}.`
        : `Jump to ${time(shownTime)}`;
    timestamp.setAttribute(
      'aria-label',
      unreliable
        ? `Caption-file time ${time(row.time)}; playback timing unverified`
        : `Seek to ${time(shownTime)}`,
    );
    const details = document.createElement('div');
    details.className = 'details';
    const term = document.createElement('span');
    term.className = 'match';
    term.textContent = state?.settings.reveal ? row.term : '****';
    const playback = document.createElement('span');
    playback.className = 'playback-state';
    playback.textContent = row.ignored
      ? 'Ignored'
      : row.audioCensored || row.textCensored
        ? `Censored · ${[row.audioCensored ? 'audio' : '', row.textCensored ? 'text' : ''].filter(Boolean).join(' + ')}`
        : unreliable
          ? 'Detected · timing unverified'
          : now < shownTime
            ? 'Upcoming · detected'
            : 'Detected · not censored';
    const excerpt = document.createElement('p');
    excerpt.className = 'context';
    excerpt.textContent = context(row);
    details.append(term, playback, excerpt);
    const ignore = document.createElement('button');
    ignore.type = 'button';
    ignore.className = 'ignore';
    ignore.dataset.action = 'ignore';
    ignore.dataset.id = row.id;
    ignore.textContent = row.ignored ? 'Unignore' : 'Ignore';
    ignore.setAttribute('aria-label', `${ignore.textContent} occurrence at ${time(shownTime)}`);
    li.append(timestamp, details, ignore);
    fragment.append(li);
  }
  list.replaceChildren(fragment);
  list.scrollTop = scroll;
  if (focus?.id)
    for (const button of list.querySelectorAll<HTMLButtonElement>('button'))
      if (button.dataset.id === focus.id && button.dataset.action === focus.action)
        button.focus({ preventScroll: true });
  element('#empty').hidden = rows.length > 0;
  element('#empty').textContent = player
    ? 'No matches in the loaded English tracks. Check the coverage statuses before watching.'
    : 'Start a Crunchyroll episode to review its English captions.';
  element('#count').textContent = String(player?.snapshot.total ?? 0);
  const limited = element('#limit');
  limited.hidden = !player || player.snapshot.total <= rows.length;
  limited.textContent = `Showing the first ${rows.length} matches. Scheduling still uses every detected match.`;
}
function renderPlayer(): void {
  const snapshot = player?.snapshot;
  const correction = snapshot?.audioTiming;
  const target = JSON.stringify([
    snapshot?.instance,
    snapshot?.episode,
    snapshot?.version,
    correction?.track,
  ]);
  if (target !== timingTarget) {
    timingTarget = target;
    timingDirty = false;
  }
  const input = element<HTMLInputElement>('#timing-offset');
  if (!timingDirty) input.value = String(correction?.offset ?? 0);
  input.disabled = !correction?.track;
  element<HTMLButtonElement>('#timing-apply').disabled = !correction?.track;
  element('#timing-status').textContent = !correction?.track
    ? 'Matching English-dub CC required.'
    : `Playback metadata: +${correction.automaticOffset ?? 0} seconds. Additional manual correction: ${correction.offset > 0 ? '+' : ''}${correction.offset} seconds. This episode and tab only.`;
  element('#manual-notice').hidden = !correction?.offset;
  element('#connection').textContent = snapshot?.episode
    ? 'Connected to the current episode'
    : 'Open a Crunchyroll episode to get started';
  element('#episode').textContent = snapshot?.episode
    ? `Episode ${snapshot.episode} · version ${snapshot.version}`
    : 'No connected Crunchyroll episode';
  element('#audio-language').textContent = languageName(snapshot?.audioLanguage);
  element('#subtitle-language').textContent = languageName(snapshot?.subtitleLanguage);
  element('#selected-mode').textContent =
    snapshot?.mode ?? 'An override resolves missing detection only; captions are still required.';
  for (const key of ['audio', 'subtitle'] as const) {
    const status = key === 'audio' ? snapshot?.audio : snapshot?.subtitles;
    const phase = element(`#${key}-phase`);
    const currentPhase =
      status?.phase ?? (!state ? 'loading' : state.settings.enabled ? 'unavailable' : 'disabled');
    phase.textContent = {
      active: 'Active',
      loading: 'Checking',
      disabled: 'Off',
      unavailable: 'Unavailable',
      error: 'Error',
    }[currentPhase];
    phase.dataset.phase = currentPhase;
    const reason =
      status?.reason ??
      (state && !state.settings.enabled
        ? 'Filtering is disabled.'
        : key === 'audio'
          ? 'Audio filtering unavailable: connect to an accessible episode player.'
          : 'Subtitle filtering unavailable: open an episode and select English subtitles.');
    element(`#${key}-diagnostic`).textContent = reason;
    // Keep every unavailable/error explanation visible. Only successful-path
    // implementation detail belongs behind the developer display setting.
    element(`#${key}-reason`).textContent =
      currentPhase === 'active'
        ? key === 'audio'
          ? 'Mutes matching English caption lines. Nearby dialogue may also be silenced.'
          : reason
        : reason;
  }
  element('#track-summary').textContent =
    snapshot?.trackSummary ??
    'Reload the episode after installing. Only captions for the current episode version are accepted.';
  renderOccurrences();
}
async function refresh(): Promise<void> {
  if (busy) return;
  try {
    state = parseState(await send({ type: 'settings:get' }));
    setControlState();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    if (tabId === null) throw new Error('No active tab was found.');
    player = await send<RoutedPlayer>({ type: 'player:get', tabId });
    message('');
  } catch (error) {
    player = null;
    message(errorMessage(error), true);
  }
  renderPlayer();
}
async function perform(operation: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  let failure: string | null = null;
  try {
    await operation();
  } catch (error) {
    failure = errorMessage(error);
  } finally {
    busy = false;
    await refresh();
    if (failure) message(failure, true);
  }
}
for (const [id, key] of [
  ['enabled', 'enabled'],
  ['reveal', 'reveal'],
  ['mode', 'mode'],
] as const) {
  element<HTMLInputElement>(`#${id}`).addEventListener('change', () => {
    const control = element<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    const value = control instanceof HTMLInputElement ? control.checked : control.value;
    void perform(async () => {
      state = parseState(await send({ type: 'preferences:patch', patch: { [key]: value } }));
      setControlState();
    });
  });
}
element('#occurrences').addEventListener('click', (event) => {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button[data-action]')
      : null;
  if (!button || !player) return;
  const target = player.target;
  const action = button.dataset.action;
  const row = player.snapshot.occurrences.find((value) => value.id === button.dataset.id);
  if (!row) return;
  void perform(async () => {
    await send({
      type: 'player:action',
      target,
      action,
      id: row.id,
      ...(action === 'ignore' ? { ignored: !row.ignored } : {}),
    });
  });
});
element('#retry').addEventListener('click', () => {
  void perform(async () => {
    if (player) await send({ type: 'player:action', target: player.target, action: 'retry' });
  });
});
element('#timing-offset').addEventListener('input', () => {
  timingDirty = true;
});
element('#timing-apply').addEventListener('click', () => {
  const target = player?.target;
  const track = player?.snapshot.audioTiming?.track;
  if (!developerTools || !target || !track) return;
  void perform(async () => {
    const input = element<HTMLInputElement>('#timing-offset');
    if (!input.value.trim() || !input.checkValidity())
      throw new Error('Enter a correction from -300 to +300 seconds.');
    const offset = parseTimingOffset(Number(input.value));
    const submitted = input.value;
    await send({ type: 'player:action', target, action: 'timing', id: track, offset });
    if (input.value === submitted) timingDirty = false;
  });
});
element('#timing-reset').addEventListener('click', () => {
  const target = player?.target;
  const track = player?.snapshot.audioTiming?.track;
  if (!target || !track) return;
  void perform(async () => {
    await send({ type: 'player:action', target, action: 'timing', id: track, offset: 0 });
    timingDirty = false;
  });
});
element('#settings').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage().catch((error) => message(errorMessage(error), true));
});
watchDeveloperTools(
  (enabled) => {
    developerTools = enabled;
    showDeveloperTools(enabled, element('#settings'));
    element('#developer-error').hidden = true;
    renderOccurrences();
  },
  (error) => {
    element('#developer-error').textContent = errorMessage(error);
    element('#developer-error').hidden = false;
  },
);
void refresh();
setInterval(() => void refresh(), 1000);
