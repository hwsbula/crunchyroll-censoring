export type Mode = 'auto' | 'english' | 'japanese';
export type Phase = 'loading' | 'active' | 'unavailable' | 'disabled' | 'error';
export interface FilterStatus {
  phase: Phase;
  reason: string;
}
export interface Settings {
  enabled: boolean;
  mode: Mode;
  reveal: boolean;
  beforeMs: number;
  afterMs: number;
  custom: string[];
  disabledBuiltins: string[];
}
export interface SavedState {
  version: 1;
  revision: number;
  settings: Settings;
  exceptions: string[];
}
export interface Cue {
  key: string;
  start: number;
  end: number;
  text: string;
  line: number;
  sourceText: string;
  textOffset: number;
  map: Array<[number, number]>;
}
export interface CaptionDocument {
  format: 'ass' | 'vtt';
  original: string;
  lines: string[];
  cues: Cue[];
}
export interface Track {
  id: string;
  resource: string;
  version: string;
  language: string;
  kind: 'captions' | 'subtitles';
  document: CaptionDocument;
}
export interface Session {
  episode: string;
  version: string;
  audioLanguage: string | null;
  tracks: Track[];
  captionIssue?: string;
  available?: Array<{
    resource: string;
    requestUrl: string;
    language: string;
    format: string;
    kind: Track['kind'];
  }>;
}
export interface Match {
  start: number;
  end: number;
  term: string;
}
export interface Occurrence extends Match {
  id: string;
  track: string;
  cue: string;
  time: number;
  endTime: number;
  text: string;
  ignored: boolean;
  audioCensored: boolean;
  textCensored: boolean;
  timingUnreliable?: boolean;
  playbackTime?: number | null;
}
export interface PlayerSnapshot {
  instance: string;
  episode: string | null;
  version: string | null;
  audioLanguage: string | null;
  subtitleLanguage: string | null;
  mode: string;
  audio: FilterStatus;
  subtitles: FilterStatus;
  time: number;
  occurrences: Occurrence[];
  total: number;
  trackSummary: string;
  audioTiming?: { track: string | null; offset: number };
}
