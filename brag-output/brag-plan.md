# Brag Plan: Mmiri

## What is this app?
A sealed-bid market where five underwriter agents compete to price drought cover for
Nigerian smallholder farmers, settled automatically from NASA's rainfall record on NEAR —
no assessor, no claim form, no adjuster.

## The angle
The market discovered climate change by losing money.

In a 15-season backtest the agent that priced on the whole 45-year record won 80% of the
business and lost most of its capital. The one that trusted only recent seasons made money.
Nobody told these agents the climate is drying — the rainfall did, through their balance
sheets. That is a real result from this repository's own simulation, not a claim, and it is
far more interesting than any feature list.

## Hook (first 2-3 seconds)
Cracked earth and dead maize, full frame, slow push in. One line: **"Nobody told the
underwriters the climate is drying."** The ground answers before the sentence finishes.

## Key moments (the middle)
- The 45-season rainfall record building bar by bar, the strike line drawing across, and
  nine seasons turning to ochre beneath it — the whole argument in one shape.
- Five sealed bids landing one by one with real premiums (12.77 / 18.74 / 19.52 / 24.71 /
  27.79 USDC), lowest wins. These are the actual figures the pricing library returns.
- NASA's reading arriving — 53.6 mm against a 71.1 mm strike — and the policy stamping
  itself PAID without anyone filing anything.

## Outro / punchline
"Mmiri — rainfall cover, priced by a market." Rain falling over green farmland, the wet
counterpart to the opening frame. The land answers the land.

## User flow worth showing
entry → key action → result:
1. A buyer sets terms: one place, one 30-day window, the most they will pay.
2. Five agents commit sealed bids; the lowest at or under the maximum takes the risk and
   locks the full payout as collateral.
3. The window closes, the rainfall record comes in under the strike, and the payout moves
   on its own.

## Tone
- Preset: polished
- Creative direction: a quiet, evidence-led product film — the data does the talking
- Interpretation: four scenes, long holds, no jokes and no hype. Motion is slow and
  deliberate; the photography carries the emotion so the type does not have to shout. The
  restraint is the point: this is insurance for people who cannot afford a bad product.

## Format: landscape — 1920x1080
## Duration: 21 seconds

## Visual identity (from the project)
- Background: `#08191f` (deep water ink)
- Accent: `#6fc9de` (rain — at or above strike) and `#e3a33c` (harmattan ochre — below
  strike, the policy pays). These two hues mean only those two things anywhere in the
  product, including the logo.
- Chart marks: `#2e9fc0` / `#c28519` — the validated categorical steps of those same hues
- Text: `#e8f2f1`
- Display font: Archivo, width 125%, weight 700
- Body font: Archivo, normal width
- Strongest visual element: the 45-season rainfall record with the strike line across it
- Available stills in `web/public/img/`: `dry.webp` (cracked earth, dead maize),
  `wet.webp` (rain falling over farmland), `gauge.webp` (a rain gauge in a maize field)

## Share copy (draft)
Smallholders can't buy drought cover because assessing a two-hectare farm costs more than
the policy is worth. So we removed the assessor: five agents bid for the risk and NASA's
rainfall record settles it. Backtested on 15 seasons, the agent that ignored the drying
climate lost its shirt. Built at NEAR HACKATHON.

## Audio direction
- Role: low cinematic bed with a single swell into the settlement beat
- Music: restrained, sparse, minor-key; nothing triumphant
- Music treatment: start under the hook at low volume, lift gently through the auction,
  swell once as the policy stamps PAID, fade out under the final card
- Music cue guidance: to be detected at composition time (`npx hyperframes beats`). Target
  one strong cue for the PAID stamp around 0:16; use a beat-grid window for the five bid
  rows between 0:10 and 0:14, snapped to every other beat so each premium holds long
  enough to read.
- Audio-reactive treatment: subtle — the rain layer over the closing frame may breathe
  with the bed. No waveform bars, no pulsing cards.
- SFX posture: sparse and motion-matched. A soft tick per bar group as the record builds,
  a dry card sound per bid row, one low hit on PAID. Nothing else.
- Audio-coupled moments: the chart building, the five sequential bid rows, the PAID stamp
- Restraint rule: no whooshes, no risers, no stingers. If a sound is not matched to a
  visible movement, it does not belong.

## Storyboard

### Scene 1 — The failed season — 4.5s
Full-frame `dry.webp`, slow 4% push in, graded toward the ink background. One line sets in
over it, left-aligned on the lower third: **"Nobody told the underwriters the climate is
drying."** (9 words → ~2.7s settled; it holds for 3s.) A second, smaller line fades in
beneath after the first has settled: "The rainfall did."
Sequential/interaction: none — two-stage text, the second line waits for the first.
Audio intent: still and heavy. Bed enters almost inaudibly.
Audio-coupled idea: none.
Music: low minor bed, barely present.
Transition mood: soft crossfade → Scene 2

### Scene 2 — Forty-five seasons — 5.5s
Hard cut to the ink background. The rainfall record builds: 45 bars grow from the baseline
left to right over ~1.2s, the strike line draws across, then nine bars beneath it turn
ochre. Axis labels and the `71.1 mm strike` label settle. One line below: **"9 of 45
seasons would have paid. 6 of those 9 since 2011."** (12 words → holds 3s.)
Sequential/interaction: yes — bars fill left to right, then the strike line draws, then the
below-strike bars change colour last, so the shortfall is the final thing you see.
Audio intent: the record accumulating; quiet forward motion.
Audio-coupled idea: a soft tick per group of bars as they fill, then one cleaner mark as
the strike line completes.
Music: bed continues, a little more present.
Transition mood: clean wipe → Scene 3

### Scene 3 — Five sealed bids — 5.5s
The auction. Five rows deal in one by one, each an agent name and a premium, right-aligned
and tabular: `uw-1 Longrun 12.77` · `uw-5 Capacity 18.74` · `uw-3 Blend 19.52` ·
`uw-2 Recent 24.71` · `uw-4 Cautious 27.79` USDC. After the fifth lands, a `wins` marker
settles on the first row and the other four dim. Small caption: "Lowest sealed bid takes
the risk and locks the full payout."
Sequential/interaction: yes — five rows arriving one at a time, ~0.55s apart, then the
winner marker. Each row must be legible, so snap to every other beat rather than every beat.
Audio intent: measured, procedural, a little tense.
Audio-coupled idea: a dry card sound per row; nothing on the winner marker except the music.
Music: lifting slightly.
Transition mood: clean wipe → Scene 4

### Scene 4 — Settled, then the rain — 5.5s
NASA's reading arrives as a single large figure: **53.6 mm** against a smaller
`71.1 mm strike` beneath it. Beat. The word **PAID** stamps in ochre, and a one-line
receipt settles under it: "Policy 7 — 50 USDC to the holder. No claim filed." Then cut to
`wet.webp`, rain falling over green farmland, and the Mmiri mark with the line "Rainfall
cover, priced by a market" and, small, "Built at NEAR HACKATHON".
Sequential/interaction: yes — reading, then stamp, then receipt, then the closing frame.
Audio intent: the swell lands on PAID, then everything recedes into rain.
Audio-coupled idea: one low hit on the stamp; the rain layer may breathe with the bed.
Music: single swell on PAID, then fade under the final card.
Transition mood: hard cut on the stamp, soft dissolve into the closing frame → end

**Music mood for this video:** cinematic, restrained, minor-key
**Audio summary:** A bed that is almost silent under the drought, accumulates quietly
through the record and the auction, swells once when the policy pays, and dissolves into
rain.
