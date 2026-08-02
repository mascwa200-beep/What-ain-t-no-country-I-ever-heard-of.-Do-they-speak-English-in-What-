/* =========================================================================
   PIXEL DEITY — util.js
   Deterministic RNG, fractal value-noise, math helpers, and an 8-bit
   chiptune audio engine (WebAudio, no external assets).
   ========================================================================= */
(function (global) {
  'use strict';

  // ---- Seedable RNG (mulberry32) --------------------------------------
  function makeRNG(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // ---- Math helpers ----------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy;
  };
  const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

  // ---- Value noise with fractal octaves -------------------------------
  function makeNoise(seed) {
    const rng = makeRNG(seed);
    const perm = new Uint16Array(512);
    const grad = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; grad[i] = rng(); }
    for (let i = 255; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

    function valAt(ix, iy) {
      const h = perm[(ix & 255) + perm[iy & 255]];
      return grad[h];
    }
    // 2D value noise in [0,1]
    function noise2(x, y) {
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = smooth(x - x0), fy = smooth(y - y0);
      const v00 = valAt(x0, y0), v10 = valAt(x0 + 1, y0);
      const v01 = valAt(x0, y0 + 1), v11 = valAt(x0 + 1, y0 + 1);
      return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
    }
    // fractal Brownian motion
    function fbm(x, y, octaves, lacunarity, gain) {
      octaves = octaves || 5; lacunarity = lacunarity || 2; gain = gain || 0.5;
      let amp = 0.5, freq = 1, sum = 0, norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += amp * noise2(x * freq, y * freq);
        norm += amp; amp *= gain; freq *= lacunarity;
      }
      return sum / norm;
    }
    return { noise2, fbm };
  }

  // ---- Audio: cinematic ambient engine --------------------------------
  // The opposite of chiptune: convolution-reverbed pads, detuned voices,
  // sub-bass rumbles, airy shimmer — all synthesized, zero assets.
  const Audio8 = (function () {
    let ctx = null, master = null, musicGain = null, sfxGain = null, verb = null, verbGain = null;
    let enabled = true, musicOn = true, started = false;
    let musicTimer = null, windSrc = null, step = 0, timeDir = 1;

    function ensure() {
      if (ctx) return ctx;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { enabled = false; return null; }
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
      // generated impulse response: a big soft hall
      verb = ctx.createConvolver();
      const len = ctx.sampleRate * 2.4;
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
      verb.buffer = ir;
      verbGain = ctx.createGain(); verbGain.gain.value = 0.5;
      verb.connect(verbGain); verbGain.connect(master);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.28; musicGain.connect(master); musicGain.connect(verb);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master); sfxGain.connect(verb);
      return ctx;
    }
    function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

    // one soft voice: detuned pair through a lowpass with envelope
    function voice(freq, dur, opts) {
      if (!enabled) return;
      const c = ensure(); if (!c) return; resume();
      opts = opts || {};
      const g = c.createGain();
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = opts.lp || 2200; f.Q.value = 0.6;
      const atk = opts.atk != null ? opts.atk : 0.02;
      const vol = opts.vol || 0.2;
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.linearRampToValueAtTime(vol, c.currentTime + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      f.connect(g); g.connect(opts.dest || sfxGain);
      const detunes = opts.detune || [0, 7];
      for (const dt of detunes) {
        const o = c.createOscillator();
        o.type = opts.type || 'sine';
        o.frequency.setValueAtTime(freq, c.currentTime);
        if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), c.currentTime + dur);
        o.detune.value = dt;
        o.connect(f);
        o.start(); o.stop(c.currentTime + dur + 0.05);
      }
    }
    function blip(freq, dur, type, vol, dest, slideTo) {
      voice(freq, dur, { type: type === 'square' ? 'triangle' : type, vol: (vol || 0.3) * 0.9, dest, slideTo, lp: 3200 });
    }
    function noiseBurst(dur, vol, lp, hp) {
      if (!enabled) return;
      const c = ensure(); if (!c) return; resume();
      const n = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.6);
      const src = c.createBufferSource(); src.buffer = buf;
      const g = c.createGain(); g.gain.value = vol || 0.4;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 1200;
      src.connect(f);
      if (hp) { const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; f.connect(h); h.connect(g); }
      else f.connect(g);
      g.connect(sfxGain); src.start();
    }
    function subHit(freq, dur, vol) {
      voice(freq, dur, { type: 'sine', vol: vol || 0.4, lp: 300, detune: [0], slideTo: freq * 0.4 });
    }

    const SFX = {
      click:   () => voice(720, 0.09, { vol: 0.14, lp: 4000, detune: [0] }),
      select:  () => { voice(523, 0.14, { vol: 0.14 }); setTimeout(() => voice(784, 0.18, { vol: 0.12 }), 60); },
      spawn:   () => { voice(392, 0.3, { vol: 0.16, type: 'triangle' }); setTimeout(() => voice(587, 0.4, { vol: 0.14 }), 80); },
      terra:   () => { noiseBurst(0.5, 0.14, 500); subHit(90, 0.5, 0.25); },
      lightning: () => { noiseBurst(0.9, 0.5, 3200, 200); subHit(70, 1.1, 0.5); },
      meteor:  () => { voice(160, 1.2, { type: 'sawtooth', vol: 0.16, lp: 900, slideTo: 40 }); noiseBurst(1.4, 0.5, 900); subHit(55, 1.6, 0.6); },
      fire:    () => noiseBurst(0.6, 0.2, 1800),
      rain:    () => noiseBurst(1.2, 0.14, 900, 400),
      bless:   () => { [659, 831, 988, 1319].forEach((f, i) => setTimeout(() => voice(f, 0.8, { vol: 0.1, atk: 0.05 }), i * 90)); },
      plague:  () => voice(130, 1.2, { type: 'sawtooth', vol: 0.12, lp: 500, slideTo: 60, detune: [0, -15, 15] }),
      quake:   () => { noiseBurst(1.6, 0.45, 260); subHit(40, 1.8, 0.7); },
      death:   () => voice(220, 0.35, { vol: 0.1, slideTo: 90 }),
      build:   () => { voice(440, 0.12, { vol: 0.1 }); setTimeout(() => voice(554, 0.14, { vol: 0.1 }), 70); },
      war:     () => { voice(311, 0.3, { type: 'sawtooth', vol: 0.12, lp: 1200 }); subHit(90, 0.5, 0.3); },
      levelup: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => voice(f, 0.7, { vol: 0.12, atk: 0.03 }), i * 90)); },
      error:   () => voice(150, 0.25, { type: 'sawtooth', vol: 0.1, lp: 600, slideTo: 90 })
    };

    // generative ambient score: slow chord pads + sparse celestial melody
    const CHORDS = [
      [220.0, 277.18, 329.63, 415.30],  // Amaj7-ish
      [174.61, 220.0, 261.63, 329.63],  // Fmaj7
      [196.0, 246.94, 293.66, 369.99],  // G add
      [146.83, 220.0, 293.66, 349.23]   // Dm-ish
    ];
    const LEAD = [440, 493.88, 554.37, 659.26, 739.99, 880];
    function musicStep() {
      if (!musicOn || !enabled) return;
      const chord = CHORDS[(step >> 1) % CHORDS.length];
      const bend = timeDir < 0 ? 0.62 : 1;   // reversed time sags a fifth down
      if (step % 2 === 0) {
        for (const f of chord) {
          voice(f * bend, 7.5, { vol: 0.045, atk: 2.5, lp: timeDir < 0 ? 700 : 1100, detune: [-6, 5], dest: musicGain });
        }
        voice(chord[0] / 2 * bend, 8, { vol: 0.06, atk: 2.0, lp: 300, detune: [0], dest: musicGain });
      }
      if (Math.random() < 0.65) {
        const f = LEAD[(Math.random() * LEAD.length) | 0] * bend;
        voice(f, 2.4, { vol: 0.035, atk: 0.4, lp: 2600, detune: [0, 4], dest: musicGain });
      }
      step++;
    }
    function startMusic() {
      if (musicTimer || !enabled) return;
      const c = ensure(); if (!c) return;
      musicStep();
      musicTimer = setInterval(musicStep, 4000);
      // gentle stellar wind under everything
      if (!windSrc) {
        const n = c.sampleRate * 4;
        const buf = c.createBuffer(1, n, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        windSrc = c.createBufferSource(); windSrc.buffer = buf; windSrc.loop = true;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
        const g = c.createGain(); g.gain.value = 0.05;
        windSrc.connect(f); f.connect(g); g.connect(musicGain);
        windSrc.start();
      }
    }
    function stopMusic() {
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
      if (windSrc) { try { windSrc.stop(); } catch (e) {} windSrc = null; }
    }

    return {
      init() { ensure(); },
      unlock() { ensure(); resume(); if (musicOn) startMusic(); started = true; },
      sfx(name) { if (SFX[name]) SFX[name](); },
      setEnabled(v) { enabled = v; if (!v) stopMusic(); },
      setMusic(v) { musicOn = v; if (v && started) startMusic(); else stopMusic(); },
      isEnabled() { return enabled; },
      isMusic() { return musicOn; },
      // reversed time: drop the score into a detuned, sluggish drone
      setTimeDirection(d) {
        timeDir = d;
        if (!ctx) return;
        if (musicGain) musicGain.gain.setTargetAtTime(d < 0 ? 0.16 : 0.28, ctx.currentTime, 0.4);
        if (verbGain) verbGain.gain.setTargetAtTime(d < 0 ? 0.85 : 0.5, ctx.currentTime, 0.4);
      },
      suspend() { stopMusic(); if (ctx && ctx.state === 'running') ctx.suspend(); },
      resumeAll() { if (!enabled || !started) return; resume(); if (musicOn) startMusic(); }
    };
  })();

  // ---- Persistent storage --------------------------------------------
  // In the native Android app a JavascriptInterface bridge writes saves to
  // app-private files; everywhere else this falls back to localStorage.
  const store = (function () {
    const bridge = global.PixelDeityBridge;
    if (bridge && typeof bridge.getItem === 'function') {
      return {
        getItem(k) { try { return bridge.getItem(k); } catch (e) { return null; } },
        setItem(k, v) {
          const ok = bridge.setItem(k, String(v));
          if (ok === false) throw new Error('save write failed');
        },
        removeItem(k) { try { bridge.removeItem(k); } catch (e) {} }
      };
    }
    return {
      getItem(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      setItem(k, v) { localStorage.setItem(k, v); },
      removeItem(k) { try { localStorage.removeItem(k); } catch (e) {} }
    };
  })();

  global.PD = global.PD || {};
  Object.assign(global.PD, {
    makeRNG, hashSeed, makeNoise, Audio8,
    clamp, lerp, smooth, dist, dist2, store
  });
})(window);
