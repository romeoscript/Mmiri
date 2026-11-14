// Turn one take's frames into a segment of exactly its allotted length.
//
// CDP emits a frame only when the page changes, so a three-second hold is one frame with a
// three-second life. Writing each frame's measured lifetime into a concat list and resampling
// to constant 30fps keeps holds held and motion smooth. The segment is then cut (or its last
// frame extended) to the film-time span the take was shot for, so the takes butt together
// against the narration without drift.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const take = (process.argv[2] ?? 'A').toUpperCase();
const ROOT = new URL('../', import.meta.url).pathname; // demo-output/
const WORK = ROOT + '.capture/'; // intermediates: frames and per-take segments
const DIR = `${WORK}frames-${take}/`;
const OUT = `${WORK}seg-${take}.mp4`;
const keep = process.argv.includes('--keep-frames');

const { frames, span } = JSON.parse(readFileSync(DIR + 'index.json', 'utf8'));
if (frames.length < 2) throw new Error(`take ${take}: only ${frames.length} frames`);

const target = +(span.to - span.from).toFixed(3);
const recorded = frames.at(-1).t - frames[0].t;

const lines = ['ffconcat version 1.0'];
for (let i = 0; i < frames.length; i++) {
  const next = frames[i + 1]?.t ?? frames[i].t + 1 / 30;
  lines.push(`file '${frames[i].name}'`, `duration ${Math.max(1 / 240, next - frames[i].t).toFixed(5)}`);
}
// hold the final frame long enough that the segment can never come up short of its span
lines.push(`file '${frames.at(-1).name}'`, `duration ${Math.max(0.5, target - recorded + 1).toFixed(3)}`);
lines.push(`file '${frames.at(-1).name}'`);
writeFileSync(DIR + 'list.txt', lines.join('\n') + '\n');

console.log(
  `take ${take}: ${frames.length} frames, recorded ${recorded.toFixed(2)}s, target ${target.toFixed(2)}s, mean ${(frames.length / recorded).toFixed(1)} fps`,
);

execFileSync(
  'ffmpeg',
  [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', DIR + 'list.txt',
    '-t', String(target),
    '-vf', 'fps=30,format=yuv420p',
    '-c:v', 'libx264', '-crf', '17', '-preset', 'medium',
    '-video_track_timescale', '30000',
    OUT,
  ],
  { stdio: 'inherit' },
);

const got = execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT,
]).toString().trim();
console.log(`wrote ${OUT} (${got}s)`);

if (!keep) rmSync(DIR, { recursive: true, force: true });
