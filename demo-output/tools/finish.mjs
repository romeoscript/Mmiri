// Put the film together: the captured app, the narration, and the typographic layer.
//
// The overlays are rendered once as alpha PNGs from real HTML in Chrome — same fonts, same
// palette as the product — and composited in a single ffmpeg pass. One encode, no frame
// extraction: the UI text stays as sharp as it was captured, which matters more here than it
// would for photographic footage.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PROJ = new URL('../', import.meta.url).pathname; // demo-output/
const WORK = PROJ + '.capture/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const plan = JSON.parse(readFileSync(PROJ + 'plan.json', 'utf8'));
const { total, timeline } = plan;

const OVL = PROJ + 'overlays/';
mkdirSync(OVL, { recursive: true });

const CHIP_MAX = 5.0;
const CHIP_FADE = 0.45;
const OPEN_DUR = 3.45;
const OPEN_OUT = 2.55;
const CLOSE_IN = 0.85;

const close = { start: +(timeline.at(-1).end - 0.9).toFixed(2) };
close.dur = +(total - close.start).toFixed(2);

const chips = timeline.map((b, i) => ({
  file: `chip-${i}.png`,
  start: +Math.max(0, b.start - 0.3).toFixed(2),
  dur: +Math.min(CHIP_MAX, b.dur + 0.3).toFixed(2),
  label: b.label,
}));

const mark = `<svg viewBox="0 0 32 32"><path d="M16 2C16 2 5 14.4 5 20.6 5 26.3 9.9 31 16 31s11-4.7 11-10.4C27 14.4 16 2 16 2z" fill="none" stroke="#6fc9de" stroke-width="2"/><path d="M8.2 19.8h15.6c.4 2.2-.2 4.4-1.8 6.2-1.7 1.9-4 2.9-6.3 2.9-4.3 0-7.7-3.3-7.5-9.1z" fill="#e3a33c"/></svg>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
@font-face { font-family:'ArchivoExp'; src:url('assets/fonts/archivo-exp-700.woff2') format('woff2'); font-weight:700; font-display:block; }
@font-face { font-family:'ArchivoBody'; src:url('assets/fonts/archivo-500.woff2') format('woff2'); font-weight:500; font-display:block; }
* { box-sizing:border-box; margin:0; }
body { background:transparent; font-family:'ArchivoBody',sans-serif; color:#e8f2f1; }
.card { position:relative; width:1920px; height:1080px; display:flex; flex-direction:column; justify-content:center; padding:0 150px; }
.card.open { background:linear-gradient(90deg, rgba(8,25,31,.90) 0%, rgba(8,25,31,.86) 46%, rgba(8,25,31,.68) 76%, rgba(8,25,31,.54) 100%); }
.card.close { background:rgba(8,25,31,.86); }
.mark { display:flex; align-items:center; gap:22px; margin-bottom:42px; }
.mark svg { width:60px; height:60px; display:block; }
.mark-name { font-family:'ArchivoExp',sans-serif; font-size:56px; letter-spacing:.01em; }
h1 { font-family:'ArchivoExp',sans-serif; font-weight:700; font-size:92px; line-height:1.05; margin:0 0 34px; max-width:1240px; }
.card.close h1 { font-size:84px; max-width:1300px; }
p { font-size:38px; line-height:1.45; margin:0; max-width:1120px; color:#c7dbdd; }
.meta { margin-top:50px; font-size:31px; color:#94afb6; letter-spacing:.01em; }
.meta b { color:#6fc9de; font-weight:500; }
.repo { margin-top:40px; font-size:40px; color:#e8f2f1; }
.chip { display:inline-flex; align-items:center; gap:18px; padding:17px 34px 17px 28px;
  background:rgba(8,25,31,.90); border:1px solid rgba(148,175,182,.30); border-radius:999px; }
.rule { width:34px; height:3px; background:#6fc9de; border-radius:2px; flex:none; }
.chip-text { font-size:32px; line-height:1; white-space:nowrap; }
.row { padding:8px 0; }
</style></head>
<body>
<div class="card open" id="open">
  <div class="mark">${mark}<span class="mark-name">Mmiri</span></div>
  <h1>Rainfall cover,<br />priced by a market</h1>
  <p>Index insurance for smallholder farmers — auctioned between underwriter agents, settled from NASA's rainfall record.</p>
  <div class="meta">Live on <b>NEAR testnet</b> · market.mmiri-demo.testnet</div>
</div>
<div class="card close" id="close">
  <div class="mark">${mark}<span class="mark-name">Mmiri</span></div>
  <h1>Nobody files a claim.</h1>
  <p>The contracts, the five agents, the TEE oracle and the backtest all run from a clean clone.</p>
  <div class="repo">github.com/romeoscript/Mmiri</div>
  <div class="meta">Built at <b>NEAR HACKATHON</b></div>
</div>
${chips.map((c, i) => `<div class="row"><span class="chip" id="chip-${i}"><span class="rule"></span><span class="chip-text">${c.label}</span></span></div>`).join('\n')}
</body></html>`;

writeFileSync(PROJ + 'overlays.html', html);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ['--hide-scrollbars', '--allow-file-access-from-files', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.goto('file://' + PROJ + 'overlays.html', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

await (await page.$('#open')).screenshot({ path: OVL + 'open.png', omitBackground: true });
await (await page.$('#close')).screenshot({ path: OVL + 'close.png', omitBackground: true });
for (const [i, c] of chips.entries()) {
  await (await page.$(`#chip-${i}`)).screenshot({ path: OVL + c.file, omitBackground: true });
}
await browser.close();
console.log(`overlays: ${chips.length + 2} png`);

// --- composite -------------------------------------------------------------
const VIDEO = WORK + 'screencast.mp4';
const AUDIO = PROJ + 'narration.wav';
const OUT = PROJ + 'mmiri-demo.mp4';

// join the three takes if that has not been done already; they share encoder settings, so
// the concat is a stream copy and costs nothing in quality
if (!existsSync(VIDEO)) {
  const list = WORK + 'segs.txt';
  writeFileSync(list, ['A', 'T', 'B', 'C'].map((t) => `file 'seg-${t}.mp4'`).join('\n') + '\n');
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-y', VIDEO],
    { stdio: 'inherit' },
  );
}

const inputs = ['-i', VIDEO];
// CDP's screencast emits CSS pixels, so the take is 1536x864 whatever the device scale is.
// Resample the picture to 1080p once, here, and lay the title cards and labels over it at
// their native 1920 — the typography stays sharp even though the footage was enlarged.
const filters = ['[0:v]scale=1920:1080:flags=lanczos[base]'];
let labelIn = 'base';
let idx = 1; // ffmpeg input index
let step = 0; // filter-label counter

// A card over a page of type reads as a double exposure — the app's own headline ghosts
// through the film's. Blurring just the span under each card turns the app into a backdrop,
// and letting the blur fade with the card resolves the picture into focus as it lifts.
function blurUnder(start, end, fadeIn, fadeOut, sigma = 18) {
  const n = step++;
  const chain = [`[${labelIn}]split=2[k${n}a][k${n}b]`];
  const soft = [`[k${n}b]trim=${start}:${end}`, 'setpts=PTS-STARTPTS', `gblur=sigma=${sigma}`, 'format=rgba'];
  if (fadeIn > 0) soft.push(`fade=t=in:st=0:d=${fadeIn}:alpha=1`);
  if (fadeOut > 0) soft.push(`fade=t=out:st=${(end - start - fadeOut).toFixed(2)}:d=${fadeOut}:alpha=1`);
  soft.push(`setpts=PTS-STARTPTS+${start}/TB`);
  filters.push(chain[0], `${soft.join(',')}[soft${n}]`);
  filters.push(
    `[k${n}a][soft${n}]overlay=0:0:eof_action=pass:enable='between(t,${start},${end})'[bg${n}]`,
  );
  labelIn = `bg${n}`;
}

function layer(file, dur, start, fadeIn, fadeOut, pos) {
  const n = step++;
  inputs.push('-loop', '1', '-t', String(dur), '-i', OVL + file);
  const chain = [`[${idx}:v]format=rgba`];
  if (fadeIn > 0) chain.push(`fade=t=in:st=0:d=${fadeIn}:alpha=1`);
  if (fadeOut > 0) chain.push(`fade=t=out:st=${(dur - fadeOut).toFixed(2)}:d=${fadeOut}:alpha=1`);
  chain.push(`setpts=PTS-STARTPTS+${start}/TB`);
  filters.push(`${chain.join(',')}[ov${n}]`);
  filters.push(
    `[${labelIn}][ov${n}]overlay=${pos}:eof_action=pass:enable='between(t,${start},${(start + dur).toFixed(2)})'[bg${n}]`,
  );
  labelIn = `bg${n}`;
  idx++;
}

// the hero's own 100px headline sits directly behind the title; it needs more blur than the
// body copy under the closing card before it reads as texture rather than type
blurUnder(0, OPEN_DUR, 0, OPEN_DUR - OPEN_OUT, 34);
layer('open.png', OPEN_DUR, 0, 0, OPEN_DUR - OPEN_OUT, '0:0');
for (const c of chips) {
  layer(c.file, c.dur, c.start, CHIP_FADE, CHIP_FADE, 'main_w-overlay_w-64:main_h-overlay_h-56');
}
blurUnder(close.start, total, CLOSE_IN, 0);
layer('close.png', close.dur, close.start, CLOSE_IN, 0, '0:0');

inputs.push('-i', AUDIO);
const audioIdx = idx;

execFileSync(
  'ffmpeg',
  [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', `[${labelIn}]`, '-map', `${audioIdx}:a`,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-t', String(total),
    OUT,
  ],
  { stdio: 'inherit' },
);

console.log(
  execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate,channels',
    '-show_entries', 'format=duration,size',
    '-of', 'default=nw=1', OUT,
  ]).toString().trim(),
);
console.log('wrote', OUT);
