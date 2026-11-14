// Drive the running Mmiri app through the demo walkthrough and record it as frames.
//
// The picture is the real application in a real Chrome: every scroll, hover, wallet modal and
// page change here happens to the live app talking to the live testnet contract.
//
// Shot in three takes, each with its own browser. One long session crashed the renderer on the
// 300-row simulation table, and a crash at minute two costs the whole film; a take boundary
// costs one take. The boundaries sit where the app is static at the top of a page, so the cuts
// land where a page change would anyway. Every step is scheduled in film time, so the takes
// butt together on the narration's clock.
//
// Frames come from CDP's screencast, which emits only on change, so each frame carries its own
// timestamp and the assembler rebuilds true timing from them.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE ?? 'http://localhost:3001';
const ROOT = new URL('../', import.meta.url).pathname; // demo-output/
const WORK = ROOT + '.capture/'; // intermediates: frames and per-take segments
const plan = JSON.parse(readFileSync(ROOT + 'plan.json', 'utf8'));
const B = plan.beats;

const TAKE = (process.argv[2] ?? 'A').toUpperCase();
const SPAN = {
  A: { from: 0, to: +(B.b8 - 0.4).toFixed(2), url: '/' },
  B: { from: +(B.b8 - 0.4).toFixed(2), to: +(B.b9 - 0.4).toFixed(2), url: '/' },
  C: { from: +(B.b9 - 0.4).toFixed(2), to: plan.total, url: '/policies' },
}[TAKE];
if (!SPAN) throw new Error(`unknown take ${TAKE}`);

const DIR = `${WORK}frames-${TAKE}/`;
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const VIEW = { width: 1536, height: 864, deviceScaleFactor: 1.25 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: VIEW,
  args: [
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});

const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE_ERR', String(e).slice(0, 140)));

await page.evaluateOnNewDocument(() => {
  window.__ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  window.__scroll = (y, ms) =>
    new Promise((done) => {
      const from = window.scrollY;
      const delta = y - from;
      if (ms <= 0) {
        window.scrollTo(0, y);
        return done();
      }
      const t0 = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - t0) / ms);
        window.scrollTo(0, from + delta * window.__ease(p));
        if (p < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
  window.__cursor = () => {
    if (document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.style.cssText = [
      'position:fixed;left:0;top:0;width:24px;height:24px;margin:-12px 0 0 -12px',
      'border-radius:50%;border:2px solid rgba(232,242,241,.92)',
      'background:rgba(111,201,222,.20)',
      'box-shadow:0 2px 10px rgba(0,0,0,.45)',
      'z-index:2147483647;pointer-events:none;opacity:0',
      'transition:opacity .25s ease',
    ].join(';');
    document.body.appendChild(c);
    addEventListener(
      'mousemove',
      (e) => {
        c.style.opacity = '1';
        c.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      },
      { passive: true },
    );
  };
});

// --- recording -------------------------------------------------------------
const client = await page.createCDPSession();
const frames = [];
let frameNo = 0;
let recording = false;
client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  if (recording) {
    const name = `f${String(frameNo++).padStart(5, '0')}.jpg`;
    writeFileSync(DIR + name, Buffer.from(data, 'base64'));
    frames.push({ name, t: metadata.timestamp });
  }
  try {
    await client.send('Page.screencastFrameAck', { sessionId });
  } catch {}
});

// --- driving ---------------------------------------------------------------
let t0 = 0;
const now = () => SPAN.from + (Date.now() - t0) / 1000;
async function at(sec) {
  const wait = (sec - SPAN.from) * 1000 - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
}

async function land(path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(2600); // let hydration, chain reads and the hero settle before anyone looks
  await page.evaluate(() => window.__cursor());
}

let mouse = { x: 760, y: 520 };
async function glide(x, y, ms) {
  const steps = Math.max(2, Math.round(ms / 16));
  const from = { ...mouse };
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await sleep(ms / steps);
  }
  mouse = { x, y };
}

async function clickText(text, ms = 700) {
  const box = await page.evaluate((t) => {
    const els = [...document.querySelectorAll('a,button')];
    const hit =
      els.find((el) => (el.textContent || '').trim() === t) ??
      els.find((el) => (el.textContent || '').trim().startsWith(t));
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text);
  if (!box) {
    console.log(`MISS: no clickable element "${text}"`);
    return false;
  }
  await glide(box.x, box.y, ms);
  await sleep(240);
  await page.mouse.click(box.x, box.y);
  return true;
}

const scroll = (y, ms) => page.evaluate((a, b) => window.__scroll(a, b), y, ms).catch(() => {});

const log = [];
const mark = (name) => log.push({ name, t: +now().toFixed(2) });

// --- the walkthrough -------------------------------------------------------
await land(SPAN.url);
await client.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 92,
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1,
});
await sleep(150);
t0 = Date.now();
recording = true;
mark('start');

if (TAKE === 'A') {
  // B1 — the hero: held for the title card, then a slow drift down the photograph.
  await at(B.b1 + 2.2);
  await scroll(240, 6500);
  mark('b1-drift');

  // B2 — the rainfall record: the chart, then the line that counts the seasons.
  await at(B.b2);
  await scroll(980, 3200);
  mark('b2-chart');
  await at(B.b2 + 9);
  await scroll(1180, 2600);

  // B3 — how a round works, then her own terms: place, strike, payout.
  await at(B.b3 - 1.4);
  await scroll(1900, 2800);
  mark('b3-how');
  await at(B.b3 + 2.6);
  await scroll(2830, 2600);
  await at(B.b3 + 5.6);
  await glide(342, 274, 1000);
  await glide(555, 294, 900);
  await glide(770, 274, 900);

  // B4 — her own wallet: the real near-wallet-selector modal, opened and dismissed.
  await at(B.b4 - 1.3);
  await clickText('Connect wallet to continue', 1000);
  mark('b4-wallet');

  // B5 — the five sealed quotes, then the line where the market clears.
  await at(B.b5 - 1.7);
  await page.keyboard.press('Escape');
  await at(B.b5 - 1.0);
  await scroll(3230, 2200);
  mark('b5-quotes');
  await at(B.b5 + 4.5);
  await glide(752, 169, 1200);
  await glide(752, 497, 2400);
  await at(B.b5 + 14.5);
  await scroll(3500, 2400);

  // B6 — why this needs a market: the two rates and the gap between them.
  await at(B.b6);
  await scroll(3880, 3000);
  mark('b6-rates');

  // B7 — settled on testnet: the three cards, one of them read by the TEE oracle.
  await at(B.b7);
  await scroll(4420, 3000);
  mark('b7-settled');
  await at(B.b7 + 9);
  await scroll(4620, 2600);

  // back to the top, where this take hands over to the next
  await at(B.b8 - 3.2);
  await scroll(0, 1600);
  mark('a-end');
}

if (TAKE === 'B') {
  // the click into the backtest, then the capital table
  await at(B.b8 - 1.5);
  await clickText('Simulation', 900);
  await sleep(1400);
  await page.evaluate(() => window.__cursor()).catch(() => {});
  mark('b8-simulation');
  await at(B.b8 + 3.2);
  await scroll(430, 3000);
  await at(B.b8 + 13);
  await scroll(980, 3000);

  // back to the top and into the policies, where take C picks it up
  await at(B.b9 - 3.0);
  await scroll(0, 1500);
  await at(B.b9 - 1.3);
  await clickText('Policies', 800);
  mark('b-end');
}

if (TAKE === 'C') {
  // B9 — the live policies, read from the contract
  mark('b9-policies');
  await at(B.b9 + 7.0);
  await scroll(260, 2600);
}

await at(SPAN.to);
mark('end');

recording = false;
await client.send('Page.stopScreencast').catch(() => {});
await sleep(300);
writeFileSync(DIR + 'index.json', JSON.stringify({ take: TAKE, span: SPAN, frames, log }, null, 1));
console.log(
  `take ${TAKE}: ${frames.length} frames, span ${(frames.at(-1).t - frames[0].t).toFixed(2)}s (target ${(SPAN.to - SPAN.from).toFixed(2)}s)`,
);
console.log(JSON.stringify(log));
await browser.close();
