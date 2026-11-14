# How the demo film is built

Four steps. Each is re-runnable on its own; intermediates land in `demo-output/.capture/`.
Needs `ffmpeg`, `node`, `puppeteer-core`, a local Chrome, and the app served somewhere.

```bash
cd demo-output/tools
npm i puppeteer-core                       # the only dependency

# 1. narration + timing plan (writes ../narration.wav and ../plan.json)
#    regenerate the clips first if ../narration/*.txt changed:
#    HYPERFRAMES_PYTHON=<venv with kokoro-onnx> npx hyperframes tts \
#      --text-file ../narration/s1.txt -v af_heart -s 1.05 -o ../narration/s1.wav
node mix.mjs

# 2. shoot the takes. A, B and C are the app in a browser (one browser each); T is the
#    terminal replay of a real `scripts/demo` run — edit term-lines.json to re-cut it from
#    a newer run's log, then rebuild the page before shooting it.
cd ../../web && pnpm build && npx next start -p 3100 &
cd ../demo-output/tools
BASE=http://localhost:3100 node capture.mjs A   # home page, beats 1-7
BASE=http://localhost:3100 node capture.mjs B   # into the backtest
BASE=http://localhost:3100 node capture.mjs C   # the live policies
node build-term.mjs && node term-capture.mjs    # the round, start to finish

# 3. cut each take to its exact film-time span
for t in A T B C; do node assemble.mjs $t; done

# 4. join the takes, render the cards and labels, composite, mux narration
node finish.mjs                                 # writes ../mmiri-demo.mp4
```

Two things that will bite if you change them:

- **Serve a freshly built app.** A `next start` left running across a rebuild serves stale
  chunk names, and the client-side navigation to `/simulation` dies with a `ChunkLoadError`
  that renders as "This page couldn't load" — which is what the film records.
- **The scroll targets in `capture.mjs` are document offsets measured at a 1536×864 viewport.**
  Change the page's layout and the film scrolls to the wrong places; re-measure before
  re-shooting.
