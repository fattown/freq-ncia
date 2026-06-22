# Freqüència — EQ Ear Trainer

A browser-based ear training tool for learning to recognize frequency ranges by ear — the skill of hearing a problem in a mix and knowing where to reach on the EQ before you even look at the analyzer.

**[Try it live](#)** *(once hosted — see deploy instructions below)*

## How it works

Each round, the app applies a parametric (peaking) boost at a random frequency to an audio source. You scrub a frequency slider across the spectrum (20 Hz – 20 kHz, log scale) and try to find where the boost is — i.e., where you'd need to apply a *cut* to flatten the mix back out. Submit your guess and see how close you were, in octaves of error. An A/B toggle lets you flip between the boosted and the flat/original version of whatever's currently looping, so you can really lock the sound into memory before moving to the next round.

There's a live spectrum analyzer under the hood for visual confirmation after you've already committed to a guess — it's not meant to be read while guessing, but it's satisfying to see the bump line up with your ear afterward.

## Levels

1. **Pink noise** — wide, obvious boosts across a forgiving range. Good for learning the slider/spectrum mapping itself.
2. **Pink noise (narrow)** — same idea, full 20 Hz–20 kHz range, narrower (higher-Q) boosts.
3. **Sine sweep recall** — a single boosted tone, no noise bed. Pure pitch-to-frequency recall.
4. **Single instrument** — a small synthesized instrument loop (pad / pluck / bass) with a boost applied. Harmonics start interacting with the boost, which is a much closer approximation of real mixing.
5. **Single instrument + gain** — same as above, but you also guess the boost amount in dB.
6. **Your mix (file)** — load audio from your own machine: a single file, a whole folder, or a `.zip` of your reference library, all dragged or picked at once. Nothing is uploaded anywhere — it's decoded directly in your browser. Each track gets an automatically-picked loop window (it scans for the loudest, most stable ~14 second stretch, so you don't land on a cold intro or a fade-out by default), and you can still drag to adjust it. The app boosts a random frequency in that loop and you try to find where you'd cut to bring it back to "well mixed." This is the level worth spending the most time on: build a folder of go-to reference mixes (the same ones you'd reach for in a DAW) and train against those specifically.

### Bulk import details

- **Drop a folder**: drag a folder from Finder/Explorer onto the drop zone, or use the "Choose folder" button. All audio files inside (including subfolders) get added to the library.
- **Drop a `.zip`**: same idea, useful if you keep a reference library zipped up or want to share one. The zip reader (JSZip) loads from a CDN on first use — if you're offline or the CDN is blocked, you'll get a clear message; just unzip locally and drop the files in directly instead.
- **Multiple loose files**: select or drop several files at once — same result, just no folder/zip involved.
- Supported extensions: `.mp3 .wav .flac .m4a .ogg .aac .aif .aiff` (whatever your browser's decoder supports under the hood).

## Why no bundled songs?

Levels 1–5 are fully self-contained — pink noise and the instrument loops are synthesized in-browser with the Web Audio API, no audio files needed. Level 6 intentionally asks you to bring your own reference tracks rather than bundling copyrighted music into the repo. This also means you can build a personal library of go-to reference mixes (the same ones you'd reach for in a DAW) and train against those specifically.

## Running it locally

No build step, no dependencies. Just serve the three files over HTTP (you need a server, not a `file://` open, because of how some browsers restrict Web Audio/canvas on the file protocol):

```bash
git clone <your-repo-url>
cd <repo-folder>
python3 -m http.server 8080
# then open http://localhost:8080
```

Or just double-click `index.html` — most browsers will run it fine, but if you hit a blank canvas or audio that won't start, fall back to the local server method above.

## Deploying to GitHub Pages

1. Create a new repo and push these three files (`index.html`, `style.css`, `app.js`) to the `main` branch.
2. In the repo settings, go to **Pages**, set source to **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Your app will be live at `https://<your-username>.github.io/<repo-name>/` within a minute or two.

## Browser support

Built on standard Web Audio API (`AudioContext`, `BiquadFilterNode`, `AnalyserNode`, `OfflineAudioContext`) and `<canvas>`. Works in current Chrome, Firefox, Safari, and Edge. No external libraries, no build tooling, no tracking.

## Notes on the scoring

Error is measured in octaves (log2 of the ratio between your guess and the true frequency), since frequency perception is logarithmic — being off by 50 Hz matters a lot at 100 Hz and nothing at 8000 Hz. Roughly:

- **< 0.15 octaves** — nailed it
- **0.15–0.4 octaves** — close, within about half an octave
- **0.4–0.8 octaves** — in the neighborhood
- **> 0.8 octaves** — worth more reps in that range

## Ideas for extending it

- Add a "cut" mode (negative gain) alongside boosts, since cuts can be harder to hear than boosts.
- Add narrower-band levels using a band-pass + makeup gain instead of a peaking filter, to train more surgical Q recognition.
- Persist session stats across reloads with `localStorage`.
- Add a "blind sweep" mode where the slider itself sweeps a probe tone live over the mix at adjustable Q, the classic "sweep and listen for what jumps out" technique engineers use.
