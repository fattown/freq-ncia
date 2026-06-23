/* ===========================================================
   Freqüència — EQ Ear Trainer
   Core engine: Web Audio graph, level system, scoring, UI.
   =========================================================== */

(() => {
  'use strict';

  // ---------- Constants ----------
  const FREQ_MIN = 20;
  const FREQ_MAX = 20000;
  const SLIDER_STEPS = 1000;

  // Map a 0..1000 slider value to a frequency on a log scale.
  function sliderToFreq(v) {
    const t = v / SLIDER_STEPS;
    const logMin = Math.log2(FREQ_MIN);
    const logMax = Math.log2(FREQ_MAX);
    return Math.pow(2, logMin + t * (logMax - logMin));
  }
  function freqToSlider(f) {
    const logMin = Math.log2(FREQ_MIN);
    const logMax = Math.log2(FREQ_MAX);
    const t = (Math.log2(f) - logMin) / (logMax - logMin);
    return Math.round(t * SLIDER_STEPS);
  }
  function fmtFreq(f) {
    if (f >= 1000) return (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz';
    return Math.round(f) + ' Hz';
  }
  function randRange(min, max) { return min + Math.random() * (max - min); }

  // ---------- Level definitions ----------
  // Levels with `difficulties` use fixed gain per chip (Golden Ears / Train Your Ears style).
  // Levels with `gainRange` use a random gain within the range each round.
  const LEVELS = [
    {
      id: 'l1',
      name: 'Pink noise — wide',
      desc: 'Wide boosts (~1.5–2 oct), limited range',
      sourceType: 'synth-pink',
      freqRange: [100, 8000],
      qRange: [0.7, 1.0],   // wide Q — more audible, easier to detect
      difficulties: [
        { label: 'Easy',   gain: 15, tag: '15 dB' },
        { label: 'Medium', gain: 10, tag: '10 dB' },
        { label: 'Hard',   gain:  6, tag:  '6 dB' },
      ],
      guessGain: false,
      hint: 'Pink noise has equal energy per octave, so a wide boost stands out as a clear tonal shift. Listen for where the noise gets harsher (highs), nasal or boxy (mids), or rumbly (lows). Sweep slowly and compare the boosted vs flat version with A/B.',
    },
    {
      id: 'l2',
      name: 'Pink noise — narrow',
      desc: 'Tight resonant boosts (~0.4–0.5 oct), full range',
      sourceType: 'synth-pink',
      freqRange: [40, 16000],
      qRange: [2.0, 3.5],   // narrow Q — harder to detect, more defined once found
      difficulties: [
        { label: 'Easy',   gain: 12, tag: '12 dB' },
        { label: 'Medium', gain:  8, tag:  '8 dB' },
        { label: 'Hard',   gain:  5, tag:  '5 dB' },
      ],
      guessGain: false,
      hint: 'The boost is much narrower (~0.5 octave) and can land anywhere from sub-bass to air. Narrow boosts are harder to detect overall even at the same dB — they affect less of the signal. Listen for a distinct resonance or ringing character.',
    },
    {
      id: 'l3',
      name: 'Sine tone recall',
      desc: 'Identify a pure tone — raw pitch memory',
      sourceType: 'synth-tone',
      freqRange: [60, 12000],
      qRange: [1.0, 1.0],
      difficulties: [
        { label: 'Easy',   gain: 12, tag: 'louder' },
        { label: 'Medium', gain:  8, tag: 'clear'  },
        { label: 'Hard',   gain:  5, tag: 'quiet'  },
      ],
      guessGain: false,
      hint: 'A single pure sine tone plays — no noise, no spectrum hint (it\'s hidden until you submit). You\'re training raw pitch-to-frequency recall. Hum the pitch, think what note it might be, then find it on the slider.',
    },
    {
      id: 'l4',
      name: 'Your mix',
      desc: 'Load your own tracks — identify the boost',
      sourceType: 'user-file',
      freqRange: [60, 14000],
      gainRange: [6, 9],
      qRange: [0.9, 1.8],
      guessGain: false,
      hint: 'Load tracks you know well — a well-mixed reference or your own project. Real audio has complex harmonic content that changes how a boost sounds compared to noise. This is the closest practice to actual mixing work.',
    },
    {
      id: 'l5',
      name: 'Your mix + gain',
      desc: 'Guess frequency AND boost amount',
      sourceType: 'user-file',
      freqRange: [60, 14000],
      gainRange: [3, 6],
      qRange: [0.9, 1.8],
      guessGain: true,
      hint: 'Same as Level 4, but now also estimate the dB amount. Subtle boosts (3–4 dB) are much harder to hear than heavy ones. Use the A/B toggle to compare and refine your gain estimate.',
    },
  ];

  // ---------- State ----------
  const state = {
    levelIdx: 0,
    selectedDifficulty: null, // { label, gain, tag } — set from level.difficulties; null for levels without presets
    audioCtx: null,
    sourceNode: null,       // AudioBufferSourceNode or oscillator/noise node
    eqFilter: null,         // BiquadFilterNode (peaking)
    analyser: null,         // post-EQ analyser (used after reveal)
    preAnalyser: null,      // pre-EQ analyser (used before reveal to hide the boosted bump)
    gainNode: null,
    isPlaying: false,
    isBoostedVersion: true, // which version is currently audible
    currentBuffer: null,    // decoded AudioBuffer for file-based / pre-rendered sources
    userBuffer: null,       // decoded AudioBuffer from user file upload (currently selected library track)
    library: [],            // [{ name, buffer, autoStart, duration }] — loaded from single file, folder, or zip
    libraryIdx: -1,         // index of currently selected track in state.library
    round: {
      targetFreq: null,
      targetGain: null,
      targetQ: null,
      guessFreq: null,
      guessGain: null,
      resolved: false
    },
    session: { correct: 0, total: 0, streak: 0, errors: [] },
    log: [],
    animFrame: null,
    loopHandlers: null
  };

  // ---------- DOM refs ----------
  const el = {
    levelNav: document.getElementById('level-nav'),
    levelName: document.getElementById('level-name'),
    sourceControls: document.getElementById('source-controls'),
    nowPlaying: document.getElementById('now-playing'),
    npDot: document.getElementById('np-dot'),
    npLabel: document.getElementById('np-label'),
    btnPlay: document.getElementById('btn-play'),
    btnToggleVersion: document.getElementById('btn-toggle-version'),
    loopRangeWrap: document.getElementById('loop-range-wrap'),
    loopStart: document.getElementById('loop-start'),
    libraryStatus: document.getElementById('library-status'),
    levelHint: document.getElementById('level-hint'),
    canvas: document.getElementById('spectrum-canvas'),
    spectrumTicks: document.getElementById('spectrum-ticks'),
    guessReadout: document.getElementById('guess-readout'),
    freqSlider: document.getElementById('freq-slider'),
    gainGuessWrap: document.getElementById('gain-guess-wrap'),
    gainSlider: document.getElementById('gain-slider'),
    gainReadout: document.getElementById('gain-readout'),
    btnSubmit: document.getElementById('btn-submit'),
    resultPanel: document.getElementById('result-panel'),
    btnNext: document.getElementById('btn-next'),
    logList: document.getElementById('log-list'),
    logEmpty: document.getElementById('log-empty'),
    statStreak: document.getElementById('stat-streak'),
    statScore: document.getElementById('stat-score'),
    statAvg: document.getElementById('stat-avg'),
  };

  // ===========================================================
  // AUDIO ENGINE
  // ===========================================================

  function ensureAudioCtx() {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    return state.audioCtx;
  }

  function teardownSource() {
    try { if (state.sourceNode) { state.sourceNode.stop(); state.sourceNode.disconnect(); } } catch (e) {}
    state.sourceNode = null;
    if (state.animFrame) { cancelAnimationFrame(state.animFrame); state.animFrame = null; }
  }

  // Build pink noise buffer (Paul Kellet's refined method)
  function makePinkNoiseBuffer(ctx, seconds = 6) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
    return buffer;
  }

  function makeToneBuffer(ctx, freq, seconds = 3) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // Pure sine — no harmonics. The FFT would reveal the frequency if harmonics were added.
      const t = i / ctx.sampleRate;
      const env = Math.min(1, t * 20) * Math.min(1, (seconds - t) * 8);
      data[i] = env * Math.sin(2 * Math.PI * freq * t) * 0.5;
    }
    return buffer;
  }

  // Build the persistent processing graph: source -> eqFilter -> analyser -> gain -> destination
  // We also add a preAnalyser tapped directly from the source so we can hide the boosted bump
  // visually until the round is resolved (preAnalyser shows the flat spectrum).
  function buildGraphAndPlay(buffer) {
    const ctx = ensureAudioCtx();
    teardownSource();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    if (!state.eqFilter) {
      state.eqFilter = ctx.createBiquadFilter();
      state.eqFilter.type = 'peaking';
    }
    if (!state.analyser) {
      state.analyser = ctx.createAnalyser();
      state.analyser.fftSize = 2048;
      state.analyser.smoothingTimeConstant = 0.75;
    }
    // preAnalyser listens to the source before the EQ so the visualizer can show the flat signal
    if (!state.preAnalyser) {
      state.preAnalyser = ctx.createAnalyser();
      state.preAnalyser.fftSize = state.analyser.fftSize;
      state.preAnalyser.smoothingTimeConstant = state.analyser.smoothingTimeConstant;
    }
    if (!state.gainNode) {
      state.gainNode = ctx.createGain();
      state.gainNode.gain.value = 0.9;
    }

    state.eqFilter.frequency.value = state.round.targetFreq;
    state.eqFilter.Q.value = state.round.targetQ;
    state.eqFilter.gain.value = state.isBoostedVersion ? state.round.targetGain : 0;

    // connect: source -> preAnalyser (for visual only)
    source.connect(state.preAnalyser);
    // connect: source -> eqFilter -> analyser -> gain -> destination (audio path)
    source.connect(state.eqFilter);
    state.eqFilter.connect(state.analyser);
    state.analyser.connect(state.gainNode);
    state.gainNode.connect(ctx.destination);

    source.start(0);
    state.sourceNode = source;
    state.isPlaying = true;
    startSpectrumLoop();
  }

  function setBoostedAudible(isBoosted) {
    state.isBoostedVersion = isBoosted;
    if (state.eqFilter) {
      state.eqFilter.gain.value = isBoosted ? state.round.targetGain : 0;
    }
  }

  function stopPlayback() {
    teardownSource();
    state.isPlaying = false;
    el.btnPlay.textContent = '▶ Play loop';
    el.btnPlay.classList.remove('playing');
    el.npDot.classList.remove('live');
    // Disable and reset toggle — it only makes sense while audio is playing
    el.btnToggleVersion.disabled = true;
    el.btnToggleVersion.textContent = 'A/B: Boosted';
  }

  // ===========================================================
  // SPECTRUM VISUALIZATION
  // ===========================================================

  const canvasCtx = el.canvas.getContext('2d');
  let dpr = window.devicePixelRatio || 1;

  function resizeCanvas() {
    const rect = el.canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    el.canvas.width = rect.width * dpr;
    el.canvas.height = rect.height * dpr;
  }
  window.addEventListener('resize', resizeCanvas);

  function freqToX(freq, width) {
    const logMin = Math.log2(FREQ_MIN);
    const logMax = Math.log2(FREQ_MAX);
    const t = (Math.log2(freq) - logMin) / (logMax - logMin);
    return t * width;
  }

  function drawSpectrum() {
    const w = el.canvas.width, h = el.canvas.height;
    canvasCtx.clearRect(0, 0, w, h);

    // grid lines at octave-ish landmarks
    canvasCtx.strokeStyle = 'rgba(255,255,255,0.05)';
    canvasCtx.lineWidth = 1;
    [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach(f => {
      const x = freqToX(f, w);
      canvasCtx.beginPath();
      canvasCtx.moveTo(x, 0);
      canvasCtx.lineTo(x, h);
      canvasCtx.stroke();
    });

    // For sine tone, hide the live spectrum until reveal — the FFT spike would give away the frequency.
    const isSineTone = currentLevel().sourceType === 'synth-tone';
    const suppressLive = isSineTone && !state.round.resolved;

    // live analyser data
    if (!suppressLive && (state.analyser || state.preAnalyser) && state.isPlaying) {
      const analyserToUse = state.round.resolved ? state.analyser : state.preAnalyser;
      if (analyserToUse) {
        const bufferLen = analyserToUse.frequencyBinCount;
        const data = new Uint8Array(bufferLen);
        analyserToUse.getByteFrequencyData(data);
        const nyquist = state.audioCtx.sampleRate / 2;

        canvasCtx.beginPath();
        canvasCtx.moveTo(0, h);
        for (let i = 0; i < bufferLen; i++) {
          const freq = (i / bufferLen) * nyquist;
          if (freq < FREQ_MIN) continue;
          if (freq > FREQ_MAX) break;
          const x = freqToX(freq, w);
          const amp = data[i] / 255;
          const y = h - amp * h * 0.92;
          canvasCtx.lineTo(x, y);
        }
        canvasCtx.lineTo(w, h);
        canvasCtx.closePath();

        const grad = canvasCtx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(255,106,61,0.55)');
        grad.addColorStop(1, 'rgba(255,106,61,0.02)');
        canvasCtx.fillStyle = grad;
        canvasCtx.fill();
        canvasCtx.strokeStyle = 'rgba(255,106,61,0.9)';
        canvasCtx.lineWidth = 1.5 * dpr;
        canvasCtx.stroke();
      }
    } else {
      // flat idle line (also used when sine spectrum is suppressed)
      canvasCtx.strokeStyle = 'rgba(255,255,255,0.12)';
      canvasCtx.lineWidth = 1.5 * dpr;
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, h * 0.7);
      canvasCtx.lineTo(w, h * 0.7);
      canvasCtx.stroke();
      // "Listening…" label while sine is playing but spectrum is hidden
      if (suppressLive && state.isPlaying) {
        canvasCtx.fillStyle = 'rgba(255,255,255,0.2)';
        canvasCtx.font = `${12 * dpr}px sans-serif`;
        canvasCtx.textAlign = 'center';
        canvasCtx.fillText('Spectrum hidden — use your ears', w / 2, h / 2);
        canvasCtx.textAlign = 'left';
      }
    }

    // guess marker
    const guessFreq = sliderToFreq(parseFloat(el.freqSlider.value));
    const gx = freqToX(guessFreq, w);
    canvasCtx.strokeStyle = '#E8E6E1';
    canvasCtx.lineWidth = 2 * dpr;
    canvasCtx.beginPath();
    canvasCtx.moveTo(gx, 0);
    canvasCtx.lineTo(gx, h);
    canvasCtx.stroke();
    canvasCtx.fillStyle = '#E8E6E1';
    canvasCtx.beginPath();
    canvasCtx.arc(gx, 10 * dpr, 4 * dpr, 0, Math.PI * 2);
    canvasCtx.fill();

    // target marker (only after resolved)
    if (state.round.resolved) {
      const tx = freqToX(state.round.targetFreq, w);
      canvasCtx.strokeStyle = '#4FD1C5';
      canvasCtx.lineWidth = 2 * dpr;
      canvasCtx.setLineDash([6 * dpr, 4 * dpr]);
      canvasCtx.beginPath();
      canvasCtx.moveTo(tx, 0);
      canvasCtx.lineTo(tx, h);
      canvasCtx.stroke();
      canvasCtx.setLineDash([]);
      canvasCtx.fillStyle = '#4FD1C5';
      canvasCtx.beginPath();
      canvasCtx.arc(tx, h - 10 * dpr, 4 * dpr, 0, Math.PI * 2);
      canvasCtx.fill();
    }
  }

  function startSpectrumLoop() {
    function loop() {
      drawSpectrum();
      state.animFrame = requestAnimationFrame(loop);
    }
    loop();
  }

  function buildTicks() {
    const ticks = [
      { freq: 20,    label: '20' },
      { freq: 50,    label: '50' },
      { freq: 100,   label: '100' },
      { freq: 200,   label: '200' },
      { freq: 500,   label: '500' },
      { freq: 1000,  label: '1k' },
      { freq: 2000,  label: '2k' },
      { freq: 5000,  label: '5k' },
      { freq: 10000, label: '10k' },
      { freq: 20000, label: '20k' },
    ];
    el.spectrumTicks.innerHTML = '';
    ticks.forEach(({ freq, label }, i) => {
      const pct = freqToX(freq, 1) * 100; // log-scale 0–100%
      const span = document.createElement('span');
      span.textContent = label;
      span.style.left = pct.toFixed(2) + '%';
      // Avoid overflow at edges
      if (i === 0) span.style.transform = 'translateX(0)';
      else if (i === ticks.length - 1) span.style.transform = 'translateX(-100%)';
      el.spectrumTicks.appendChild(span);
    });
  }

  // ===========================================================
  // LEVEL / ROUND MANAGEMENT
  // ===========================================================

  function currentLevel() { return LEVELS[state.levelIdx]; }

  function renderLevelNav() {
    el.levelNav.innerHTML = '';
    LEVELS.forEach((lvl, i) => {
      const chip = document.createElement('button');
      chip.className = 'level-chip' + (i === state.levelIdx ? ' active' : '');
      chip.innerHTML = `
        <span class="lc-num">LV ${i + 1}</span>
        <span class="lc-name">${lvl.name}</span>
        <span class="lc-desc">${lvl.desc}</span>
      `;
      chip.addEventListener('click', () => selectLevel(i));
      el.levelNav.appendChild(chip);
    });
  }

  function selectLevel(i) {
    state.levelIdx = i;
    stopPlayback();
    const lvl = currentLevel();
    // Init difficulty to first preset for levels that have them
    state.selectedDifficulty = lvl.difficulties ? lvl.difficulties[0] : null;
    renderLevelNav();
    el.levelName.textContent = lvl.name;
    el.levelHint.textContent = lvl.hint;
    el.gainGuessWrap.style.display = lvl.guessGain ? 'block' : 'none';
    renderSourceControls();
    resetRoundUI();
  }

  function renderSourceControls() {
    const lvl = currentLevel();
    el.sourceControls.innerHTML = '';

    if (lvl.sourceType === 'user-file') {
      const drop = document.createElement('label');
      drop.className = 'file-drop';
      drop.innerHTML = `
        <input type="file" accept="audio/*" id="file-input" multiple>
        <input type="file" id="zip-input" accept=".zip" style="display:none;">
        <input type="file" id="folder-input" webkitdirectory directory multiple style="display:none;">
        <div id="file-drop-label">Drop audio files, a folder, or a .zip here<br><span class="fd-sub">or use the buttons below</span></div>
      `;
      el.sourceControls.appendChild(drop);

      const pickRow = document.createElement('div');
      pickRow.className = 'pick-row';
      pickRow.innerHTML = `
        <button type="button" class="btn btn-ghost btn-small" id="btn-pick-files">Choose files</button>
        <button type="button" class="btn btn-ghost btn-small" id="btn-pick-folder">Choose folder</button>
        <button type="button" class="btn btn-ghost btn-small" id="btn-pick-zip">Choose .zip</button>
      `;
      el.sourceControls.appendChild(pickRow);

      const status = document.createElement('div');
      status.className = 'library-status';
      status.id = 'library-status';
      el.sourceControls.appendChild(status);
      el.libraryStatus = status;

      const libList = document.createElement('div');
      libList.className = 'builtin-list library-list';
      libList.id = 'library-list';
      el.sourceControls.appendChild(libList);

      const fileInput = drop.querySelector('#file-input');
      const zipInput = drop.querySelector('#zip-input');
      const folderInput = drop.querySelector('#folder-input');

      pickRow.querySelector('#btn-pick-files').addEventListener('click', () => fileInput.click());
      pickRow.querySelector('#btn-pick-folder').addEventListener('click', () => folderInput.click());
      pickRow.querySelector('#btn-pick-zip').addEventListener('click', () => zipInput.click());

      fileInput.addEventListener('change', (e) => handleIncomingFiles(Array.from(e.target.files)));
      folderInput.addEventListener('change', (e) => handleIncomingFiles(Array.from(e.target.files)));
      zipInput.addEventListener('change', (e) => { if (e.target.files[0]) handleIncomingZip(e.target.files[0]); });

      // Drag and drop: supports loose files, a dropped folder, or a dropped .zip
      ['dragover', 'dragleave', 'drop'].forEach(evt => {
        drop.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); });
      });
      drop.addEventListener('dragover', () => drop.classList.add('drag'));
      drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
      drop.addEventListener('drop', async (e) => {
        drop.classList.remove('drag');
        const items = e.dataTransfer.items;
        let entries = [];
        if (items && items.length) {
          entries = Array.from(items)
            .map(it => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
            .filter(Boolean);
        }
        if (entries.length) {
          const files = await walkEntries(entries);
          const zips = files.filter(f => f.name.toLowerCase().endsWith('.zip'));
          const audio = files.filter(f => !f.name.toLowerCase().endsWith('.zip'));
          if (zips.length) await handleIncomingZip(zips[0]);
          if (audio.length) await handleIncomingFiles(audio);
        } else {
          // Fallback: no FileSystemEntry available (some browsers/sources), use the plain file list.
          const plainFiles = Array.from(e.dataTransfer.files || []);
          const zips = plainFiles.filter(f => f.name.toLowerCase().endsWith('.zip'));
          const audio = plainFiles.filter(f => !f.name.toLowerCase().endsWith('.zip'));
          if (zips.length) await handleIncomingZip(zips[0]);
          if (audio.length) await handleIncomingFiles(audio);
        }
      });

      renderLibraryList();
      if (state.libraryIdx !== -1) {
        const track = state.library[state.libraryIdx];
        const maxStart = Math.max(0, track.duration - 6);
        el.loopStart.max = maxStart.toFixed(1);
        // keep whatever loop point the user last set; only fall back to autoStart if unset
        if (!el.loopStart.value || parseFloat(el.loopStart.value) > maxStart) {
          el.loopStart.value = Math.min(track.autoStart, maxStart).toFixed(1);
        }
      }
    } else {
      // synth-pink or synth-tone: show a short source note
      const note = document.createElement('div');
      note.className = 'hint';
      note.textContent = lvl.sourceType === 'synth-pink'
        ? 'Source: generated pink noise. Press Play to start a round — it auto-plays each new round after that.'
        : 'Source: a single pure sine tone. No spectrum shown until you submit — train your ear, not your eyes.';
      el.sourceControls.appendChild(note);
    }

    // Difficulty selector for levels that have preset gain chips
    if (lvl.difficulties) {
      const wrap = document.createElement('div');
      wrap.className = 'difficulty-selector';
      const label = document.createElement('div');
      label.className = 'diff-label';
      label.textContent = 'Boost amount';
      wrap.appendChild(label);
      const chips = document.createElement('div');
      chips.className = 'diff-chips';
      lvl.difficulties.forEach((d) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'diff-chip' + (state.selectedDifficulty === d ? ' active' : '');
        btn.innerHTML = `<span class="dc-label">${d.label}</span><span class="dc-tag">${d.tag}</span>`;
        btn.addEventListener('click', () => {
          state.selectedDifficulty = d;
          chips.querySelectorAll('.diff-chip').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          // Don't auto-restart — change takes effect on next round
        });
        chips.appendChild(btn);
      });
      wrap.appendChild(chips);
      el.sourceControls.appendChild(wrap);
    }
  }

  // Walk dropped FileSystemEntry objects (handles nested folders) into a flat File[] list.
  function walkEntries(entries) {
    return new Promise((resolve) => {
      const files = [];
      let pending = 0;
      let done = false;

      function maybeFinish() {
        if (done && pending === 0) resolve(files);
      }

      function walk(entry) {
        if (entry.isFile) {
          pending++;
          entry.file((file) => { files.push(file); pending--; maybeFinish(); }, () => { pending--; maybeFinish(); });
        } else if (entry.isDirectory) {
          pending++;
          const reader = entry.createReader();
          const readBatch = () => {
            reader.readEntries((batch) => {
              if (!batch.length) { pending--; maybeFinish(); return; }
              batch.forEach(walk);
              readBatch();
            }, () => { pending--; maybeFinish(); });
          };
          readBatch();
        }
      }

      entries.forEach(walk);
      done = true;
      maybeFinish();
    });
  }

  // Lazily load JSZip from CDN (only when the user actually drops a .zip).
  let jszipLoadPromise = null;
  function ensureJSZip() {
    if (window.JSZip) return Promise.resolve();
    if (jszipLoadPromise) return jszipLoadPromise;
    jszipLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load the zip reader from the CDN. Check your connection, or unzip the file yourself and drop the audio files in directly.'));
      document.head.appendChild(script);
    });
    return jszipLoadPromise;
  }

  async function handleIncomingZip(zipFile) {
    setLibraryStatus(`Reading "${zipFile.name}"…`);
    try {
      await ensureJSZip();
    } catch (err) {
      setLibraryStatus(err.message, true);
      return;
    }
    try {
      const zip = await window.JSZip.loadAsync(zipFile);
      const audioExts = /\.(mp3|wav|flac|m4a|ogg|aac|aif|aiff)$/i;
      const entries = Object.values(zip.files).filter(f => !f.dir && audioExts.test(f.name));
      if (!entries.length) {
        setLibraryStatus('No audio files found inside that zip.', true);
        return;
      }
      let loaded = 0;
      for (const entry of entries) {
        setLibraryStatus(`Decoding ${loaded + 1} / ${entries.length}: ${entry.name.split('/').pop()}…`);
        try {
          const blob = await entry.async('blob');
          const file = new File([blob], entry.name.split('/').pop());
          await addFileToLibrary(file);
        } catch (e) { /* skip files that fail to decode */ }
        loaded++;
      }
      setLibraryStatus(`Loaded ${state.library.length} track${state.library.length === 1 ? '' : 's'} from "${zipFile.name}".`);
      renderLibraryList();
      await prepareRound();
      el.npLabel.textContent = state.currentBuffer ? 'Ready — press play' : 'No source loaded';
    } catch (err) {
      setLibraryStatus('Could not read that zip file — it may be corrupted or not a real zip.', true);
    }
  }

  async function handleIncomingFiles(fileList) {
    const audioExts = /\.(mp3|wav|flac|m4a|ogg|aac|aif|aiff)$/i;
    const files = fileList.filter(f => audioExts.test(f.name) || (f.type && f.type.startsWith('audio/')));
    if (!files.length) {
      setLibraryStatus('No audio files found in what was dropped/selected.', true);
      return;
    }
    let loaded = 0;
    for (const file of files) {
      setLibraryStatus(`Decoding ${loaded + 1} / ${files.length}: ${file.name}…`);
      try { await addFileToLibrary(file); } catch (e) { /* skip undecodable files */ }
      loaded++;
    }
    setLibraryStatus(`Loaded ${state.library.length} track${state.library.length === 1 ? '' : 's'}.`);
    renderLibraryList();
    await prepareRound();
    el.npLabel.textContent = state.currentBuffer ? 'Ready — press play' : 'No source loaded';
  }

  async function addFileToLibrary(file) {
    const ctx = ensureAudioCtx();
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const autoStart = findBestLoopStart(decoded, 14);
    const track = { name: file.name, buffer: decoded, autoStart, duration: decoded.duration };
    state.library.push(track);
    if (state.libraryIdx === -1) selectLibraryTrack(state.library.length - 1);
  }

  // Scan a buffer in short windows, score each by RMS energy, and pick the loudest
  // contiguous region as the default loop — avoids landing on intros/silence/fades.
  function findBestLoopStart(buffer, loopSeconds = 14) {
    const sr = buffer.sampleRate;
    const data = buffer.getChannelData(0);
    const total = data.length;
    const loopLen = Math.min(Math.floor(loopSeconds * sr), total);
    if (total <= loopLen) return 0;

    const windowSec = 1.0;
    const windowLen = Math.floor(windowSec * sr);
    const hop = windowLen; // non-overlapping windows for speed
    const numWindows = Math.floor(total / hop);
    const rms = new Float32Array(numWindows);

    for (let w = 0; w < numWindows; w++) {
      let sum = 0;
      const start = w * hop;
      const end = Math.min(start + windowLen, total);
      for (let i = start; i < end; i += 4) { // stride for speed on long files
        const v = data[i];
        sum += v * v;
      }
      rms[w] = Math.sqrt(sum / ((end - start) / 4));
    }

    const loopWindows = Math.max(1, Math.round(loopSeconds / windowSec));
    let bestScore = -1;
    let bestStartWindow = 0;
    for (let w = 0; w <= numWindows - loopWindows; w++) {
      let sum = 0;
      for (let k = 0; k < loopWindows; k++) sum += rms[w + k];
      const avg = sum / loopWindows;
      if (avg > bestScore) { bestScore = avg; bestStartWindow = w; }
    }
    return (bestStartWindow * hop) / sr;
  }

  function setLibraryStatus(msg, isError) {
    if (!el.libraryStatus) return;
    el.libraryStatus.textContent = msg;
    el.libraryStatus.classList.toggle('error', !!isError);
  }

  function renderLibraryList() {
    const list = document.getElementById('library-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.library.length) return;
    state.library.forEach((track, i) => {
      const item = document.createElement('div');
      item.className = 'builtin-item' + (i === state.libraryIdx ? ' selected' : '');
      const mins = Math.floor(track.duration / 60);
      const secs = Math.round(track.duration % 60).toString().padStart(2, '0');
      item.innerHTML = `<span>${track.name}</span><span class="bi-tag">${mins}:${secs}</span>`;
      item.addEventListener('click', async () => {
        stopPlayback();
        selectLibraryTrack(i);
        await prepareRound();
        el.npLabel.textContent = state.currentBuffer ? 'Ready — press play' : 'No source loaded';
      });
      list.appendChild(item);
    });
  }

  function selectLibraryTrack(i) {
    state.libraryIdx = i;
    const track = state.library[i];
    state.userBuffer = track.buffer;
    const maxStart = Math.max(0, track.duration - 6);
    el.loopStart.max = maxStart.toFixed(1);
    el.loopStart.value = Math.min(track.autoStart, maxStart).toFixed(1);
    el.loopRangeWrap.style.display = 'block';
    renderLibraryList();
  }

  function extractLoopFromUser(seconds = 14) {
    const ctx = ensureAudioCtx();
    const src = state.userBuffer;
    const startT = parseFloat(el.loopStart.value);
    const dur = Math.min(seconds, src.duration - startT);
    const frameCount = Math.floor(dur * src.sampleRate);
    const out = ctx.createBuffer(src.numberOfChannels, frameCount, src.sampleRate);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const channelData = src.getChannelData(ch);
      const startSample = Math.floor(startT * src.sampleRate);
      out.getChannelData(ch).set(channelData.subarray(startSample, startSample + frameCount));
    }
    return out;
  }

  // Roll a fresh target frequency/gain/Q for the level and prepare (but don't play) the source buffer.
  async function prepareRound() {
    const lvl = currentLevel();
    state.round.targetFreq = randRange(lvl.freqRange[0], lvl.freqRange[1]);
    // Use fixed difficulty gain if available, otherwise randomise within gainRange
    state.round.targetGain = state.selectedDifficulty
      ? state.selectedDifficulty.gain
      : randRange(lvl.gainRange[0], lvl.gainRange[1]);
    state.round.targetQ = randRange(lvl.qRange[0], lvl.qRange[1]);
    state.round.guessFreq = null;
    state.round.guessGain = null;
    state.round.resolved = false;
    state.isBoostedVersion = true;

    const ctx = ensureAudioCtx();

    if (lvl.sourceType === 'synth-pink') {
      state.currentBuffer = makePinkNoiseBuffer(ctx, 6);
    } else if (lvl.sourceType === 'synth-tone') {
      state.currentBuffer = makeToneBuffer(ctx, state.round.targetFreq, 3);
    } else if (lvl.sourceType === 'user-file') {
      if (!state.userBuffer) { state.currentBuffer = null; return; }
      state.currentBuffer = extractLoopFromUser(14);
    }

    el.btnPlay.disabled = !state.currentBuffer;
    el.btnToggleVersion.disabled = true; // only enable once playback actually starts
    el.btnSubmit.disabled = !state.currentBuffer;
  }

  async function resetRoundUI() {
    el.resultPanel.className = 'result';
    el.resultPanel.innerHTML = '';
    el.btnNext.style.display = 'none';
    el.btnSubmit.disabled = true;
    el.btnSubmit.style.display = 'block';
    el.npLabel.textContent = 'No source loaded';
    el.npDot.classList.remove('live');
    state.currentBuffer = null;
    const lvl = currentLevel();
    if (lvl.sourceType === 'user-file' && state.userBuffer) {
      el.loopRangeWrap.style.display = 'block';
    } else {
      el.loopRangeWrap.style.display = 'none';
    }
    await prepareRound();
    el.npLabel.textContent = state.currentBuffer ? 'Ready — press play' : 'No source loaded';
  }

  // ===========================================================
  // SCORING
  // ===========================================================

  function octaveError(guess, target) {
    return Math.abs(Math.log2(guess / target));
  }

  function verdictForOctaveError(err) {
    if (err < 0.15) return { tag: 'good', label: 'Nailed it' };
    if (err < 0.4) return { tag: 'good', label: 'Close — within half an octave' };
    if (err < 0.8) return { tag: 'mid', label: 'In the neighborhood' };
    return { tag: 'bad', label: 'Off by a fair distance' };
  }

  function submitGuess() {
    if (state.round.resolved) return;
    const lvl = currentLevel();
    const guessFreq = sliderToFreq(parseFloat(el.freqSlider.value));
    const guessGain = lvl.guessGain ? parseFloat(el.gainSlider.value) : null;
    state.round.guessFreq = guessFreq;
    state.round.guessGain = guessGain;
    state.round.resolved = true; // reveal visualizer target after submit

    const err = octaveError(guessFreq, state.round.targetFreq);
    const verdict = verdictForOctaveError(err);

    state.session.total++;
    if (verdict.tag === 'good') { state.session.correct++; state.session.streak++; }
    else { state.session.streak = 0; }
    state.session.errors.push(err);

    let gainNote = '';
    if (lvl.guessGain) {
      const gainErr = Math.abs(guessGain - state.round.targetGain);
      gainNote = ` Your gain guess was off by ${gainErr.toFixed(1)} dB (actual: ${state.round.targetGain.toFixed(1)} dB).`;
    }

    el.resultPanel.className = 'result show';
    el.resultPanel.innerHTML = `
      <span class="result-verdict ${verdict.tag}">${verdict.label}</span>
      You guessed <strong>${fmtFreq(guessFreq)}</strong>. The boost was at <strong>${fmtFreq(state.round.targetFreq)}</strong>
      (${(err).toFixed(2)} octaves off).${gainNote}
      <br><br>Use the A/B toggle to flip between the boosted and original (flat) version and really lock in the sound.
    `;

    el.btnSubmit.style.display = 'none';
    el.btnNext.style.display = 'block';

    addLogEntry(lvl, guessFreq, state.round.targetFreq, err, verdict.tag);
    updateStats();
  }

  function addLogEntry(lvl, guess, target, err, tag) {
    state.log.unshift({ levelName: lvl.name, guess, target, err, tag });
    if (state.log.length > 40) state.log.pop();
    renderLog();
  }

  function renderLog() {
    el.logEmpty.style.display = state.log.length ? 'none' : 'block';
    el.logList.innerHTML = '';
    state.log.forEach(entry => {
      const li = document.createElement('li');
      li.className = `log-item ${entry.tag}`;
      li.innerHTML = `
        <span class="li-left">
          <span class="li-level">${entry.levelName}</span>
          <span class="li-freq">${fmtFreq(entry.guess)} → ${fmtFreq(entry.target)}</span>
        </span>
        <span class="li-err">${entry.err.toFixed(2)} oct</span>
      `;
      el.logList.appendChild(li);
    });
  }

  function updateStats() {
    el.statStreak.textContent = state.session.streak;
    el.statScore.textContent = `${state.session.correct} / ${state.session.total}`;
    if (state.session.errors.length) {
      const avg = state.session.errors.reduce((a, b) => a + b, 0) / state.session.errors.length;
      el.statAvg.textContent = avg.toFixed(2) + ' oct';
    }
  }

  // ===========================================================
  // EVENT WIRING
  // ===========================================================

  // Start playback of state.currentBuffer. Returns true if successful.
  // Must be called inside a user-gesture context (click handler) for browser autoplay policy.
  function startPlayback() {
    if (!state.currentBuffer) return false;
    buildGraphAndPlay(state.currentBuffer);
    el.btnPlay.textContent = '■ Stop';
    el.btnPlay.classList.add('playing');
    el.npDot.classList.add('live');
    el.npLabel.textContent = `Playing — ${currentLevel().name} (boosted version)`;
    el.btnToggleVersion.disabled = false;
    el.btnToggleVersion.textContent = 'A/B: Boosted';
    return true;
  }

  el.freqSlider.addEventListener('input', () => {
    const f = sliderToFreq(parseFloat(el.freqSlider.value));
    el.guessReadout.textContent = fmtFreq(f);
  });

  el.gainSlider.addEventListener('input', () => {
    el.gainReadout.textContent = parseFloat(el.gainSlider.value).toFixed(1) + ' dB';
  });

  el.btnPlay.addEventListener('click', async () => {
    if (state.isPlaying) {
      stopPlayback();
      return;
    }
    if (!state.currentBuffer) {
      await prepareRound();
      if (!state.currentBuffer) return;
    }
    startPlayback();
  });

  el.btnToggleVersion.addEventListener('click', () => {
    if (!state.isPlaying) return;
    const next = !state.isBoostedVersion;
    setBoostedAudible(next);
    el.btnToggleVersion.textContent = next ? 'A/B: Boosted' : 'A/B: Original (flat)';
    el.npLabel.textContent = `Playing — ${currentLevel().name} (${next ? 'boosted' : 'original / flat'} version)`;
  });

  el.btnSubmit.addEventListener('click', submitGuess);

  el.btnNext.addEventListener('click', async () => {
    stopPlayback();
    el.resultPanel.className = 'result';
    el.resultPanel.innerHTML = '';
    el.btnNext.style.display = 'none';
    el.btnSubmit.style.display = 'block';
    el.btnSubmit.disabled = true;
    await prepareRound();
    // Auto-play — this click IS a user gesture so browser allows audio start
    if (!startPlayback()) {
      el.npLabel.textContent = 'No source loaded — load a file first';
    }
  });

  el.loopStart.addEventListener('change', () => { prepareRound(); });

  // ===========================================================
  // INIT
  // ===========================================================

  function init() {
    // Init difficulty from first level
    const lvl = currentLevel();
    state.selectedDifficulty = lvl.difficulties ? lvl.difficulties[0] : null;
    renderLevelNav();
    buildTicks();
    resizeCanvas();
    // Re-run after first paint in case layout wasn't fully settled at DOMContentLoaded
    requestAnimationFrame(resizeCanvas);
    el.levelName.textContent = lvl.name;
    el.levelHint.textContent = lvl.hint;
    el.gainGuessWrap.style.display = lvl.guessGain ? 'block' : 'none';
    renderSourceControls();
    el.guessReadout.textContent = fmtFreq(sliderToFreq(parseFloat(el.freqSlider.value)));
    el.gainReadout.textContent = parseFloat(el.gainSlider.value).toFixed(1) + ' dB';
    prepareRound();
    drawSpectrum();

    // keep idle canvas redrawing the guess marker as user drags, even when not playing
    setInterval(() => { if (!state.isPlaying) drawSpectrum(); }, 80);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
