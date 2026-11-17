import { PlayerSeekRouter } from './seek.ts';
import { KatamariCaptions } from './katamari.ts';
import { CoverageBanner } from './coverage.ts';
import { CaptionDownloadError, CaptionLoader } from './caption-loader.ts';
import { FilterEngine } from '../core/engine.ts';
import type { Renderer } from '../core/engine.ts';
import { parseCaptions } from '../core/captions.ts';
import { freshState, parseState, record } from '../core/settings.ts';
import type { SavedState, Session, Track } from '../core/types.ts';
import {
  SITE_ORIGIN,
  PLAYER_ORIGIN,
  audioMetadata,
  captionResources,
  englishResources,
  episodeId,
  parseSession,
  playbackVersion,
  resourceKey,
  sessionEnvelope,
  selectedSubtitleResource,
} from './metadata.ts';

interface Octopus {
  setTrack(content: string): void;
  setTrackByUrl(url: string): void;
  freeTrack(): void;
  dispose(): void;
}
interface OctopusOptions {
  video?: HTMLVideoElement;
  subUrl?: string;
  subContent?: string;
  [key: string]: unknown;
}
type OctopusConstructor = new (options: OctopusOptions) => Octopus;
type HostWindow = Window & { SubtitlesOctopus?: OctopusConstructor };
const channel = 'quietroll-v1';
const siteChannel = 'quietroll-site-v1';
const originalFetch = window.fetch.bind(window);
let video: HTMLVideoElement | null = null;
const seekRouter = new PlayerSeekRouter(navigator.mediaSession ?? null, () => {
  const videos = [...document.querySelectorAll('video')];
  return videos.length === 1 ? videos[0]! : null;
});
const engine = new FilterEngine(
  {
    ...freshState(),
    settings: { ...freshState().settings, enabled: false },
  },
  (media, seconds) => seekRouter.seek(media, seconds),
);
let state: SavedState | null = null;
let session: Session | null = null;
let token: string | null = null;
let epoch = 0;
let path = location.pathname;
let boundSource: string | null = null;
let pendingSource = false;
let sourceConfirmed = false;
let sourceRevision = 0;
let suspended = false;
let resumeBinding: MediaBinding | null = null;
let preparingUntil = 0;
let readyRenderer: Renderer | null = null;
let captionChangedBeforeSettings = false;
const audioByVersion = new Map<string, string>();
let cachedSession: Session | null = null;
let lastWarning = '';
let warning: HTMLDivElement | null = null;
let observer: MutationObserver | null = null;
const coverageBanner = new CoverageBanner();
const captionLoader = new CaptionLoader((resource, signal) => readCaption(resource.url, signal));
const katamari = new KatamariCaptions(
  engine,
  () => session,
  () => video,
  () => sourceConfirmed && !pendingSource,
  () => {
    invalidate('Audio track changed. Waiting for fresh episode caption metadata.');
    pendingSource = true;
    sourceConfirmed = false;
    engine.setTimelineReady(false);
  },
);

function send(kind: string, payload: unknown, requestId?: string): void {
  if (token)
    window.postMessage(
      { channel, token, kind, payload, ...(requestId ? { requestId } : {}) },
      location.origin,
    );
}
function publish(): void {
  if (suspended) return;
  katamari.scan();
  const snapshot = { ...engine.snapshot(), hasMedia: !!video };
  if (!session && performance.now() < preparingUntil && state?.settings.enabled) {
    snapshot.audio = {
      phase: 'loading',
      reason: 'Loading caption metadata for the current episode…',
    };
    snapshot.subtitles = {
      phase: 'loading',
      reason: 'Preparing the current episode’s subtitle integration…',
    };
  }
  send('snapshot', snapshot);
  if (video?.parentElement) {
    if (!warning) {
      warning = document.createElement('div');
      warning.id = 'quietroll-coverage';
      warning.setAttribute('role', 'status');
      Object.assign(warning.style, {
        position: 'absolute',
        top: '10px',
        left: '10px',
        maxWidth: 'min(440px,90%)',
        zIndex: '2147483647',
        pointerEvents: 'none',
        font: '13px/1.4 system-ui,sans-serif',
        color: '#fff',
        background: '#342510',
        border: '1px solid #ecb85c',
        borderRadius: '6px',
        padding: '8px 10px',
        whiteSpace: 'pre-line',
      });
    }
    const host = document.fullscreenElement;
    const container = host instanceof HTMLElement && host !== video ? host : video.parentElement;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    if (warning.parentElement !== container) container.append(warning);
    const text = coverageBanner.text(snapshot, !!state?.settings.enabled, performance.now());
    if (text !== lastWarning) {
      warning.textContent = text;
      lastWarning = text;
    }
    warning.hidden = !text || !state?.settings.enabled;
  }
}
function relay(): void {
  if (location.origin !== SITE_ORIGIN) return;
  // Only the documented Vilos iframe receives site metadata. No wildcard target.
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[src]')) {
    try {
      const u = new URL(frame.src);
      if (u.origin === PLAYER_ORIGIN && u.pathname === '/vilos-v2/web/vilos/player.html')
        frame.contentWindow?.postMessage(
          {
            channel: siteChannel,
            kind: 'session',
            session: session ? sessionEnvelope(session) : null,
          },
          PLAYER_ORIGIN,
        );
    } catch {
      /* unrelated iframe */
    }
  }
}
function invalidate(reason: string, forward = true, preparing = false): void {
  captionLoader.stop();
  pendingSource = false;
  sourceConfirmed = false;
  engine.setTimelineReady(false);
  preparingUntil = preparing ? performance.now() + 7000 : 0;
  katamari.reset();
  epoch++;
  session = null;
  cachedSession = null;
  readyRenderer = null;
  engine.invalidate(reason);
  if (forward) relay();
  publish();
}
function attachVideo(): void {
  if (suspended) return;
  const candidates =
    location.origin === SITE_ORIGIN && !episodeId(location.href)
      ? []
      : [...document.querySelectorAll('video')].filter((element) => element.isConnected);
  const next = candidates.length === 1 ? candidates[0]! : null;
  if (next === video) return;
  if (video) {
    video.removeEventListener('loadstart', sourceChange);
    video.removeEventListener('emptied', sourceChange);
    video.removeEventListener('loadedmetadata', sourceReady);
  }
  // A page may replace its video while its fresh playback request is in flight.
  // Keep that request's generation, but never reuse a previous episode's cues.
  if ((video && !pendingSource) || candidates.length > 1)
    invalidate(
      'Player changed or multiple media elements were found. Reload the episode to establish a fresh timeline.',
    );
  engine.detach();
  sourceRevision++;
  sourceConfirmed = false;
  engine.setTimelineReady(false);
  warning?.remove();
  warning = null;
  lastWarning = '';
  video = next;
  boundSource = null;
  if (video) {
    engine.attach(video);
    video.addEventListener('loadstart', sourceChange);
    video.addEventListener('emptied', sourceChange);
    video.addEventListener('loadedmetadata', sourceReady);
    // The event may have fired before this element was inserted/observed.
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) sourceReady();
  }
  publish();
}
function sourceChange(): void {
  sourceRevision++;
  sourceConfirmed = false;
  engine.setTimelineReady(false);
  const source = video?.currentSrc || video?.src || '';
  if (!pendingSource && boundSource !== null)
    invalidate(
      'Media source changed (possibly an ad or episode transition). Fresh playback metadata is required; reload the episode after the transition.',
    );
  boundSource = source || null;
}
function sourceReady(): void {
  if (suspended || !video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
  boundSource = video?.currentSrc || video?.src || null;
  if (pendingSource) {
    sourceConfirmed = true;
    if (session) {
      pendingSource = false;
      engine.setTimelineReady(true);
    }
  }
  katamari.scan();
}
interface MediaBinding {
  session: Session;
  video: HTMLVideoElement;
  source: string;
  revision: number;
  renderer: Renderer | null;
  timing: ReturnType<FilterEngine['captureTiming']>;
}
function verifiedBinding(): MediaBinding | null {
  return session && video && sourceConfirmed && !pendingSource && video.readyState >= 1
    ? {
        session,
        video,
        source: video.currentSrc || video.src,
        revision: sourceRevision,
        renderer: readyRenderer,
        timing: engine.captureTiming(),
      }
    : null;
}
function sameCaptions(a: Session, b: Session): boolean {
  return (
    a.episode === b.episode &&
    a.version === b.version &&
    a.audioLanguage === b.audioLanguage &&
    a.tracks.length === b.tracks.length &&
    a.tracks.every((track, index) => {
      const other = b.tracks[index]!;
      return (
        track.id === other.id &&
        track.document.original === other.document.original &&
        JSON.stringify(track.timeline) === JSON.stringify(other.timeline)
      );
    })
  );
}
function restoreUnchangedBinding(
  previous: MediaBinding | null,
  next: Session,
  generation: number,
): void {
  if (!previous || !sameCaptions(previous.session, next)) return;
  // Allow the caller of fetch to start a media reload first. A metadata-only
  // refresh has no new loadedmetadata event; only the exact verified binding
  // can be restored. Any intervening media event invalidates this fallback.
  setTimeout(() => {
    if (
      !suspended &&
      epoch === generation &&
      session === next &&
      pendingSource &&
      video === previous.video &&
      sourceRevision === previous.revision &&
      (video.currentSrc || video.src) === previous.source &&
      video.readyState >= 1
    ) {
      engine.restoreTiming(previous.timing);
      sourceReady();
      if (previous.renderer) {
        readyRenderer = previous.renderer;
        engine.setRenderer(previous.renderer);
      }
    }
  }, 100);
}
function setSession(next: Session): void {
  preparingUntil = 0;
  katamari.reset();
  session = next;
  cachedSession = next;
  engine.setSession(next);
  engine.setTimelineReady(sourceConfirmed);
  pendingSource = !sourceConfirmed;
  boundSource = video?.currentSrc || video?.src || null;
  readyRenderer = null;
  relay();
  publish();
}
async function readCaption(url: string, signal: AbortSignal): Promise<string> {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) abort.abort();
  const timeout = setTimeout(() => abort.abort(), 5000);
  try {
    // Only HTTPS URLs supplied in the player's own successful English-track
    // metadata reach here. This is an ordinary page-context CORS request.
    const response = await originalFetch(url, { credentials: 'omit', signal: abort.signal });
    if (!response.ok)
      throw new CaptionDownloadError(response.status === 429 || response.status >= 500);
    if (Number(response.headers.get('content-length') ?? 0) > 3_000_000 || !response.body)
      throw new CaptionDownloadError(false);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 3_000_000) {
        await reader.cancel();
        throw new CaptionDownloadError(false);
      }
      chunks.push(part.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(buffer);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}
async function observeResponse(
  value: unknown,
  requestEpoch: number,
  version: string | null,
  previous: MediaBinding | null,
): Promise<void> {
  if (version && requestEpoch !== epoch) return;
  if (version) {
    const episode = episodeId(location.href);
    if (!episode) return;
    const available = captionResources(value, false).map((resource) => ({
      resource: resourceKey(resource.url),
      requestUrl: resource.url,
      language: resource.language,
      format: resource.format,
      kind: resource.kind,
    }));
    const next = await captionLoader.start(
      episode,
      version,
      audioByVersion.get(version) ?? null,
      englishResources(value),
      (recovered) => {
        if (suspended || requestEpoch !== epoch || !session || episodeId(location.href) !== episode)
          return;
        recovered.available = available;
        recovered.audioLanguage = audioByVersion.get(version) ?? session.audioLanguage;
        if (sameCaptions(session, recovered) && session.captionIssue === recovered.captionIssue)
          return;
        // Retain a working selected overlay while an unrelated English track
        // recovers. Resetting it would expose original text during re-analysis.
        session = recovered;
        cachedSession = recovered;
        engine.updateMetadata(recovered);
        restoreUnchangedBinding(previous, recovered, requestEpoch);
        relay();
        publish();
      },
    );
    if (requestEpoch === epoch && episodeId(location.href) === episode) {
      next.available = available;
      setSession(next);
      await engine.rebuild();
      restoreUnchangedBinding(previous, next, requestEpoch);
    }
  } else {
    for (const [id, audio] of audioMetadata(value)) audioByVersion.set(id, audio);
    while (audioByVersion.size > 20) audioByVersion.delete(audioByVersion.keys().next().value!);
    if (session && audioByVersion.has(session.version)) {
      session = { ...session, audioLanguage: audioByVersion.get(session.version)! };
      cachedSession = session;
      engine.updateMetadata(session);
      relay();
    }
  }
}
// Do not invent or call a playback/auth endpoint. Observe only page-initiated
// successful responses on source-inspected endpoint shapes.
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  checkNavigation();
  const url = input instanceof Request ? input.url : new URL(String(input), location.href).href;
  katamari.noteRequest(url);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const version = method.toUpperCase() === 'GET' ? playbackVersion(url) : null;
  const previous = version ? verifiedBinding() : null;
  if (version) {
    invalidate('Loading current episode caption metadata.', true, true);
    pendingSource = true;
    sourceConfirmed = false;
    engine.setTimelineReady(false);
  }
  const requestEpoch = epoch;
  let response: Response;
  try {
    response = await originalFetch(input, init);
  } catch (error) {
    if (version && requestEpoch === epoch) {
      preparingUntil = 0;
      publish();
    }
    throw error;
  }
  const u = new URL(url);
  const metadata =
    u.origin === SITE_ORIGIN && /^\/content\/v2\/cms\/objects(?:\/|$)/.test(u.pathname);
  if (response.ok && (version || metadata)) {
    try {
      const clone = response.clone();
      if (Number(clone.headers.get('content-length') ?? 0) <= 3_000_000)
        await observeResponse((await clone.json()) as unknown, requestEpoch, version, previous);
    } catch {
      /* Truthful unavailable state remains; do not alter playback. */
    }
  }
  if (version && requestEpoch === epoch && !session) {
    preparingUntil = 0;
    publish();
  }
  return response;
};

function trackFor(url: unknown): Track | null {
  if (typeof url !== 'string' || !session) return null;
  try {
    const exact = new URL(url, location.href).href;
    const selected = selectedSubtitleResource(session, exact);
    if (!selected) return null;
    return (
      session.tracks.find(
        (track) =>
          track.resource === selected.resource &&
          track.language === selected.language &&
          track.kind === selected.kind &&
          track.document.format === 'ass',
      ) ?? null
    );
  } catch {
    return null;
  }
}
function contentFor(track: Track): string {
  return engine.preparedContent(track) ?? track.document.original;
}
function subtitleLanguage(url: unknown): string | null {
  if (typeof url !== 'string' || !session) return null;
  try {
    return selectedSubtitleResource(session, new URL(url, location.href).href)?.language ?? null;
  } catch {
    return null;
  }
}
function wrapInstance(instance: Octopus, initial: Track | null): (ready: boolean) => void {
  const originalSet = instance.setTrack?.bind(instance);
  const originalUrl = instance.setTrackByUrl?.bind(instance);
  const originalFree = instance.freeTrack?.bind(instance);
  const originalDispose = instance.dispose?.bind(instance);
  if (!originalSet || !originalUrl || !originalFree || !originalDispose) return () => undefined;
  let current = initial;
  let rendererReady = false;
  let attached: Renderer | null = null;
  const select = (track: Track | null): void => {
    current = track;
    if (!track) {
      if (readyRenderer === attached) {
        readyRenderer = null;
        engine.setRenderer(null, false);
      }
      attached = null;
      return;
    }
    if (!rendererReady) return;
    const original = track.document.original;
    const renderer: Renderer = {
      trackId: track.id,
      language: track.language,
      apply: (content) => originalSet(content),
      restore: () => originalSet(original),
    };
    attached = renderer;
    readyRenderer = renderer;
    engine.setRenderer(renderer);
  };
  select(initial);
  instance.setTrackByUrl = function (url: string): void {
    const track = trackFor(url);
    select(null);
    engine.setSubtitleLanguage(subtitleLanguage(url));
    if (track && state && engine.preparedContent(track) !== null) {
      originalSet(contentFor(track));
      select(track);
    } else originalUrl(url);
    publish();
  };
  instance.setTrack = function (content: string): void {
    select(null);
    engine.setSubtitleLanguage(null);
    originalSet(content);
    publish();
  };
  instance.freeTrack = function (): void {
    select(null);
    engine.setSubtitleLanguage('off');
    originalFree();
    publish();
  };
  instance.dispose = function (): void {
    if (current) select(null);
    originalDispose();
    publish();
  };
  return (ready: boolean): void => {
    rendererReady = ready;
    const track = current;
    select(null);
    if (ready) {
      engine.setRendererProblem(null);
      select(track);
    }
    publish();
  };
}
function wrapConstructor(original: OctopusConstructor): OctopusConstructor {
  return new Proxy(original, {
    construct(target, args, newTarget) {
      const options = record(args[0]) as OctopusOptions;
      attachVideo();
      const candidate = options.video === video ? trackFor(options.subUrl) : null;
      const track = candidate && engine.preparedContent(candidate) !== null ? candidate : null;
      let nextOptions = options;
      let isReady = false;
      let onReady: ((ready: boolean) => void) | null = null;
      if (track && state) {
        nextOptions = { ...options, subContent: contentFor(track) };
        delete nextOptions.subUrl;
      } else if (track) captionChangedBeforeSettings = true;
      const oldReady = options.onReady,
        oldError = options.onError;
      nextOptions = {
        ...nextOptions,
        onReady: function (this: unknown, ...args: unknown[]) {
          isReady = true;
          onReady?.(true);
          if (typeof oldReady === 'function') Reflect.apply(oldReady, this, args);
        },
        onError: function (this: unknown, ...args: unknown[]) {
          isReady = false;
          onReady?.(false);
          engine.setRendererProblem({
            phase: 'error',
            reason:
              'Subtitle filtering unavailable: the player subtitle renderer reported an error. Reload the player to restore subtitles.',
          });
          if (typeof oldError === 'function') Reflect.apply(oldError, this, args);
          publish();
        },
      };
      if (track && state)
        engine.setRendererProblem({
          phase: 'loading',
          reason: 'Preparing the English subtitle renderer…',
        });
      const instance = Reflect.construct(target, [nextOptions], newTarget) as Octopus;
      // An unrecognized or late renderer stays unavailable; do not pretend that
      // an already visible original layer was censored without exposure.
      onReady = wrapInstance(instance, track && state ? track : null);
      if (isReady) onReady(true);
      engine.setSubtitleLanguage(track?.language ?? subtitleLanguage(options.subUrl));
      publish();
      return instance;
    },
  });
}
function interceptRenderer(): void {
  const host = window as HostWindow;
  const descriptor = Object.getOwnPropertyDescriptor(host, 'SubtitlesOctopus');
  if (descriptor && !descriptor.configurable) return;
  let value = host.SubtitlesOctopus;
  if (value) value = wrapConstructor(value);
  Object.defineProperty(host, 'SubtitlesOctopus', {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => value,
    set: (next: unknown) => {
      value = typeof next === 'function' ? wrapConstructor(next as OctopusConstructor) : undefined;
    },
  });
}
async function retry(): Promise<void> {
  await captionLoader.retry();
  katamari.retry();
  if (cachedSession && session && cachedSession.version === session.version) {
    engine.update(state ?? freshState());
    if (readyRenderer) engine.setRenderer(readyRenderer);
    await engine.rebuild();
  } else
    engine.invalidate(
      'No current caption data. Reload the episode with English CC/subtitles selected. No subtitle preference was changed.',
    );
  if (captionChangedBeforeSettings) engine.setRenderer(null);
  publish();
}
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (
    event.source === window.parent &&
    window.parent !== window &&
    event.origin === SITE_ORIGIN &&
    location.origin === PLAYER_ORIGIN
  ) {
    try {
      const message = record(event.data);
      if (message.channel !== siteChannel || message.kind !== 'session') return;
      if (message.session === null) {
        invalidate(
          'Episode or playback track changed. Waiting for fresh caption data.',
          false,
          true,
        );
        pendingSource = true;
        sourceConfirmed = false;
        engine.setTimelineReady(false);
        return;
      }
      const next = parseSession(message.session);
      const generation = ++epoch;
      void Promise.all(
        next.tracks.map(async (track) => ({
          ...track,
          document: await parseCaptions(track.document.original, track.document.format),
        })),
      )
        .then((tracks) => {
          if (generation === epoch) {
            if (
              session?.version === next.version &&
              session.episode === next.episode &&
              session.tracks.map((t) => t.id + t.document.original).join(',') ===
                tracks.map((t) => t.id + t.document.original).join(',')
            ) {
              session = { ...next, tracks };
              cachedSession = session;
              engine.updateMetadata(session);
            } else setSession({ ...next, tracks });
          }
        })
        .catch(() => invalidate('The caption data received from the player was invalid.', false));
    } catch {
      /* Untrusted cross-frame input ignored. */
    }
    return;
  }
  if (event.source !== window || event.origin !== location.origin) return;
  try {
    const message = record(event.data);
    if (message.channel !== channel) return;
    if (
      message.kind === 'init' &&
      typeof message.token === 'string' &&
      /^[a-f0-9-]{36}$/.test(message.token)
    ) {
      if (token && message.token !== token) return;
      token = message.token;
      state = parseState(message.payload);
      engine.update(state);
      publish();
      return;
    }
    if (!token || message.token !== token) return;
    if (message.kind === 'settings') {
      state = parseState(message.payload);
      engine.update(state);
      publish();
      return;
    }
    if (
      message.kind === 'command' &&
      typeof message.requestId === 'string' &&
      message.requestId.length <= 80
    ) {
      const command = record(message.payload);
      const requestId = message.requestId;
      if (
        command.instance !== engine.instance ||
        command.episode !== (session?.episode ?? null) ||
        command.version !== (session?.version ?? null)
      )
        throw new Error('Player changed. Refresh the popup.');
      if (command.action === 'seek' && typeof command.id === 'string') {
        void engine.seek(command.id).then(
          () => {
            send('response', { ok: true }, requestId);
            publish();
          },
          () =>
            send(
              'response',
              {
                ok: false,
                error: 'The player could not complete the seek. Use its timeline, then retry.',
              },
              requestId,
            ),
        );
        return;
      } else if (command.action === 'timing' && typeof command.id === 'string') {
        engine.correctAudioTiming(command.id, command.offset);
      } else if (command.action === 'retry') {
        void retry().then(() => send('response', { ok: true }, requestId));
        return;
      } else if (command.action === 'validate' && typeof command.id === 'string') {
        if (!engine.hasOccurrence(command.id)) throw new Error('Occurrence no longer exists.');
      } else throw new Error('Invalid player action.');
      send('response', { ok: true }, requestId);
      publish();
    }
  } catch {
    const message = event.data as { requestId?: unknown };
    if (typeof message?.requestId === 'string')
      send(
        'response',
        { ok: false, error: 'Player state changed or the command was invalid. Refresh and retry.' },
        message.requestId,
      );
  }
});
interceptRenderer();
function start(): void {
  observer?.disconnect();
  attachVideo();
  const seen = new WeakSet<HTMLIFrameElement>();
  observer = new MutationObserver(() => {
    attachVideo();
    // Mutation callbacks run in the microtask checkpoint before browser paint.
    // The adapter touches only the source-inspected caption overlay and only
    // after identifying its selected track. It never polls visible text later.
    katamari.scan();
    for (const frame of document.querySelectorAll('iframe'))
      if (!seen.has(frame)) {
        seen.add(frame);
        relay();
      }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-checked', 'aria-label', 'aria-expanded'],
  });
  if (window.parent !== window && location.origin === PLAYER_ORIGIN)
    window.parent.postMessage({ channel: siteChannel, kind: 'ready' }, SITE_ORIGIN);
}
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.origin === PLAYER_ORIGIN && location.origin === SITE_ORIGIN) {
    try {
      const raw = record(event.data);
      if (
        raw.channel === siteChannel &&
        raw.kind === 'ready' &&
        [...document.querySelectorAll('iframe')].some(
          (frame) => frame.contentWindow === event.source,
        )
      )
        relay();
    } catch {
      /* ignore */
    }
  }
});
if (document.documentElement) start();
else document.addEventListener('DOMContentLoaded', start, { once: true });
function checkNavigation(): void {
  if (path !== location.pathname) {
    path = location.pathname;
    audioByVersion.clear();
    invalidate('Episode navigation detected. Waiting for fresh playback metadata.', true, true);
    attachVideo();
  }
}
setInterval(() => {
  if (suspended) return;
  checkNavigation();
  if (video && !video.isConnected) attachVideo();
  publish();
}, 500);
window.addEventListener('pagehide', (event: PageTransitionEvent) => {
  resumeBinding = event.persisted ? verifiedBinding() : null;
  suspended = true;
  captionLoader.stop();
  // Keep only a completed, verified binding across a cached-page restore.
  if (!resumeBinding) invalidate('Waiting for fresh playback metadata after navigation.');
  if (event.persisted) katamari.pause();
  else katamari.dispose();
  engine.detach();
  observer?.disconnect();
  warning?.remove();
});
window.addEventListener('pageshow', (event: PageTransitionEvent) => {
  if (!event.persisted || !suspended) return;
  suspended = false;
  checkNavigation();
  const saved = resumeBinding;
  resumeBinding = null;
  if (
    saved &&
    video === saved.video &&
    video.isConnected &&
    session === saved.session &&
    (video.currentSrc || video.src) === saved.source &&
    sourceRevision === saved.revision &&
    video.readyState >= 1
  ) {
    engine.attach(video);
    engine.setTimelineReady(true);
    if (readyRenderer) engine.setRenderer(readyRenderer);
  } else
    invalidate('Player changed while this page was cached. Waiting for fresh playback metadata.');
  start();
  // Even an unverified restored player needs its scheduler/listeners attached
  // so a later fresh playback response can recover it. Timeline remains false.
  if (video) engine.attach(video);
  publish();
});
window.postMessage({ channel, kind: 'hello' }, location.origin);
// Retry the handshake because MAIN/ISOLATED script ordering is not a contract.
setTimeout(() => window.postMessage({ channel, kind: 'hello' }, location.origin), 100);
