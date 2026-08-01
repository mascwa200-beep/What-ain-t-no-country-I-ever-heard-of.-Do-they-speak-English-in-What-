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

  // ---- Audio: 8-bit chiptune synth ------------------------------------
  const Audio8 = (function () {
    let ctx = null, master = null, musicGain = null, sfxGain = null;
    let enabled = true, musicOn = true, started = false;
    let musicTimer = null, step = 0;

    function ensure() {
      if (ctx) return ctx;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { enabled = false; return null; }
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.22; musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.55; sfxGain.connect(master);
      return ctx;
    }
    function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

    function blip(freq, dur, type, vol, dest, slideTo) {
      if (!enabled) return;
      const c = ensure(); if (!c) return; resume();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), c.currentTime + dur);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(vol || 0.3, c.currentTime + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(dest || sfxGain);
      o.start(); o.stop(c.currentTime + dur + 0.02);
    }

    // Noise burst (for explosions / fire / thunder)
    function noiseBurst(dur, vol, lp) {
      if (!enabled) return;
      const c = ensure(); if (!c) return; resume();
      const n = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(); src.buffer = buf;
      const g = c.createGain(); g.gain.value = vol || 0.4;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 1200;
      src.connect(f); f.connect(g); g.connect(sfxGain); src.start();
    }

    // Named sound effects
    const SFX = {
      click:   () => blip(660, 0.05, 'square', 0.25),
      select:  () => { blip(523, 0.05, 'square', 0.25); setTimeout(() => blip(784, 0.06, 'square', 0.22), 45); },
      spawn:   () => { blip(392, 0.06, 'triangle', 0.3); setTimeout(() => blip(587, 0.08, 'triangle', 0.28), 55); },
      terra:   () => blip(196, 0.12, 'sawtooth', 0.2, null, 320),
      lightning: () => { noiseBurst(0.35, 0.5, 900); blip(120, 0.3, 'sawtooth', 0.25, null, 40); },
      meteor:  () => { blip(90, 0.6, 'sawtooth', 0.3, null, 30); noiseBurst(0.7, 0.6, 700); },
      fire:    () => noiseBurst(0.25, 0.25, 1600),
      rain:    () => noiseBurst(0.5, 0.18, 500),
      bless:   () => { blip(659, 0.1, 'triangle', 0.25); setTimeout(() => blip(988, 0.12, 'triangle', 0.22), 90); setTimeout(() => blip(1319, 0.14, 'triangle', 0.2), 190); },
      plague:  () => blip(146, 0.4, 'sawtooth', 0.2, null, 90),
      quake:   () => { noiseBurst(0.8, 0.5, 300); blip(60, 0.7, 'sine', 0.35, null, 30); },
      death:   () => blip(220, 0.12, 'square', 0.18, null, 90),
      build:   () => { blip(440, 0.04, 'square', 0.2); setTimeout(() => blip(554, 0.05, 'square', 0.18), 40); },
      war:     () => { blip(311, 0.08, 'sawtooth', 0.22); setTimeout(() => blip(233, 0.1, 'sawtooth', 0.2), 70); },
      levelup: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.1, 'square', 0.25), i * 70)); },
      error:   () => blip(120, 0.15, 'sawtooth', 0.2, null, 80)
    };

    // Simple generative ambient music (procedural chiptune arpeggios)
    const SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor
    const ROOT = 220;
    const CHORDS = [[0, 3, 7], [ -2, 2, 5], [3, 7, 10], [ -4, 0, 3]];
    function noteFreq(semi) { return ROOT * Math.pow(2, semi / 12); }
    function musicStep() {
      if (!musicOn || !enabled) return;
      const chord = CHORDS[(step >> 3) % CHORDS.length];
      const bassNote = chord[0] - 12;
      if (step % 4 === 0) blip(noteFreq(bassNote), 0.32, 'triangle', 0.28, musicGain);
      const arp = chord[step % chord.length] + (Math.random() < 0.25 ? 12 : 0);
      blip(noteFreq(arp), 0.18, 'square', 0.13, musicGain);
      if (step % 8 === 6) blip(noteFreq(SCALE[(step) % SCALE.length] + 12), 0.15, 'square', 0.1, musicGain);
      step++;
    }
    function startMusic() {
      if (musicTimer || !enabled) return;
      ensure();
      musicTimer = setInterval(musicStep, 200);
    }
    function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

    return {
      init() { ensure(); },
      unlock() { ensure(); resume(); if (musicOn) startMusic(); started = true; },
      sfx(name) { if (SFX[name]) SFX[name](); },
      setEnabled(v) { enabled = v; if (!v) stopMusic(); },
      setMusic(v) { musicOn = v; if (v && started) startMusic(); else stopMusic(); },
      isEnabled() { return enabled; },
      isMusic() { return musicOn; },
      // stop creating oscillator nodes while the tab is hidden
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
