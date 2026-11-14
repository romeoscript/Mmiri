// Build the terminal take from the real run.
//
// The lines below are the actual stdout of `scripts/demo` — the round id, the five sealed
// premiums, the winning bid, the oracle reading and the settled status are whatever that run
// produced. What is cut out is the RPC chatter and near-cli's transaction receipts, marked
// where it happens; what is kept is kept verbatim.
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname; // demo-output/
const WORK = ROOT + '.capture/';
const HERE = new URL('./', import.meta.url).pathname; // tools/
const plan = JSON.parse(readFileSync(ROOT + 'plan.json', 'utf8'));
const beat = plan.timeline.find((b) => b.id === 'bT');
const span = plan.takes.T;

// Each entry: [delay after the previous line, kind, text]. Delays are in seconds of film
// time from the start of the take, assigned per phase so the picture lands with the sentence.
const script = JSON.parse(readFileSync(HERE + 'term-lines.json', 'utf8'));

const rows = script
  .map(
    (l, i) =>
      `<div class="line ${l.k}" id="l${i}" data-at="${l.at}">${l.t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>demo run</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1536px; height: 864px; overflow: hidden; background: #08191f; }
  body {
    font-family: Menlo, 'SF Mono', monospace;
    display: flex; align-items: center; justify-content: center;
    padding: 40px 54px 148px;
  }
  .screen {
    width: 100%; height: 100%;
    background: #061419;
    border: 1px solid rgba(148,175,182,.26);
    border-radius: 14px;
    box-shadow: 0 30px 90px rgba(0,0,0,.5);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .bar {
    flex: none; height: 56px; display: flex; align-items: center; gap: 14px;
    padding: 0 22px; background: rgba(14,42,50,.9);
    border-bottom: 1px solid rgba(148,175,182,.22);
    color: #94afb6; font-size: 19px; letter-spacing: .02em;
  }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: #6fc9de; flex: none; }
  .dot.b { background: #e3a33c; }
  .dot.c { background: rgba(148,175,182,.5); }
  .bar b { color: #e8f2f1; font-weight: 500; }
  .body { flex: 1; position: relative; overflow: hidden; padding: 20px 26px 26px; }
  .reel { position: absolute; left: 26px; right: 26px; top: 20px; }
  .line {
    font-size: 23px; line-height: 1.5; color: #c7dbdd;
    white-space: pre-wrap; opacity: 0;
    padding: 1px 0;
  }
  .line.say { color: #6fc9de; margin-top: 14px; }
  .line.say::before { content: '==> '; color: rgba(111,201,222,.55); }
  .line.cmd { color: #e8f2f1; }
  .line.cmd::before { content: '$ '; color: #94afb6; }
  .line.dim { color: rgba(148,175,182,.5); font-style: italic; }
  .line.hit { color: #e3a33c; }
  .line.win { color: #e8f2f1; background: rgba(227,163,60,.14); border-left: 3px solid #e3a33c; padding-left: 12px; margin-left: -15px; }
  .cursor { display: inline-block; width: 11px; height: 21px; background: #6fc9de; vertical-align: -3px; }
</style></head>
<body>
  <div class="screen">
    <div class="bar"><span class="dot"></span><span class="dot b"></span><span class="dot c"></span>
      <span>scripts/demo — <b>market.mmiri-demo.testnet</b></span></div>
    <div class="body"><div class="reel" id="reel">
${rows}
    </div></div>
  </div>
<script>
  const reel = document.getElementById('reel');
  const lines = [...reel.querySelectorAll('.line')];
  const BODY = 864 - 40 - 148 - 56 - 46; // visible height of the scrolling area,
  // kept clear of the lower strip where the film's section labels sit
  window.__start = () => {
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      let last = null;
      for (const el of lines) {
        const at = parseFloat(el.dataset.at);
        if (t >= at) { el.style.opacity = '1'; last = el; }
      }
      if (last) {
        // keep the newest line in the lower third, scrolling only once it would run off
        const bottom = last.offsetTop + last.offsetHeight;
        const shift = Math.max(0, bottom - BODY + 40);
        reel.style.transform = 'translateY(' + -shift + 'px)';
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
</script>
</body></html>
`;

writeFileSync(ROOT + 'term.html', html);
console.log(
  `term.html: ${script.length} lines, take span ${(span.to - span.from).toFixed(2)}s, narration ${beat.dur}s`,
);
