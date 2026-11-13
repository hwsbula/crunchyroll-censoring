// Synthetic player for exercising the documented renderer contract. This is not
// Crunchyroll code and is never bundled into the extension.
const video = document.querySelector('video');
const caption = document.querySelector('#fixture-caption');
let renderer = null;
let mode = 'english';
class FixtureOctopus {
  constructor(options) {
    this.content = options.subContent || '';
    this.options = options;
    if (options.subUrl) this.setTrackByUrl(options.subUrl);
    queueMicrotask(() => options.onReady?.());
    this.timer = setInterval(() => this.render(), 16);
  }
  setTrack(content) {
    this.content = content;
    this.render();
  }
  setTrackByUrl(url) {
    fetch(url)
      .then((r) => r.text())
      .then((text) => {
        this.content = text;
        this.render();
      });
  }
  freeTrack() {
    this.content = '';
    this.render();
  }
  dispose() {
    clearInterval(this.timer);
    caption.textContent = '';
  }
  render() {
    const toTime = (text) => text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
    const cues = this.content
      .split('\n')
      .filter((line) => line.startsWith('Dialogue:'))
      .map((line) => {
        const cells = line.slice(line.indexOf(':') + 1).split(',');
        return {
          start: toTime(cells[1]),
          end: toTime(cells[2]),
          text: cells
            .slice(9)
            .join(',')
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\[Nn]/g, '\n'),
        };
      });
    caption.textContent = cues
      .filter((cue) => cue.start <= video.currentTime && cue.end > video.currentTime)
      .map((cue) => cue.text)
      .join('\n');
  }
}
window.SubtitlesOctopus = FixtureOctopus;
function audio() {
  // Local synthetic WAV; no microphone, remote media, DRM, or account involved.
  const length = 8000 * 12;
  const buffer = new ArrayBuffer(44 + length * 2);
  const data = new DataView(buffer);
  const write = (at, text) => {
    for (let i = 0; i < text.length; i++) data.setUint8(at + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  data.setUint32(4, 36 + length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, 8000, true);
  data.setUint32(28, 16000, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  write(36, 'data');
  data.setUint32(40, length * 2, true);
  // A quiet tone makes the synthetic media genuinely audible when not muted.
  for (let i = 0; i < length; i++)
    data.setInt16(44 + i * 2, Math.sin((i * Math.PI * 2 * 220) / 8000) * 500, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}
async function begin(nextMode) {
  mode = nextMode;
  renderer?.dispose();
  renderer = null;
  const version =
    nextMode === 'japanese' ? 'TESTJA' : nextMode === 'unknown' ? 'TESTUNKNOWN' : 'TESTEN';
  let playback;
  if (location.hostname === 'static.crunchyroll.com')
    playback = {
      captions: {
        'en-US': { url: 'https://www.crunchyroll.com/fixture.ass?signature=synthetic-only' },
      },
    };
  else {
    await fetch(`/content/v2/cms/objects/${version}?fixture=${nextMode}`);
    playback = await (
      await fetch(`/playback/v4/${version}/web/chrome/play?fixture=${nextMode}`)
    ).json();
  }
  video.src = audio();
  await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
  video.volume = 0.4;
  if (nextMode !== 'off' && nextMode !== 'unsupported') {
    const source =
      nextMode === 'spanish'
        ? playback.subtitles['es-ES']
        : nextMode === 'japanese' || nextMode === 'missing'
          ? playback.subtitles['en-US']
          : playback.captions['en-US'];
    if (source) renderer = new window.SubtitlesOctopus({ video, subUrl: source.url });
  }
  if (nextMode === 'unsupported') caption.textContent = 'Uncensored fixture text: damn';
  video.currentTime = 0;
  document.querySelector('#fixture-state').textContent = `Ready: ${mode}`;
}
for (const button of document.querySelectorAll('button[data-mode]'))
  button.addEventListener('click', () => begin(button.dataset.mode));
let sdkEnabled = false,
  sdkSeekPending = false,
  outOfSync = false,
  sdkSeeks = 0;
function sdkSeek(seconds) {
  outOfSync = false;
  sdkSeekPending = true;
  sdkSeeks++;
  document.querySelector('#sdk-seeks').textContent = String(sdkSeeks);
  document.querySelector('#sdk-state').textContent = 'In sync';
  video.currentTime = seconds;
}
video.addEventListener('seeking', () => {
  if (sdkEnabled && !sdkSeekPending) {
    outOfSync = true;
    document.querySelector('#sdk-state').textContent = 'Out of sync';
  }
});
video.addEventListener('seeked', () => {
  sdkSeekPending = false;
});
document.querySelector('#managed-controls').addEventListener('click', () => {
  sdkEnabled = true;
  navigator.mediaSession.setActionHandler('seekto', ({ seekTime }) => sdkSeek(seekTime));
  document.querySelector('#sdk-state').textContent = 'In sync';
});
function playerPlay() {
  if (!outOfSync) return video.play();
}
document.querySelector('#play').addEventListener('click', () => playerPlay());
video.addEventListener('click', () => (video.paused ? playerPlay() : video.pause()));
document
  .querySelector('#fixture-timeline')
  .addEventListener('input', (event) => sdkSeek(Number(event.target.value)));
document
  .querySelector('#fullscreen')
  .addEventListener('click', () => document.querySelector('#fixture-player').requestFullscreen());
document.querySelector('#ad').addEventListener('click', () => {
  video.src = audio();
  document.querySelector('#fixture-state').textContent = 'Synthetic ad transition';
});
document.querySelector('#off').addEventListener('click', () => renderer?.freeTrack());

document
  .querySelector('#restore-subtitles')
  .addEventListener('click', () =>
    renderer?.setTrackByUrl('https://www.crunchyroll.com/fixture.ass?signature=synthetic-only'),
  );
