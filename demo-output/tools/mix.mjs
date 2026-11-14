// Lay the eight narration clips on one timeline, and emit the plan the capture run and the
// composition both read. The film's order is not the order the lines were written in: the
// settlement beat sits where the page puts it, so the walkthrough only ever scrolls forward.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname; // demo-output/
const WORK = ROOT + '.capture/'; // intermediates: frames and per-take segments
const NARR = ROOT + 'narration/';
const OUT = ROOT + 'narration.wav';

// beat -> narration clip, and the gap of silence that follows the clip before the next beat
const BEATS = [
  { id: 'b1', clip: 's1', gap: 0.9, label: 'The farmer' },
  { id: 'b2', clip: 's2', gap: 0.9, label: '45 seasons of rainfall' },
  { id: 'b3', clip: 's3', gap: 0.8, label: 'Her terms' },
  { id: 'b4', clip: 's9', gap: 1.2, label: 'Her own wallet' },
  { id: 'b5', clip: 's4', gap: 1.0, label: 'Five sealed bids' },
  { id: 'b6', clip: 's5', gap: 0.9, label: 'Why a market' },
  { id: 'b7', clip: 's7', gap: 2.8, label: 'Settlement' },
  { id: 'b8', clip: 's6', gap: 2.8, label: '15 seasons backtested' },
  { id: 'b9', clip: 's8', gap: 0.0, label: 'Live on NEAR testnet' },
];

const LEAD = 2.6; // the title card sits over the held hero before anyone speaks
const TAIL = 3.2; // room for the closing card after the last word

const dur = (f) =>
  Number(
    execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f,
    ]).toString().trim(),
  );

let t = LEAD;
const beats = {};
const timeline = [];
for (const b of BEATS) {
  const d = dur(`${NARR}${b.clip}.wav`);
  beats[b.id] = +t.toFixed(2);
  timeline.push({ ...b, start: +t.toFixed(2), dur: +d.toFixed(2), end: +(t + d).toFixed(2) });
  t += d + b.gap;
}
const total = +(t + TAIL).toFixed(2);

// One narration track: each clip delayed to its start, summed without re-normalising, then
// loudness-matched to a broadcast speech target so it sits consistently under the picture.
const inputs = [];
const filters = [];
timeline.forEach((b, i) => {
  inputs.push('-i', `${NARR}${b.clip}.wav`);
  const ms = Math.round(b.start * 1000);
  filters.push(`[${i}:a]adelay=${ms}|${ms}[a${i}]`);
});
const mix = `${timeline.map((_, i) => `[a${i}]`).join('')}amix=inputs=${timeline.length}:normalize=0[sum]`;
const post = `[sum]loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur=${total}[out]`;

execFileSync(
  'ffmpeg',
  [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputs,
    '-filter_complex', [...filters, mix, post].join(';'),
    '-map', '[out]', '-ar', '48000', '-ac', '2',
    OUT,
  ],
  { stdio: 'inherit' },
);

const plan = { beats, timeline, lead: LEAD, tail: TAIL, total };
writeFileSync(ROOT + 'plan.json', JSON.stringify(plan, null, 1));
console.log(JSON.stringify(plan, null, 1));
console.log('narration', OUT, dur(OUT).toFixed(2) + 's');
