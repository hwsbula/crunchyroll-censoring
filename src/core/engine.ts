import { MediaSeeker } from './seeker.ts';
import type { SeekRoute } from './seeker.ts';
import { activeTerms, digest, english, japanese, LIMITS } from './settings.ts';
import { findMatches } from './matcher.ts';
import { renderDocument } from './captions.ts';
import { CueScheduler, MuteGate } from './scheduler.ts';
import type { Interval, Media } from './scheduler.ts';
import type {
  FilterStatus,
  Match,
  Occurrence,
  PlayerSnapshot,
  SavedState,
  Session,
  Track,
} from './types.ts';

export interface Renderer {
  trackId: string;
  language: string;
  format?: Track['document']['format'];
  description?: string;
  apply(content: string, matches: ReadonlyMap<string, readonly Match[]>): void;
  restore(): void;
  censoredCues?(): ReadonlySet<string>;
}
const status = (phase: FilterStatus['phase'], reason: string): FilterStatus => ({ phase, reason });
export function selectedMode(
  audio: string | null,
  override: SavedState['settings']['mode'],
): string {
  if (japanese(audio)) return 'Japanese audio (detected)';
  if (english(audio)) return 'English audio (detected)';
  if (audio) return `Unsupported audio (${audio})`;
  return override === 'auto'
    ? 'Audio language unresolved'
    : `${override === 'english' ? 'English' : 'Japanese'} audio (manual override)`;
}
export function mayFilterAudio(session: Session, state: SavedState): boolean {
  return (
    english(session.audioLanguage) || (!session.audioLanguage && state.settings.mode === 'english')
  );
}
export function dialogueTrack(session: Session): Track | undefined {
  return session.tracks.find(
    (track) =>
      track.kind === 'captions' && english(track.language) && track.version === session.version,
  );
}
export async function analyse(session: Session, state: SavedState): Promise<Occurrence[]> {
  const terms = activeTerms(state.settings);
  const hashes = new Map(
    await Promise.all(terms.map(async (term) => [term, await digest(term)] as const)),
  );
  const occurrences: Occurrence[] = [];
  for (const track of session.tracks) {
    if (!english(track.language) || track.version !== session.version) continue;
    for (const cue of track.document.cues)
      for (const match of findMatches(cue.text, terms)) {
        const id = `${track.id}.${cue.key}.${match.start}.${match.end}.${hashes.get(match.term)!}`;
        occurrences.push({
          ...match,
          id,
          track: track.id,
          cue: cue.key,
          time: cue.start,
          endTime: cue.end,
          text: cue.text,
          ignored: state.exceptions.includes(id),
          audioCensored: false,
          textCensored: false,
        });
        if (occurrences.length > 20000)
          throw new Error('Too many matches for safe local scheduling. Reduce the enabled terms.');
      }
  }
  return occurrences.sort((a, b) => a.time - b.time || a.start - b.start);
}
export function intervalsFor(
  occurrences: readonly Occurrence[],
  track: Track,
  state: SavedState,
): Interval[] {
  return occurrences
    .filter((value) => !value.ignored && value.track === track.id)
    .map((value) => ({
      start: Math.max(0, value.time - state.settings.beforeMs / 1000),
      end: value.endTime + state.settings.afterMs / 1000,
      ids: [value.id],
    }));
}
export class FilterEngine {
  private state: SavedState;
  private session: Session | null = null;
  private occurrences: Occurrence[] = [];
  private censored = new Map<string, { audio: boolean; text: boolean }>();
  private media: Media | null = null;
  private gate: MuteGate | null = null;
  private seeker: MediaSeeker | null = null;
  private seekRoute: SeekRoute | undefined;
  private scheduler: CueScheduler | null = null;
  private renderer: Renderer | null = null;
  private subtitleLanguage: string | null = null;
  private filterError: string | null = null;
  private rendererProblem: FilterStatus | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private audio = status(
    'unavailable',
    'Audio filtering unavailable: waiting for current playback metadata.',
  );
  private subtitles = status(
    'unavailable',
    'Subtitle filtering unavailable: no recognized English renderer.',
  );
  private error: string | null = null;
  private rebuilding = false;
  private timelineReady = true;
  readonly instance = crypto.randomUUID();
  get enabled(): boolean {
    return this.state.settings.enabled;
  }
  constructor(state: SavedState, seekRoute?: SeekRoute) {
    this.state = state;
    this.seekRoute = seekRoute;
  }
  attach(media: Media): void {
    if (this.media === media) return;
    this.detach();
    this.media = media;
    this.seeker = new MediaSeeker(media, this.seekRoute);
    try {
      this.gate = new MuteGate(media);
      this.scheduler = new CueScheduler(media, this.gate);
    } catch {
      this.error = 'Player mute control could not be attached.';
    }
    for (const event of [
      'playing',
      'play',
      'pause',
      'waiting',
      'stalled',
      'seeking',
      'seeked',
      'ratechange',
      'timeupdate',
      'ended',
    ])
      media.addEventListener(event, this.onMedia);
    this.startLoop();
    void this.rebuild();
  }
  private onMedia = (): void => {
    this.tick();
  };
  private startLoop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const loop = (): void => {
      this.tick();
      this.timer = setTimeout(loop, this.scheduler?.delay() ?? 25);
    };
    loop();
  }
  detach(): void {
    this.seeker?.cancel();
    this.seeker = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.media)
      for (const event of [
        'playing',
        'play',
        'pause',
        'waiting',
        'stalled',
        'seeking',
        'seeked',
        'ratechange',
        'timeupdate',
        'ended',
      ])
        this.media.removeEventListener(event, this.onMedia);
    this.gate?.dispose();
    this.gate = null;
    this.scheduler = null;
    this.media = null;
    this.setRenderer(null);
  }
  private restore(renderer: Renderer | null): void {
    try {
      renderer?.restore();
    } catch {
      this.rendererProblem = status(
        'error',
        'Subtitle filtering unavailable: the previous renderer could not restore its original track. Reload the player.',
      );
    }
  }
  preparedContent(track: Track): string | null {
    if (this.rebuilding || !this.session?.tracks.some((value) => value.id === track.id))
      return null;
    const matches = new Map(
      track.document.cues.map((cue) => [
        cue.key,
        this.occurrences.filter(
          (value) => value.track === track.id && value.cue === cue.key && !value.ignored,
        ),
      ]),
    );
    return this.state.settings.enabled
      ? renderDocument(track.document, matches)
      : track.document.original;
  }
  setRenderer(renderer: Renderer | null, restorePrevious = true): void {
    if (this.renderer !== renderer && restorePrevious) this.restore(this.renderer);
    this.renderer = renderer;
    if (renderer) this.subtitleLanguage = renderer.language;
    this.computeStatuses();
    if (!this.rebuilding) this.applyRenderer();
    this.tick();
  }
  private applyRenderer(): void {
    const track = this.session?.tracks.find((track) => track.id === this.renderer?.trackId);
    if (this.subtitles.phase === 'active' && track && this.renderer) {
      const matches = new Map(
        track.document.cues.map((cue) => [
          cue.key,
          this.occurrences.filter(
            (value) => value.track === track.id && value.cue === cue.key && !value.ignored,
          ),
        ]),
      );
      try {
        this.renderer.apply(renderDocument(track.document, matches), matches);
      } catch {
        this.rendererProblem = status(
          'error',
          'Subtitle filtering unavailable: the renderer rejected the replacement track. Reload the player.',
        );
        this.restore(this.renderer);
        this.computeStatuses();
      }
    } else this.restore(this.renderer);
  }
  setTimelineReady(ready: boolean): void {
    this.timelineReady = ready;
    this.computeStatuses();
    const track = this.session && dialogueTrack(this.session);
    this.scheduler?.setIntervals(
      ready && this.audio.phase === 'active' && track
        ? intervalsFor(this.occurrences, track, this.state)
        : [],
    );
    this.tick();
  }
  setRendererProblem(problem: FilterStatus | null): void {
    this.rendererProblem = problem;
    this.computeStatuses();
  }
  setSubtitleLanguage(language: string | null): void {
    this.subtitleLanguage = language;
    this.computeStatuses();
  }
  updateMetadata(session: Session): void {
    this.session = session;
    this.computeStatuses();
    if (this.audio.phase !== 'active') this.scheduler?.setIntervals([]);
    void this.rebuild();
  }
  setSession(session: Session | null, reason?: string): void {
    this.seeker?.cancel();
    this.generation++;
    this.scheduler?.setIntervals([]);
    this.restore(this.renderer);
    this.renderer = null;
    this.session = session;
    this.subtitleLanguage = null;
    this.rendererProblem = null;
    this.occurrences = [];
    this.censored.clear();
    this.error = reason ?? null;
    void this.rebuild();
  }
  invalidate(reason: string): void {
    this.setSession(null, reason);
  }
  update(state: SavedState): void {
    this.state = state;
    this.computeStatuses();
    if (this.audio.phase !== 'active') this.scheduler?.setIntervals([]);
    if (!state.settings.enabled) this.restore(this.renderer);
    void this.rebuild();
  }
  async rebuild(): Promise<void> {
    const generation = ++this.generation;
    this.rebuilding = true;
    this.filterError = null;
    try {
      const values = this.session ? await analyse(this.session, this.state) : [];
      if (generation !== this.generation) return;
      this.occurrences = values;
      this.computeStatuses();
      const dialogue = this.session && dialogueTrack(this.session);
      this.scheduler?.setIntervals(
        this.audio.phase === 'active' && dialogue ? intervalsFor(values, dialogue, this.state) : [],
      );
      this.applyRenderer();
    } catch (error) {
      if (generation !== this.generation) return;
      this.filterError = error instanceof Error ? error.message : 'Local filtering failed.';
      this.error = this.filterError;
      this.audio = status('error', `Audio filtering unavailable: ${this.error}`);
      this.subtitles = status('error', `Subtitle filtering unavailable: ${this.error}`);
      this.scheduler?.setIntervals([]);
      this.restore(this.renderer);
    } finally {
      if (generation === this.generation) {
        this.rebuilding = false;
        this.tick();
      }
    }
  }
  private computeStatuses(): void {
    if (!this.state.settings.enabled) {
      this.audio = status('disabled', 'Audio filtering disabled.');
      this.subtitles = status('disabled', 'Subtitle filtering disabled.');
      return;
    }
    if (this.filterError) {
      this.audio = status('error', `Audio filtering unavailable: ${this.filterError}`);
      this.subtitles = status('error', `Subtitle filtering unavailable: ${this.filterError}`);
      return;
    }
    if (!this.session) {
      this.audio = status(
        'unavailable',
        `Audio filtering unavailable: ${this.error ?? 'current episode and language metadata are not available. Reload the episode to retry.'}`,
      );
    } else if (
      japanese(this.session.audioLanguage) ||
      (!this.session.audioLanguage && this.state.settings.mode === 'japanese')
    ) {
      this.audio = status('disabled', 'Japanese audio is unchanged.');
    } else if (!mayFilterAudio(this.session, this.state)) {
      this.audio = status(
        'unavailable',
        this.session.audioLanguage
          ? 'Audio filtering unavailable: this audio language is unsupported; audio is unchanged.'
          : 'Audio filtering unavailable: audio language unresolved. Select a manual mode if you know the audio language.',
      );
    } else if (!dialogueTrack(this.session)) {
      this.audio = status(
        'unavailable',
        `Audio filtering unavailable: ${this.session.captionIssue ?? 'no English dialogue/CC track for this episode version. Translations and signs tracks cannot time the English dub.'} Try enabling available English CC in the player, then Retry.`,
      );
    } else if (!this.timelineReady) {
      this.audio = status(
        'loading',
        'Loading current media timeline. Audio stays unchanged until fresh media metadata is received.',
      );
    } else if (!this.media || !this.scheduler) {
      this.audio = status(
        'unavailable',
        'Audio filtering unavailable: media controls are not accessible in this player frame.',
      );
    } else
      this.audio = status(
        'active',
        'Matching English CC loaded. Complete caption cues are silenced; surrounding dialogue may also be silenced.',
      );
    const selected = this.session?.tracks.find((track) => track.id === this.renderer?.trackId);
    if (this.rendererProblem) this.subtitles = this.rendererProblem;
    else if (this.subtitleLanguage === 'off')
      this.subtitles = status(
        'disabled',
        'Subtitles are off. Accessible matching CC can still filter English audio.',
      );
    else if (this.subtitleLanguage && !english(this.subtitleLanguage))
      this.subtitles = status(
        'disabled',
        `Non-English subtitles (${this.subtitleLanguage}) are unchanged.`,
      );
    else if (
      this.renderer &&
      selected &&
      english(selected.language) &&
      selected.document.format === (this.renderer.format ?? 'ass')
    )
      this.subtitles = status(
        'active',
        this.renderer.description ??
          `English subtitles filtered before rendering (${selected.language}).`,
      );
    else
      this.subtitles = status(
        'unavailable',
        'Subtitle filtering unavailable: no identified English caption renderer. For the Crunchyroll Bitmovin player, open its Audio and subtitles menu once and select English or English [CC]. Hardcoded subtitles and unsupported renderers remain unchanged.',
      );
  }
  private tick(): void {
    const audioIds = this.scheduler?.tick() ?? [];
    if (this.rebuilding) return;
    const active = this.occurrences.filter(
      (value) =>
        !value.ignored &&
        value.time <= (this.media?.currentTime ?? -1) &&
        value.endTime > (this.media?.currentTime ?? -1),
    );
    const textIds =
      this.subtitles.phase === 'active'
        ? active
            .filter(
              (value) =>
                value.track === this.renderer?.trackId &&
                (!this.renderer.censoredCues || this.renderer.censoredCues().has(value.cue)),
            )
            .map((value) => value.id)
        : [];
    for (const id of [...audioIds, ...textIds]) {
      const log = this.censored.get(id) ?? { audio: false, text: false };
      log.audio ||= audioIds.includes(id);
      log.text ||= textIds.includes(id);
      this.censored.set(id, log);
      if (this.censored.size > LIMITS.occurrences)
        this.censored.delete(this.censored.keys().next().value!);
    }
  }
  seek(id: string): Promise<void> {
    const occurrence = this.occurrences.find((value) => value.id === id);
    if (!this.media || !this.seeker || !occurrence || !this.session)
      throw new Error('This occurrence no longer belongs to the current episode.');
    this.scheduler?.release();
    return this.seeker
      .seek(Math.max(0, occurrence.time - this.state.settings.beforeMs / 1000))
      .then(() => this.tick());
  }
  hasOccurrence(id: string): boolean {
    return this.occurrences.some((value) => value.id === id);
  }
  snapshot(): PlayerSnapshot {
    this.computeStatuses();
    return {
      instance: this.instance,
      episode: this.session?.episode ?? null,
      version: this.session?.version ?? null,
      audioLanguage: this.session?.audioLanguage ?? null,
      subtitleLanguage: this.subtitleLanguage,
      mode: selectedMode(this.session?.audioLanguage ?? null, this.state.settings.mode),
      audio:
        this.rebuilding && this.state.settings.enabled
          ? status('loading', 'Loading local captions…')
          : this.audio,
      subtitles:
        this.rebuilding && this.state.settings.enabled
          ? status('loading', 'Preparing English subtitles…')
          : this.subtitles,
      time: this.media?.currentTime ?? 0,
      occurrences: this.occurrences.slice(0, LIMITS.occurrences).map((value) => ({
        ...value,
        audioCensored: this.censored.get(value.id)?.audio ?? false,
        textCensored: this.censored.get(value.id)?.text ?? false,
      })),
      total: this.occurrences.length,
      trackSummary:
        this.session?.tracks
          .map(
            (track) => `${track.kind} ${track.language} (${track.document.format.toUpperCase()})`,
          )
          .join(', ') ||
        'No usable English caption data. If subtitles are off and data is not accessible, enable English CC/subtitles yourself and retry. Your subtitle preference is never changed.',
    };
  }
}
