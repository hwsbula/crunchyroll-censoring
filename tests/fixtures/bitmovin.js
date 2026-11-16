// Synthetic renderer only. No Bitmovin library, service account, or production
// data is used here. The extension must NOT depend on this fixture's internals.
const video = document.querySelector('video');
const controls = document.querySelector('[data-testid="player-controls-root"]');
const toggle = controls.querySelector('button');
const parameters = new URL(location.href).searchParams;
// Exercise independent renderer timing without changing the source cue times.
const captionDelay = Number(parameters.get('caption-delay') || 0);
let layer = document.querySelector('ul');
let mode = 'english',
  selected = 'English [CC]',
  menuOpen = false;
let cues = [],
  corrupt = false,
  empty = parameters.has('empty'),
  lastKey = '';
let nodes = new Map();
let sequence = 0,
  automaticReads = 0,
  manualMenus = 0;
let redrawTimer = null;
const url = (spanish = false) =>
  `https://www.crunchyroll.com/${spanish ? 'spanish' : 'fixture'}.vtt`;

function audio() {
  const count = 8000 * 12;
  const data = new DataView(new ArrayBuffer(44 + count * 2));
  const write = (at, text) =>
    [...text].forEach((char, index) => data.setUint8(at + index, char.charCodeAt(0)));
  write(0, 'RIFF');
  data.setUint32(4, 36 + count * 2, true);
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
  data.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++)
    data.setInt16(44 + i * 2, Math.sin((i * Math.PI * 440) / 8000) * 500, true);
  return URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
}
async function textTrack(spanish = false) {
  const text = await (await fetch(url(spanish))).text();
  cues = text
    .split(/\n\n/)
    .filter((block) => block.includes('-->'))
    .map((block) => {
      const lines = block.split('\n');
      const index = lines.findIndex((line) => line.includes('-->'));
      const times = lines[index].match(/([\d:.]+)\s+-->\s+([\d:.]+)/);
      const seconds = (time) => time.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
      return {
        start: seconds(times[1]),
        end: seconds(times[2]),
        text: lines
          .slice(index + 1)
          .join('\n')
          .replace(/<[^>]*>/g, ''),
      };
    });
  lastKey = '';
}
function menu() {
  controls.querySelector('[data-fixture-menu-popup]')?.remove();
  toggle.setAttribute('aria-expanded', String(menuOpen));
  if (!menuOpen) return;
  const root = document.createElement('div');
  root.dataset.testid = 'audio-text-track-menu';
  for (const [index, labels] of [
    ['English', 'Japanese'],
    [mode === 'english' ? 'English [CC]' : 'English', 'Spanish', 'None'],
  ].entries()) {
    const group = document.createElement('div');
    group.setAttribute('role', 'menu');
    group.setAttribute(
      'aria-label',
      index ? 'Subtitle and closed caption selection' : 'Audio track selection',
    );
    for (const label of labels) {
      const item = document.createElement('div');
      item.tabIndex = 0;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-label', label);
      item.setAttribute(
        'aria-checked',
        String(
          index
            ? !parameters.has('slow-menu') && !parameters.has('broken-menu') && selected === label
            : (mode === 'english' ? 'English' : 'Japanese') === label,
        ),
      );
      item.textContent = label;
      const select = () => {
        if (!index) {
          void begin(label === 'English' ? 'english' : 'japanese');
          return;
        }
        selected = label;
        document.querySelector('#chosen-subtitle').textContent = selected;
        menu();
        if (label === 'None') {
          cues = [];
          lastKey = '';
        } else void textTrack(label === 'Spanish');
      };
      item.addEventListener('click', select);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });
      group.append(item);
    }
    root.append(group);
  }
  const popup = document.createElement('div');
  popup.dataset.fixtureMenuPopup = '';
  popup.setAttribute('role', 'menu');
  popup.style.background = '#222';
  popup.append(root);
  controls.append(popup);
  if (parameters.has('slow-menu'))
    setTimeout(() => {
      if (popup.isConnected)
        for (const item of root
          .querySelectorAll('[role="menu"]')[1]
          .querySelectorAll('[role="menuitemradio"]'))
          item.setAttribute('aria-checked', String(item.getAttribute('aria-label') === selected));
    }, 250);
}
async function begin(next, continuing = false) {
  mode = next;
  document.querySelector('#fixture-state').textContent = 'Loading';
  selected =
    continuing && document.querySelector('#next-subtitle').value !== 'english'
      ? document.querySelector('#next-subtitle').value === 'spanish'
        ? 'Spanish'
        : 'None'
      : next === 'english'
        ? 'English [CC]'
        : 'English';
  if (continuing) {
    menuOpen = false;
    menu();
  }
  document.querySelector('#chosen-subtitle').textContent = selected;
  cues = [];
  lastKey = '';
  layer.replaceChildren();
  nodes.clear();
  const version = (next === 'japanese' ? 'TESTJA' : 'TESTEN') + (sequence || '');
  await fetch(`/content/v2/cms/objects/${version}?fixture=${next}`);
  await fetch(`/playback/v4/${version}/web/chrome/play?fixture=dom-${next}`);
  video.src = audio();
  await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
  if (!continuing) video.volume = 0.4;
  if (selected !== 'None') await textTrack(selected === 'Spanish');
  menu();
  document.querySelector('#sequence').textContent = String(sequence);
  document.querySelector('#fixture-state').textContent = `Ready: ${next}`;
}
function render() {
  const displayTime = video.currentTime - captionDelay;
  const active = cues.filter((cue) => cue.start <= displayTime && cue.end > displayTime);
  const key = JSON.stringify([active, corrupt, empty]);
  if (key !== lastKey) {
    layer.replaceChildren();
    nodes.clear();
    lastKey = key;
    if (!empty)
      for (const cue of active) {
        const li = document.createElement('li');
        li.style.display = 'inline';
        li.style.whiteSpace = 'pre-line';
        li.style.backgroundColor = 'rgb(0, 0, 0)';
        const text = corrupt ? 'Unassociated damn caption!' : cue.text;
        const parts = text.startsWith('That damn')
          ? ['That da', 'mn class is full of ', 'shit', '!']
          : [text];
        for (const [index, part] of parts.entries()) {
          const span = document.createElement(index === 0 ? 'b' : index === 2 ? 'i' : 'span');
          const node = document.createTextNode(part);
          span.append(node);
          nodes.set(node, part);
          li.append(span);
        }
        layer.append(li);
      }
  } else {
    // Repeated native characterData writes must be filtered before paint,
    // without interpreting our prior redaction as the original text.
    for (const [node, original] of nodes) node.data = original;
  }
  requestAnimationFrame(render);
}
toggle.addEventListener('click', (event) => {
  menuOpen = !menuOpen;
  if (menuOpen) {
    if (event.isTrusted) manualMenus++;
    else automaticReads++;
    document.querySelector('#menu-reads').textContent = String(automaticReads);
    document.querySelector('#manual-menus').textContent = String(manualMenus);
  }
  menu();
});
document.querySelector('#english').addEventListener('click', () => void begin('english'));
document.querySelector('#japanese').addEventListener('click', () => void begin('japanese'));
document.querySelector('#play').addEventListener('click', () => void video.play());
document
  .querySelector('#fullscreen')
  .addEventListener(
    'click',
    () => void document.querySelector('#player-container').requestFullscreen(),
  );
document.querySelector('#prefetch').addEventListener('click', () => void fetch(url(true)));
document.querySelector('#mismatch').addEventListener('click', () => {
  corrupt = !corrupt;
});
document.querySelector('#empty').addEventListener('click', () => {
  empty = !empty;
});
document.querySelector('#replace-layer').addEventListener('click', () => {
  const next = layer.cloneNode(false);
  layer.replaceWith(next);
  layer = next;
  lastKey = '';
});
document.querySelector('#transients').addEventListener('click', () => {
  if (redrawTimer) {
    clearInterval(redrawTimer);
    redrawTimer = null;
    empty = false;
    lastKey = '';
    return;
  }
  redrawTimer = setInterval(() => {
    const next = layer.cloneNode(false);
    layer.replaceWith(next);
    layer = next;
    empty = true;
    lastKey = '';
    setTimeout(() => {
      empty = false;
      lastKey = '';
    }, 400);
  }, 900);
});
video.addEventListener('ended', () => {
  if (!document.querySelector('#autoplay').checked) return;
  sequence++;
  history.pushState({}, '', `/watch/DOMAUTO${sequence}/synthetic-fixture${location.search}`);
  void begin(document.querySelector('#next-audio').value, true).then(() => video.play());
});
requestAnimationFrame(render);
