// Characterize the current clock-contract gaps; NOT acceptance tests for a fix.
// All captions/media below are synthetic. No network or real episode data.
import assert from 'node:assert/strict';
import { parseCaptions } from '../../src/core/captions.ts';
import { dialogueTrack } from '../../src/core/engine.ts';
import { CueScheduler, MuteGate } from '../../src/core/scheduler.ts';
import { MediaSeeker } from '../../src/core/seeker.ts';
import { time } from '../../src/shared/ui.ts';

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
assert.equal(dialogueTrack(session).id, 'FIRST');
const swapped = { ...session, tracks: [...session.tracks].reverse() };
assert.equal(dialogueTrack(swapped).id, 'SECOND');

console.log(
  JSON.stringify(
    {
      evidence: 'Synthetic characterization of 0.1.9; does not establish the live episode cause.',
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
    },
    null,
    2,
  ),
);
