# Hyperframes Composition Brief: Mmiri

## Objective
Create a short launch-style brag video for Mmiri — a sealed-bid market that prices drought
cover for Nigerian smallholder farmers and settles it from NASA's rainfall record on NEAR.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21 seconds

## Source Material
- Project root: `/Users/romeoscript/Desktop/Mmiri`
- Primary files read: `web/app/page.tsx`, `web/app/globals.css`, `README.md`,
  `sim/fixtures/rainfall.json`, `oracle/src/lib.rs`
- Product name: Mmiri (Igbo for water, and for rain)
- Tagline / strongest claim: "Rainfall cover, priced by a market"
- Key UI or visual moment to recreate: the 45-season rainfall record with the strike line
  across it and the below-strike seasons in ochre — the product's own hero chart
- Copy that must appear verbatim:
  - "Nobody told the underwriters the climate is drying."
  - "9 of 45 seasons would have paid. 6 of those 9 since 2011."
  - "Rainfall cover, priced by a market"
  - "Built at NEAR HACKATHON"

**The data is real.** The 45 season totals are computed from the committed fixture with the
contract's own integer algorithm (`oracle/src/lib.rs::window_total`): per day to hundredths,
summed, rounded once to tenths. They reproduce the figures on the live site — 9 of 45 below
the 71.1 mm strike, 6 of those since 2011, driest 2019 at 32.3 mm, 2025 at 53.6 mm, which is
the reading that settled policy 7. The five premiums are what `agents/pricing` returns for
these terms. Nothing in this video is invented.

## Creative Direction
- Tone preset: polished
- Creative direction: a quiet, evidence-led product film — the data does the talking
- Interpretation: four scenes, long holds, slow deliberate motion. The photography carries
  the emotion so the type does not have to shout. No hype, no jokes.
- Angle: the market discovered climate change by losing money. In the repository's own
  15-season backtest, the agent that priced on the whole 45-year record won 80% of the
  business and lost most of its capital; the one that trusted recent seasons made money.
- Hook: cracked earth and dead maize, full frame, with "Nobody told the underwriters the
  climate is drying." The ground answers before the sentence finishes.
- Outro / punchline: "Rainfall cover, priced by a market" over rain falling on green
  farmland — the wet counterpart to the opening frame.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign

## Visual Identity
- Background: `#08191f`
- Text: `#e8f2f1`
- Accent: `#6fc9de` (rain) and `#e3a33c` (ochre, below strike). Chart marks use the
  validated steps `#2e9fc0` / `#c28519`.
- Display font: Archivo, width 125%, weight 700 — shipped at
  `assets/fonts/archivo-exp-700.woff2`
- Body font: Archivo, normal width, weight 500 — `assets/fonts/archivo-500.woff2`
- Visual references from the project: the rainfall record chart, the agent premium table,
  the droplet logo mark, and the two photographs in `assets/img/`

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. The failed season — 4.5s — `dry.webp` full frame, slow push in. "Nobody told the
   underwriters the climate is drying." then "The rainfall did."
2. Forty-five seasons — 5.5s — the real record builds bar by bar, the strike line draws,
   nine bars turn ochre. "9 of 45 seasons would have paid. 6 of those 9 since 2011."
3. Five sealed bids — 5.5s — the five agents deal in one by one with their real premiums;
   the lowest is marked as the winner and the rest dim.
4. Settled, then the rain — 5.5s — 53.6 mm against the 71.1 mm strike, the PAID stamp, the
   one-line receipt, then `wet.webp` with the mark and the closing line.

## Audio
- Audio role: cinematic support, restrained
- Audio arc: almost inaudible under the drought, accumulating quietly through the record
  and the auction, one swell as the policy pays, dissolving into the closing frame
- Music: `assets/music/score.mp3` — generated for this film (ElevenLabs Music v2.5, 24s
  instrumental: sparse minor-key underscore, low strings, soft piano, kora-like plucked
  texture). The bundled upbeat corporate beds were rejected as tonally wrong against
  drought footage.
- Music treatment: start at 0 under the hook at low volume, hold, fade out across the last
  1.2s. Track is 24.03s and is trimmed to the 21s composition.
- Music cue guidance: detect at composition time with `npx hyperframes beats` if useful.
  The score is deliberately sparse and rubato, so natural timing is expected to beat cue
  snapping here; prefer readability.
- Audio-reactive treatment: none — the score has little transient energy and the film's
  restraint is the point. Documented rather than forced.
- Audio-coupled moments:
  - Scene 2 chart build — bars filling left to right
  - Scene 3 bid rows — five sequential arrivals
  - Scene 4 PAID stamp — the single payoff beat
- SFX selection guidance: sparse and motion-matched. Soft ticks as the record fills, a dry
  card sound per bid row, one low hit on the stamp. Nothing that is not matched to a
  visible movement.
- SFX analysis guidance: `~/.claude/plugins/cache/brag/brag/0.1.0/skills/brag/assets/sfx/sfx-analysis.md`
  — prefer low high-frequency-risk files for the repeated tick.
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density, and volume based on
  the implemented animation.
- Audio files: music is already at `composition/assets/music/score.mp3`; any selected SFX
  go to `composition/assets/sfx/`.

## Hyperframes Instructions
Use the current `hyperframes` skill and CLI workflow. Prefer native Hyperframes conventions
over anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project — the rainfall
  record chart is that element, drawn from the real fixture.
- Keep all text readable in the final render; every line holds past the reading floor.
- Keep the video within 15-25 seconds.
- Include the music layer; SFX sparse.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet.
- Run `npx hyperframes check` and clear all findings before render.
