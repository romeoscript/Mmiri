// Record the terminal take: a replay of the real `scripts/demo` run, played back in a page
// that knows the film's clock. Same capture geometry as the app takes, so the whole film
// scales identically at delivery.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = new URL('../', import.meta.url).pathname; // demo-output/
const WORK = ROOT + '.capture/';
const plan = JSON.parse(readFileSync(ROOT + 'plan.json', 'utf8'));
const SPAN = plan.takes.T;

const DIR = `${WORK}frames-T/`;
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1536, height: 864, deviceScaleFactor: 1.25 },
  args: ['--hide-scrollbars', '--force-color-profile=srgb', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE_ERR', String(e).slice(0, 160)));

await page.goto('file://' + ROOT + 'term.html', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await sleep(600);

const client = await page.createCDPSession();
const frames = [];
let n = 0;
let recording = false;
client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  if (recording) {
    const name = `f${String(n++).padStart(5, '0')}.jpg`;
    writeFileSync(DIR + name, Buffer.from(data, 'base64'));
    frames.push({ name, t: metadata.timestamp });
  }
  try {
    await client.send('Page.screencastFrameAck', { sessionId });
  } catch {}
});

await client.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 92,
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1,
});
await sleep(150);
recording = true;
const t0 = Date.now();

// the page schedules its own reveals against the beat, so it only needs the go-ahead
await page.evaluate(() => window.__start());

const target = (SPAN.to - SPAN.from) * 1000;
while (Date.now() - t0 < target) await sleep(200);

recording = false;
await client.send('Page.stopScreencast').catch(() => {});
await sleep(300);
writeFileSync(DIR + 'index.json', JSON.stringify({ take: 'T', span: SPAN, frames }, null, 1));
console.log(
  `take T: ${frames.length} frames, span ${(frames.at(-1).t - frames[0].t).toFixed(2)}s (target ${((SPAN.to - SPAN.from)).toFixed(2)}s)`,
);
await browser.close();
