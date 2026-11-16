import type { FilterEngine, Renderer } from '../core/engine.ts';
import { english } from '../core/settings.ts';
import type { FilterStatus, Match, Session, Track } from '../core/types.ts';
import { DisplayCueIndex, redactDisplaySegments, resolveSubtitleLabel } from './caption-display.ts';
import type { SubtitleSelection } from './caption-display.ts';
import { checkedSubtitleLabel, TrackMenuProbe, TRACK_MENU } from './track-menu.ts';

const menuSelector = TRACK_MENU;
const unavailable = (reason: string): FilterStatus => ({
  phase: 'unavailable',
  reason: `Subtitle filtering unavailable: ${reason}`,
});

// This hierarchy and the inline overlay styles were supplied from the user's
// actual Bitmovin player. Do not select arbitrary page text or hide a guessed
// canvas. A changed/ambiguous structure is unsupported until inspected.
function captionLayer(
  video: HTMLVideoElement,
): { container: HTMLElement; layer: HTMLUListElement } | null {
  const media = video.parentElement;
  const container = media?.parentElement;
  if (
    !media?.classList.contains('bitmovinplayer-container') ||
    container?.id !== 'player-container' ||
    !container.querySelector('[data-testid="player-controls-root"]')
  )
    return null;
  const layers: HTMLUListElement[] = [];
  for (const overlay of media.children) {
    if (
      !(overlay instanceof HTMLDivElement) ||
      overlay.style.position !== 'absolute' ||
      overlay.style.pointerEvents !== 'none' ||
      overlay.style.width !== '100%' ||
      overlay.style.height !== '100%'
    )
      continue;
    for (const inner of overlay.children) {
      if (
        !(inner instanceof HTMLDivElement) ||
        inner.style.textAlign !== 'center' ||
        inner.style.position !== 'absolute'
      )
        continue;
      for (const list of inner.children)
        if (
          list instanceof HTMLUListElement &&
          list.style.position === 'absolute' &&
          list.style.listStyleType === 'none'
        )
          layers.push(list);
    }
  }
  return layers.length === 1 ? { container, layer: layers[0]! } : null;
}

interface OriginalNode {
  original: string;
  applied: string;
}
interface Segment {
  node: Text | null;
  text: string;
}

class OverlayRenderer implements Renderer {
  readonly trackId: string;
  readonly language: string;
  readonly format: Track['document']['format'];
  private textTiming = false;
  readonly index: DisplayCueIndex;
  get description(): string {
    return this.textTiming
      ? `English captions filtered by exact text in the selected track (${this.language}). Displayed cue timing differs from the caption file; audio timing and timestamp links still use the file. Check audio synchronization.`
      : `English captions filtered in the identified Bitmovin overlay before browser paint (${this.language}).`;
  }
  private originals = new Map<Text, OriginalNode>();
  private matches: ReadonlyMap<string, readonly Match[]> | null = null;
  private censored = new Set<string>();
  private verified = false;
  private emptySince: number | null = null;
  private mismatchSince: number | null = null;
  private report: (problem: FilterStatus | null) => void;
  readonly layer: HTMLUListElement;
  private video: HTMLVideoElement;
  private track: Track;
  constructor(
    layer: HTMLUListElement,
    video: HTMLVideoElement,
    track: Track,
    report: (problem: FilterStatus | null) => void,
    wasVerified = false,
    index?: DisplayCueIndex,
  ) {
    this.layer = layer;
    this.video = video;
    this.track = track;
    this.trackId = track.id;
    this.language = track.language;
    this.format = track.document.format;
    this.index = index ?? new DisplayCueIndex(track.document.cues);
    this.report = report;
    this.verified = wasVerified;
  }
  apply(_content: string, matches: ReadonlyMap<string, readonly Match[]>): void {
    this.matches = matches;
    this.refresh();
  }
  restore(): void {
    this.matches = null;
    this.censored.clear();
    for (const [node, value] of this.originals)
      if (node.data === value.applied && node.data !== value.original) node.data = value.original;
    this.originals.clear();
  }
  censoredCues(): ReadonlySet<string> {
    return this.censored;
  }
  get needsPolicy(): boolean {
    return this.matches === null;
  }
  get hasVerifiedCue(): boolean {
    return this.verified;
  }
  private segments(): Segment[] {
    const segments: Segment[] = [];
    const present = new Set<Text>();
    let length = 0;
    let visited = 0;
    const visit = (node: Node): void => {
      if (++visited > 512 || length > 32_000) throw new Error('Caption DOM exceeds local limits.');
      if (node instanceof Text) {
        const saved = this.originals.get(node);
        const text = saved && node.data === saved.applied ? saved.original : node.data;
        this.originals.set(node, { original: text, applied: node.data });
        present.add(node);
        segments.push({ node, text });
        length += text.length;
      } else if (node instanceof HTMLElement) {
        if (!/^(UL|LI|DIV|P|SPAN|B|I|U|EM|STRONG|RUBY|RT|BR)$/.test(node.tagName))
          throw new Error('Unsupported caption markup.');
        if (/^(LI|DIV|P|BR)$/.test(node.tagName)) segments.push({ node: null, text: '\n' });
        for (const child of node.childNodes) visit(child);
      }
    };
    visit(this.layer);
    for (const node of this.originals.keys()) if (!present.has(node)) this.originals.delete(node);
    return segments;
  }
  refresh(): void {
    this.censored.clear();
    if (!this.matches || !this.layer.isConnected) return;
    let segments: Segment[];
    try {
      segments = this.segments();
    } catch {
      this.report(
        unavailable(
          'the caption overlay markup is unsupported. Original captions remain unchanged.',
        ),
      );
      return;
    }
    const displayed = segments.map((part) => part.text).join('');
    const active = this.track.document.cues.filter(
      (cue) => cue.start <= this.video.currentTime && cue.end > this.video.currentTime,
    );
    if (!displayed.trim()) {
      this.mismatchSince = null;
      const hasCue = active.some((cue) => cue.text.trim());
      if (hasCue && this.emptySince === null) this.emptySince = performance.now();
      else if (!hasCue) this.emptySince = null;
      this.report(
        this.emptySince !== null && performance.now() - this.emptySince >= 1500
          ? unavailable(
              'the selected cue is not exposed as caption text in this overlay. If subtitles are visible, the player may be using another rendering path. This does not establish that they are hardcoded.',
            )
          : this.verified && !hasCue
            ? null
            : {
                phase: 'loading',
                reason: 'Waiting for a displayed English cue to verify this caption overlay.',
              },
      );
      return;
    }
    this.emptySince = null;
    const found = this.index.match(displayed, active, this.matches);
    if (found.kind === 'ambiguous') {
      this.report(
        unavailable(
          'displayed captions match multiple cue identities and current timing cannot distinguish them. Original captions remain unchanged.',
        ),
      );
      return;
    }
    if (found.kind === 'missing') {
      this.mismatchSince ??= performance.now();
      this.report(
        performance.now() - this.mismatchSince < 250
          ? {
              phase: 'loading',
              reason: 'Waiting for the current English caption redraw.',
            }
          : unavailable(
              'displayed captions do not match any complete cue in the selected English track, apart from whitespace. Check the selected English/English [CC] track and retry; this text is not filtered.',
            ),
      );
      return;
    }
    this.textTiming = found.timing === 'text';
    this.mismatchSince = null;
    const replacements = redactDisplaySegments(
      segments.map((part) => part.text),
      found.matches,
    );
    for (let i = 0; i < segments.length; i++) {
      const node = segments[i]!.node;
      if (!node) continue;
      const value = replacements[i]!;
      this.originals.get(node)!.applied = value;
      if (node.data !== value) node.data = value;
    }
    if (this.layer.getClientRects().length && getComputedStyle(this.layer).visibility !== 'hidden')
      for (const cue of found.cues)
        if (this.matches.get(cue.key)?.length) this.censored.add(cue.key);
    this.verified = true;
    this.report(null);
  }
}

export class KatamariCaptions {
  private engine: FilterEngine;
  private getSession: () => Session | null;
  private getVideo: () => HTMLVideoElement | null;
  private timelineReady: () => boolean;
  private onAudioChange: () => void;
  private renderer: OverlayRenderer | null = null;
  private container: HTMLElement | null = null;
  private label: string | null = null;
  private pendingLabel: string | null = null;
  private selected: Track | null = null;
  private blockedMenu: Element | null = null;
  private selectionSession: Session | null = null;
  private selectionLabel: string | null = null;
  private selection: SubtitleSelection = { language: null, track: null };
  private probe = new TrackMenuProbe();
  constructor(
    engine: FilterEngine,
    getSession: () => Session | null,
    getVideo: () => HTMLVideoElement | null,
    timelineReady: () => boolean,
    onAudioChange: () => void,
  ) {
    this.engine = engine;
    this.getSession = getSession;
    this.getVideo = getVideo;
    this.timelineReady = timelineReady;
    this.onAudioChange = onAudioChange;
    document.addEventListener('click', this.beforeSelection, true);
    document.addEventListener('keydown', this.beforeSelection, true);
  }
  private release(): void {
    if (this.renderer) this.engine.setRenderer(null);
    this.renderer = null;
    this.selected = null;
  }
  reset(): void {
    this.probe.reset();
    this.release();
    this.container = null;
    this.label = null;
    this.pendingLabel = null;
    this.blockedMenu = null;
    this.selectionSession = null;
    this.selectionLabel = null;
    this.selection = { language: null, track: null };
  }
  dispose(): void {
    this.reset();
    this.probe.dispose();
    document.removeEventListener('click', this.beforeSelection, true);
    document.removeEventListener('keydown', this.beforeSelection, true);
  }
  private beforeSelection = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
    const item =
      event.target instanceof Element ? event.target.closest('[role="menuitemradio"]') : null;
    const menu = item?.closest(menuSelector);
    if (
      !item ||
      !menu ||
      !this.container?.contains(menu) ||
      item.getAttribute('aria-disabled') === 'true' ||
      item.getAttribute('aria-checked') === 'true'
    )
      return;
    const groups = menu.querySelectorAll('[role="menu"]');
    if (groups.length !== 2) return;
    if (groups[0]!.contains(item)) {
      this.onAudioChange();
      return;
    }
    if (!groups[1]!.contains(item)) return;
    this.release();
    this.label = null;
    this.pendingLabel = item.getAttribute('aria-label');
    this.engine.setSubtitleLanguage(null);
    this.engine.setRendererProblem(
      unavailable(
        'waiting for the player to confirm the selected subtitle track. Reopen its Audio and subtitles menu if needed.',
      ),
    );
  };
  retry(): void {
    this.probe.reset();
    this.scan();
  }
  // A request is only an invalidation signal, never evidence of selection:
  // players may prefetch. Our own reads use the saved unwrapped fetch.
  noteRequest(url: string): void {
    const other = this.getSession()?.available?.find((item) => item.requestUrl === url);
    if (
      !other ||
      !this.selected ||
      (other.resource === this.selected.resource &&
        other.language === this.selected.language &&
        other.kind === this.selected.kind &&
        other.format === this.selected.document.format)
    )
      return;
    this.release();
    this.label = null;
    this.probe.reset();
    if (!this.pendingLabel) this.blockedMenu = this.container?.querySelector(menuSelector) ?? null;
    this.engine.setSubtitleLanguage(null);
  }
  scan(): void {
    const video = this.getVideo();
    const session = this.getSession();
    const found = video && captionLayer(video);
    if (!found) {
      if (this.container) this.reset();
      return;
    }
    if (this.container && this.container !== found.container) this.reset();
    this.container = found.container;
    if (!this.engine.enabled) this.probe.reset();
    if (!session || !this.timelineReady()) return;
    const menus = this.container.querySelectorAll(menuSelector);
    if (this.blockedMenu && !this.blockedMenu.isConnected) this.blockedMenu = null;
    if (menus.length === 1 && menus[0] !== this.blockedMenu) {
      const label = checkedSubtitleLabel(menus[0]!);
      if (!this.pendingLabel || this.pendingLabel === label) {
        this.label = label;
        this.pendingLabel = null;
      }
    } else if (menus.length > 1) this.label = null;
    if (!this.label && !this.pendingLabel && !this.blockedMenu && this.engine.enabled) {
      this.probe.start(this.container, (label) => {
        // A canceled probe never invokes this callback. Session reset closes
        // the old operation before another episode can establish selection.
        this.label = label;
      });
    }
    if (this.selectionSession !== session || this.selectionLabel !== this.label) {
      this.selectionSession = session;
      this.selectionLabel = this.label;
      this.selection = this.label
        ? resolveSubtitleLabel(session, this.label)
        : { language: null, track: null };
    }
    const selection = this.selection;
    if (!english(selection.language) || !selection.track) {
      this.release();
      this.engine.setSubtitleLanguage(selection.language);
      this.engine.setRendererProblem(
        selection.language && !english(selection.language)
          ? null
          : this.probe.pending
            ? {
                phase: 'loading',
                reason: 'Checking the current subtitle selection for this episode…',
              }
            : unavailable(
                this.label
                  ? 'the selected subtitle label cannot be associated with one loaded English track. Select an available English [CC] track and retry.'
                  : 'the selected track could not be verified automatically. Open Crunchyroll’s Audio and subtitles menu and confirm English or English [CC], then retry. Your subtitle preference is never changed.',
              ),
      );
      return;
    }
    const track = selection.track;
    if (
      !this.renderer ||
      this.renderer.layer !== found.layer ||
      this.renderer.trackId !== track.id
    ) {
      const wasVerified = this.renderer?.trackId === track.id && this.renderer.hasVerifiedCue;
      const index = this.renderer?.trackId === track.id ? this.renderer.index : undefined;
      this.release();
      this.selected = track;
      this.renderer = new OverlayRenderer(
        found.layer,
        video!,
        track,
        (problem) => this.engine.setRendererProblem(problem),
        wasVerified,
        index,
      );
      this.engine.setRendererProblem(null);
      this.engine.setRenderer(this.renderer);
    } else if (this.renderer.needsPolicy && this.engine.enabled) {
      // Rules may have changed while the overlay was waiting/mismatched. Re-arm
      // from the engine's new original-cue analysis, never a stale local policy.
      this.engine.setRendererProblem(null);
      this.engine.setRenderer(this.renderer);
    } else this.renderer.refresh();
  }
}
