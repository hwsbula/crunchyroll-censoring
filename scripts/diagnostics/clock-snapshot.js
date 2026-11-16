// Paste into DevTools Console while the reported line is visible, preferably paused.
// Read-only: no requests, storage, playback changes, SDK hooks or transcript export.
// Select the player frame in DevTools if this document does not contain the video.
(() => {
  const doc = globalThis.document;
  const videos = [...doc.querySelectorAll('video')];
  if (videos.length !== 1)
    return JSON.stringify({
      videoCount: videos.length,
      error: 'Select the document with one active player video.',
    });
  const video = videos[0];
  const root = video.closest('#player-container');
  const clocks = root ? [...root.querySelectorAll('[data-testid="timestamp"]')] : [];
  const sliders = root ? [...root.querySelectorAll('input.timeline-slider')] : [];
  const clockText = clocks.length === 1 ? clocks[0].textContent?.trim() : '';
  const clock = /^(\d{1,3}:\d{2}(?::\d{2})?)\s*\/\s*(\d{1,3}:\d{2}(?::\d{2})?)$/.exec(
    clockText ?? '',
  );
  const seconds = (s) => s.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  const numeric = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const sliderValue = sliders.length === 1 ? sliders[0].getAttribute('aria-valuenow') : null;
  const shown = clock ? seconds(clock[1]) : null;
  const raw = numeric(video.currentTime);
  const report = {
    schema: 'crunchyroll-clock-check-v1',
    videoCount: 1,
    mediaSeconds: raw,
    playerDisplayedSeconds: shown,
    playerSliderSeconds:
      sliderValue !== null && sliderValue.trim() ? numeric(Number(sliderValue)) : null,
    displayedMinusMediaSeconds:
      shown !== null && raw !== null ? Math.round((shown - raw) * 1000) / 1000 : null,
    mediaDurationSeconds: numeric(video.duration),
    playerDurationSeconds: clock ? seconds(clock[2]) : null,
    paused: video.paused,
    seeking: video.seeking,
    readyState: video.readyState,
    playbackRate: video.playbackRate,
    muted: video.muted,
    nativeTracks: [...video.textTracks].slice(0, 12).map((track) => ({
      language: /^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(track.language) ? track.language : null,
      kind: track.kind,
      mode: track.mode,
      loadedCueCount: track.cues?.length ?? null,
      activeCueTimes: [...(track.activeCues ?? [])].slice(0, 8).map((cue) => ({
        start: numeric(cue.startTime),
        end: numeric(cue.endTime),
      })),
    })),
    note: 'One instant only. DOM clock may be rounded or stale. Missing native cues does not mean captions are unavailable. No offset was inferred or applied.',
  };
  return JSON.stringify(report, null, 2);
})();
