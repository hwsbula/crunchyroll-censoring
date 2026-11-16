// Characterize remaining clock-contract gaps and the repaired source selection.
// All captions/media below are synthetic. No network or real episode data.
import assert from 'node:assert/strict';
import { parseCaptions } from '../../src/core/captions.ts';
import { dialogueTrack } from '../../src/core/engine.ts';
import { CueScheduler, MuteGate } from '../../src/core/scheduler.ts';
import { MediaSeeker } from '../../src/core/seeker.ts';
import { time } from '../../src/shared/ui.ts';
import { englishResources } from '../../src/integration/metadata.ts';

class Media extends EventTarget {
  currentTime = 150.1;
  playbackRate = 1;
  paused = false;
  seeking = false;
  readyState = 4;
  ended = false;
  volume = 0.6;
  #muted = false;
  get muted() {
    return this.#muted;
  }
  set muted(value) {
    this.#muted = value;
  }
}

const text =
  '00:02:30.000 --> 00:02:32.000\nSynthetic first line.\n\n00:08:52.000 --> 00:08:54.000\nSynthetic second line.\n';
const plain = await parseCaptions(`WEBVTT\n\n${text}`, 'vtt');
const mapped = await parseCaptions(
  `WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:1800000\n\n${text}`,
  'vtt',
);
const starts = (doc) => doc.cues.map((cue) => cue.start);
assert.deepEqual(starts(plain), [150, 532]);
assert.deepEqual(starts(mapped), starts(plain));
assert.deepEqual(starts(plain).map(time), ['2:30', '8:52']);

const media = new Media();
const gate = new MuteGate(media);
const scheduler = new CueScheduler(media, gate);
scheduler.setIntervals([{ start: 149.92, end: 152.1, ids: ['synthetic'] }]);
const mutedWithSourceTime = media.muted;
scheduler.setIntervals([{ start: 169.92, end: 172.1, ids: ['synthetic'] }]);
const mutedWithPlus20 = media.muted;
assert.equal(mutedWithSourceTime, true);
assert.equal(mutedWithPlus20, false);
gate.dispose();

// A legitimate SDK seek uses its presentation clock; its media clock is -20.
const seeker = new MediaSeeker(media, (video, requestedPresentationTime) => {
  video.currentTime = requestedPresentationTime - 20;
  video.dispatchEvent(new Event('seeked'));
});
let seekResult;
try {
  await seeker.seek(170);
  seekResult = 'resolved';
} catch (error) {
  seekResult = error.message;
}
assert.match(seekResult, /did not complete/);
assert.equal(media.currentTime, 150);

const cc = (id, language) => ({
  id,
  language,
  version: 'VERSION',
  kind: 'captions',
  resource: 'https://example.test/captions.vtt',
  document: plain,
});
const session = {
  episode: 'SYNTHETIC',
  version: 'VERSION',
  audioLanguage: 'en-US',
  tracks: [cc('FIRST', 'en-GB'), cc('SECOND', 'en-US')],
};
assert.equal(dialogueTrack(session).id, 'SECOND');
const swapped = { ...session, tracks: [...session.tracks].reverse() };
assert.equal(dialogueTrack(swapped).id, 'SECOND');

// The inspected player source prefers stitchedElements[].textTracks over the
// legacy top-level captions collection. This fixture models that observed schema,
// not the live response or a proven meaning of segment.start for caption timing.
const legacyUrl = 'https://example.test/legacy.vtt';
const segmentUrl = 'https://example.test/segment.vtt';
const playback = {
  captions: { 'en-US': { language: 'en-US', format: 'vtt', url: legacyUrl } },
  stitchedElements: [
    {
      type: 'promo',
      start: 0,
      end: 20,
      track: false,
      timeline: true,
      textTracks: [],
      audioTracks: [],
    },
    {
      id: 'synthetic-main',
      type: 'main',
      start: 20,
      end: 1220,
      track: true,
      timeline: true,
      textTracks: [
        {
          role: 'closed_caption',
          format: 'external',
          language: 'en-US',
          externalTextUrl: segmentUrl,
        },
      ],
      audioTracks: [],
    },
  ],
};
const resources = englishResources(playback);
assert.equal(resources.length, 1);
assert.equal(resources[0].url, segmentUrl);
assert.equal(resources[0].timeline.start, 20);
assert.equal(englishResources({ stitchedElements: playback.stitchedElements }).length, 1);
const changedSegmentStart = {
  ...playback,
  stitchedElements: playback.stitchedElements.map((segment) =>
    segment.type === 'main' ? { ...segment, start: 40 } : { ...segment, end: 40 },
  ),
};
assert.equal(englishResources(changedSegmentStart)[0].timeline.start, 40);

console.log(
  JSON.stringify(
    {
      evidence:
        'Synthetic checks of 0.1.10; remaining distinct-clock / WebVTT-map gaps are not supported stitched layouts.',
      parsedPlainStarts: starts(plain),
      parsedMappedStarts: starts(mapped),
      timestampMapIgnored: true,
      formattedTimes: starts(plain).map(time),
      distinctClocks: {
        hypotheticalPlayerTime: 170.1,
        mediaTime: 150.1,
        mutedWithSourceTime,
        mutedWithPlus20,
      },
      seek: {
        requestedPresentationTime: 170,
        reachedMediaTime: media.currentTime,
        result: seekResult,
      },
      multipleEnglishCC: {
        originalOrderSelected: dialogueTrack(session).language,
        reversedOrderSelected: dialogueTrack(swapped).language,
      },
      stitchedElements: {
        extensionSelectedLegacyResource: resources[0].url === legacyUrl,
        mainSegmentResourceSelected: resources.some((resource) => resource.url === segmentUrl),
        segmentOnlyResourceCount: englishResources({ stitchedElements: playback.stitchedElements })
          .length,
        changedSegmentStartAffectsMapping: true,
        automaticOffset: resources[0].timeline.start,
        note: 'Supported contiguous timeline-included promo plus MAIN; actual regression coverage is in stitched.test.ts.',
      },
    },
    null,
    2,
  ),
);
