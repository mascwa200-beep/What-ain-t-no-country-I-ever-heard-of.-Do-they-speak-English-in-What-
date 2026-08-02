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

    // ---- where a sound is happening ------------------------------------
    // Everything was mono and unattenuated: a volcano on the far side of the
    // planet arrived at exactly the same volume, and in exactly the same
    // place, as one under the cursor. `listen()` is fed the camera each
    // frame; `place()` turns a tile into pan, gain and muffling.
    let ear = null;   // {lon, lat, dist} in the renderer's terms
    function listen(lon, lat, dist) { ear = { lon, lat, dist }; }

    // returns {pan, gain, lp} for a world tile, or null when unpositioned
    function place(x, y, wW, wH) {
      if (!ear || x == null || y == null) return null;
      const lon = (x / (wW || 180)) * 360 - 180;
      const lat = 90 - (y / (wH || 120)) * 180;
      const d2r = Math.PI / 180;
      // angle between the listener's view axis and the event, on the sphere
      const clat = ear.lat * d2r, elat = lat * d2r;
      let dlon = (lon - ear.lon) * d2r;
      while (dlon > Math.PI) dlon -= 2 * Math.PI;
      while (dlon < -Math.PI) dlon += 2 * Math.PI;
      const cosAng = Math.sin(clat) * Math.sin(elat) +
                     Math.cos(clat) * Math.cos(elat) * Math.cos(dlon);
      const ang = Math.acos(Math.max(-1, Math.min(1, cosAng)));   // 0..PI
      // pan follows which side of the view axis it fell on
      const pan = Math.max(-1, Math.min(1, Math.cos(elat) * Math.sin(dlon) * 1.6));
      // the far side of the world is muffled by the whole planet
      const front = Math.max(0, Math.cos(ang));           // 1 facing, 0 at limb
      const behind = ang > Math.PI / 2;
      const zoom = ear.dist ? Math.max(0.35, Math.min(1.6, 2.4 / ear.dist)) : 1;
      const gain = (behind ? 0.12 : 0.25 + front * 0.75) * zoom;
      const lp = behind ? 420 : 700 + front * 3600;
      return { pan, gain, lp };
    }

    // one soft voice: detuned pair through a lowpass with envelope
    function voice(freq, dur, opts) {
      if (!enabled) return;
      const c = ensure(); if (!c) return; resume();
      opts = opts || {};
      // `when` lets a phrase be scheduled sample-accurately instead of
      // chained through setTimeout, which jittered audibly under load
      const t0 = c.currentTime + (opts.when || 0);
      const g = c.createGain();
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 0.6;
      let vol = opts.vol || 0.2;
      let lp = opts.lp || 2200;
      let node = g;

      // position it, if the caller said where it happened
      const p = opts.pos ? place(opts.pos[0], opts.pos[1], opts.pos[2], opts.pos[3]) : null;
      if (p) {
        vol *= p.gain;
        lp = Math.min(lp, p.lp);
        if (c.createStereoPanner) {
          const sp = c.createStereoPanner();
          sp.pan.value = p.pan;
          g.connect(sp); node = sp;
        }
      }
      if (vol < 0.0008) return;   // too far to bother rendering

      f.frequency.value = lp;
      const atk = opts.atk != null ? opts.atk : 0.02;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      f.connect(g); node.connect(opts.dest || sfxGain);
      const detunes = opts.detune || [0, 7];
      for (const dt of detunes) {
        const o = c.createOscillator();
        o.type = opts.type || 'sine';
        o.frequency.setValueAtTime(freq, t0);
        if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur);
        o.detune.value = dt;
        o.connect(f);
        o.start(t0); o.stop(t0 + dur + 0.05);
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

    // ---- ducking -------------------------------------------------------
    // An act of god used to sit at the same level as the pad behind it.
    // Big events now press the score down and let it swell back.
    function duck(amount, hold) {
      if (!musicGain || !ctx) return;
      const t = ctx.currentTime, base = musicBase();
      musicGain.gain.cancelScheduledValues(t);
      musicGain.gain.setValueAtTime(musicGain.gain.value, t);
      musicGain.gain.linearRampToValueAtTime(base * (1 - amount), t + 0.06);
      musicGain.gain.setTargetAtTime(base, t + (hold || 0.5), 0.9);
    }

    // ---- whispered prayers ---------------------------------------------
    // Prayers have always existed as text in a side panel. Nobody has ever
    // heard one. This is a breath, not a note: filtered noise shaped into
    // two or three syllables, pitched to the pad so a hundred of them can
    // overlap without turning into noise, and placed where the village is.
    // The effect is meant to sit just at the edge of hearing.
    function whisper(pos, fervor) {
      if (!enabled || !musicOn) return;
      const c = ensure(); if (!c) return; resume();
      const p = pos ? place(pos[0], pos[1], pos[2], pos[3]) : null;
      // A thunderclap carries from the far side of a planet; a whisper does
      // not. `place()` floors an occluded event at 0.12, so this cutoff sits
      // deliberately above that: prayers are only heard from the visible face.
      if (p && p.gain < 0.15) return;
      const syll = 2 + ((Math.random() * 2) | 0);
      const base = 0.014 * (0.6 + (fervor || 0.5) * 0.8) * (p ? p.gain : 1);
      let t = 0;
      for (let i = 0; i < syll; i++) {
        const dur = 0.14 + Math.random() * 0.13;
        const n = Math.floor(c.sampleRate * dur);
        const buf = c.createBuffer(1, n, c.sampleRate);
        const d = buf.getChannelData(0);
        // a vowel-ish envelope: breath in, breath out
        for (let s = 0; s < n; s++) {
          const u = s / n;
          d[s] = (Math.random() * 2 - 1) * Math.sin(u * Math.PI) * 0.9;
        }
        const src = c.createBufferSource(); src.buffer = buf;
        // two formants make noise read as a voice rather than as wind
        const f1 = c.createBiquadFilter();
        f1.type = 'bandpass'; f1.Q.value = 5.5;
        f1.frequency.value = 380 + Math.random() * 320;
        const f2 = c.createBiquadFilter();
        f2.type = 'bandpass'; f2.Q.value = 7;
        f2.frequency.value = 1100 + Math.random() * 900;
        const g = c.createGain();
        const t0 = c.currentTime + t;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(base, t0 + dur * 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(f1); f1.connect(f2); f2.connect(g);
        let out = g;
        if (p && c.createStereoPanner) {
          const sp = c.createStereoPanner();
          sp.pan.value = p.pan * 0.8;
          g.connect(sp); out = sp;
        }
        // prayers go through the hall, which is what makes them read as
        // coming from somewhere rather than from the speakers
        out.connect(verb); out.connect(musicGain);
        src.start(t0); src.stop(t0 + dur + 0.02);
        t += dur * (0.75 + Math.random() * 0.4);
      }
    }

    // set by sfx() for the duration of one effect so the individual voices
    // below do not each need the position threaded through them
    let curPos = null;
    const P = () => curPos;

    const SFX = {
      click:   () => voice(720, 0.09, { vol: 0.14, lp: 4000, detune: [0] }),
      select:  () => { voice(523, 0.14, { vol: 0.14 }); voice(784, 0.18, { vol: 0.12, when: 0.06 }); },
      spawn:   () => { voice(392, 0.3, { vol: 0.16, type: 'triangle', pos: P() }); voice(587, 0.4, { vol: 0.14, when: 0.08, pos: P() }); },
      terra:   () => { duck(0.35, 0.4); noiseBurst(0.5, 0.14, 500); subHit(90, 0.5, 0.25); },
      lightning: () => { duck(0.55, 0.5); noiseBurst(0.9, 0.5, 3200, 200); subHit(70, 1.1, 0.5); },
      meteor:  () => { duck(0.7, 1.2); voice(160, 1.2, { type: 'sawtooth', vol: 0.16, lp: 900, slideTo: 40, pos: P() }); noiseBurst(1.4, 0.5, 900); subHit(55, 1.6, 0.6); },
      fire:    () => noiseBurst(0.6, 0.2, 1800),
      rain:    () => noiseBurst(1.2, 0.14, 900, 400),
      bless:   () => { const q = P(); [659, 831, 988, 1319].forEach((f, i) => voice(f, 0.8, { vol: 0.1, atk: 0.05, when: i * 0.09, pos: q })); },
      plague:  () => voice(130, 1.2, { type: 'sawtooth', vol: 0.12, lp: 500, slideTo: 60, detune: [0, -15, 15], pos: P() }),
      quake:   () => { duck(0.6, 1.0); noiseBurst(1.6, 0.45, 260); subHit(40, 1.8, 0.7); },
      death:   () => voice(220, 0.35, { vol: 0.1, slideTo: 90, pos: P() }),
      build:   () => { voice(440, 0.12, { vol: 0.1, pos: P() }); voice(554, 0.14, { vol: 0.1, when: 0.07, pos: P() }); },
      war:     () => { voice(311, 0.3, { type: 'sawtooth', vol: 0.12, lp: 1200, pos: P() }); subHit(90, 0.5, 0.3); },
      levelup: () => { const q = P(); [523, 659, 784, 1047, 1319].forEach((f, i) => voice(f, 0.7, { vol: 0.12, atk: 0.03, when: i * 0.09, pos: q })); },
      error:   () => voice(150, 0.25, { type: 'sawtooth', vol: 0.1, lp: 600, slideTo: 90 })
    };

    // ---- an adaptive score ---------------------------------------------
    // The old score was four chords on a four-second timer, forever,
    // identical whether the world below was a paradise or a graveyard.
    // The palette now follows the state of creation.
    const PALETTES = {
      // serene: major sevenths, open and unhurried
      calm: {
        chords: [[220.00, 277.18, 329.63, 415.30], [174.61, 220.00, 261.63, 329.63],
                 [196.00, 246.94, 293.66, 369.99], [146.83, 220.00, 293.66, 349.23]],
        lead: [440, 493.88, 554.37, 659.26, 739.99, 880],
        lp: 1100, leadLp: 2600, rate: 1, density: 0.65, pad: 0.045
      },
      // war: minor seconds ground against the root, low and close
      war: {
        chords: [[146.83, 174.61, 220.00, 233.08], [130.81, 155.56, 196.00, 207.65],
                 [164.81, 196.00, 246.94, 261.63], [123.47, 146.83, 185.00, 196.00]],
        lead: [293.66, 311.13, 349.23, 415.30, 466.16],
        lp: 760, leadLp: 1500, rate: 0.8, density: 0.4, pad: 0.055
      },
      // plague: a diminished haze that never resolves
      plague: {
        chords: [[138.59, 164.81, 196.00, 233.08], [130.81, 155.56, 185.00, 220.00],
                 [146.83, 174.61, 207.65, 246.94], [123.47, 146.83, 174.61, 207.65]],
        lead: [277.18, 311.13, 369.99, 415.30],
        lp: 620, leadLp: 1200, rate: 1.25, density: 0.3, pad: 0.05
      },
      // glory: bright, wide, a fifth stacked on top
      glory: {
        chords: [[261.63, 329.63, 392.00, 493.88], [220.00, 277.18, 329.63, 440.00],
                 [246.94, 311.13, 369.99, 466.16], [196.00, 246.94, 293.66, 392.00]],
        lead: [523.25, 587.33, 659.26, 783.99, 880, 1046.50],
        lp: 1700, leadLp: 3800, rate: 0.9, density: 0.8, pad: 0.04
      },
      // the void: almost nothing, a long way off
      empty: {
        chords: [[110.00, 164.81, 220.00], [98.00, 146.83, 196.00]],
        lead: [220, 246.94, 293.66],
        lp: 460, leadLp: 900, rate: 1.6, density: 0.15, pad: 0.03
      }
    };
    let mood = 'calm', moodMix = 0;

    // The world tells the score what it is. Called from the game loop.
    function setMood(name) {
      if (!PALETTES[name] || name === mood) return;
      mood = name; moodMix = 0;
      // retune the running pad rather than cutting it off
      if (musicGain && ctx) musicGain.gain.setTargetAtTime(musicBase(), ctx.currentTime, 1.2);
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; startMusic(); }
    }
    function musicBase() {
      const p = PALETTES[mood] || PALETTES.calm;
      return (timeDir < 0 ? 0.16 : 0.28) * (p === PALETTES.empty ? 0.6 : 1);
    }

    function musicStep() {
      if (!musicOn || !enabled) return;
      const P = PALETTES[mood] || PALETTES.calm;
      const chord = P.chords[(step >> 1) % P.chords.length];
      const bend = timeDir < 0 ? 0.62 : 1;   // reversed time sags a fifth down
      if (step % 2 === 0) {
        for (const f of chord) {
          voice(f * bend, 7.5, { vol: P.pad, atk: 2.5, lp: timeDir < 0 ? 700 : P.lp, detune: [-6, 5], dest: musicGain });
        }
        voice(chord[0] / 2 * bend, 8, { vol: P.pad * 1.3, atk: 2.0, lp: 300, detune: [0], dest: musicGain });
      }
      if (Math.random() < P.density) {
        const f = P.lead[(Math.random() * P.lead.length) | 0] * bend;
        // schedule inside the bar instead of exactly on it
        voice(f, 2.4, { vol: 0.035, atk: 0.4, lp: P.leadLp, detune: [0, 4],
                        dest: musicGain, when: Math.random() * 1.6 });
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
      // sfx('lightning') still works; sfx('lightning', x, y) places it on
      // the globe and attenuates it against where the camera is looking
      sfx(name, x, y, wW, wH) {
        if (!SFX[name]) return;
        curPos = (x != null && y != null) ? [x, y, wW, wH] : null;
        try { SFX[name](); } finally { curPos = null; }
      },
      listen, whisper, duck, setMood,
      mood() { return mood; },
      setEnabled(v) { enabled = v; if (!v) stopMusic(); },
      setMusic(v) { musicOn = v; if (v && started) startMusic(); else stopMusic(); },
      isEnabled() { return enabled; },
      isMusic() { return musicOn; },
      // reversed time: drop the score into a detuned, sluggish drone
      setTimeDirection(d) {
        timeDir = d;
        if (!ctx) return;
        if (musicGain) musicGain.gain.setTargetAtTime(musicBase(), ctx.currentTime, 0.4);
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
