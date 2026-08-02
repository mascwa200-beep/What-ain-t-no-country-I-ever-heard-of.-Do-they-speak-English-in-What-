// Regression tests for Stage 4: the audio engine, which has never had any.
//
// WebAudio is stubbed with recording fakes, so these assert the graph that
// gets built and the numbers fed into it — panning, attenuation, muffling,
// scheduling, ducking — without needing a sound card.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = process.argv[2] || '.';

let fails = 0;
function check(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) fails++;
}

// ---- a recording WebAudio stub ----------------------------------------
function makeAudioStub() {
  const log = { osc: [], pan: [], gain: [], filter: [], buffers: [], starts: [] };
  const param = (name, owner) => ({
    _v: 0,
    get value() { return this._v; },
    set value(v) { this._v = v; if (name === 'pan') log.pan.push(v); if (name === 'freq') log.filter.push(v); },
    setValueAtTime(v, t) { this._v = v; owner && owner.push && owner.push({ op: 'set', v, t }); return this; },
    linearRampToValueAtTime(v, t) { owner && owner.push && owner.push({ op: 'lin', v, t }); return this; },
    exponentialRampToValueAtTime(v, t) { owner && owner.push && owner.push({ op: 'exp', v, t }); return this; },
    setTargetAtTime(v, t, c) { owner && owner.push && owner.push({ op: 'tgt', v, t }); return this; },
    cancelScheduledValues() { return this; }
  });
  const node = (type) => {
    const evts = [];
    const n = {
      type, _evts: evts,
      connect: (d) => d, disconnect() {},
      start(t) { log.starts.push({ type, t: t || 0 }); },
      stop() {}
    };
    if (type === 'gain') { n.gain = param('gain', evts); log.gain.push(n); }
    if (type === 'pan') { n.pan = param('pan'); }
    if (type === 'filter') { n.frequency = param('freq'); n.Q = param('q'); }
    if (type === 'osc') { n.frequency = param('freq', evts); n.detune = param('det'); log.osc.push(n); }
    return n;
  };
  const ctx = {
    sampleRate: 48000,
    currentTime: 10,
    state: 'running',
    destination: node('dest'),
    resume() { this.state = 'running'; },
    createGain: () => node('gain'),
    createBiquadFilter: () => node('filter'),
    createOscillator: () => node('osc'),
    createStereoPanner: () => node('pan'),
    createConvolver: () => ({ connect: (d) => d, buffer: null }),
    createBufferSource: () => node('src'),
    createBuffer: (ch, len) => {
      const b = { length: len, numberOfChannels: ch, _d: [] };
      for (let i = 0; i < ch; i++) b._d.push(new Float32Array(len));
      b.getChannelData = (i) => b._d[i];
      log.buffers.push(b);
      return b;
    }
  };
  return { ctx, log };
}

function loadAudio() {
  const { ctx: ac, log } = makeAudioStub();
  const sandbox = {
    console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set,
    parseInt, parseFloat, isNaN, isFinite, Date,
    Uint8Array, Uint16Array, Float32Array, Float64Array, ArrayBuffer,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => 0, setInterval: () => 1, clearInterval: () => 0,
    AudioContext: function () { return ac; }
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(base, 'js', 'util.js'), 'utf8'), sandbox, { filename: 'util.js' });
  return { A: sandbox.PD.Audio8, log, ac };
}

// -------------------------------------------------------------- placement
console.log('\n--- a sound happens somewhere ---');
{
  const { A, log } = loadAudio();
  A.setEnabled(true);
  check('the engine exposes the positional API',
    typeof A.listen === 'function' && typeof A.whisper === 'function' &&
    typeof A.duck === 'function' && typeof A.setMood === 'function');

  // camera looking at lon 0 / lat 0
  A.listen(0, 0, 2.4);

  // an event dead centre vs one at the limb vs one behind the planet
  const panAt = (x) => {
    log.pan.length = 0;
    A.sfx('death', x, 60, 180, 120);      // y=60 of 120 -> the equator
    return log.pan.length ? log.pan[log.pan.length - 1] : 0;
  };
  const centre = panAt(90);               // x=90 of 180 -> lon 0, dead ahead
  const right = panAt(125);               // east of the camera
  const left = panAt(55);                 // west of the camera
  check('a sound in front of the camera is centred', Math.abs(centre) < 0.05,
    centre.toFixed(3));
  check('a sound to the east pans right', right > 0.3, right.toFixed(3));
  check('a sound to the west pans left', left < -0.3, left.toFixed(3));
  check('the two are mirror images', Math.abs(right + left) < 0.06,
    right.toFixed(3) + ' vs ' + left.toFixed(3));

  // gain: dead ahead is loudest, the far side is nearly silent
  const gainAt = (x) => {
    log.gain.length = 0;
    A.sfx('death', x, 60, 180, 120);
    let peak = 0;
    for (const g of log.gain) for (const e of g._evts) if (e.op === 'lin') peak = Math.max(peak, e.v);
    return peak;
  };
  const gFront = gainAt(90), gLimb = gainAt(135), gBack = gainAt(0);
  check('the near side is louder than the limb', gFront > gLimb * 1.4,
    gFront.toFixed(4) + ' vs ' + gLimb.toFixed(4));
  check('the far side of the world is nearly silent', gBack < gFront * 0.4,
    gBack.toFixed(4) + ' vs ' + gFront.toFixed(4));

  // muffling: the far side is filtered down
  const lpAt = (x) => {
    log.filter.length = 0;
    A.sfx('death', x, 60, 180, 120);
    return Math.max.apply(null, log.filter.concat([0]));
  };
  check('the far side is muffled as well as quiet', lpAt(0) < lpAt(90),
    lpAt(0) + ' vs ' + lpAt(90));
}

// ------------------------------------------------------------- unpositioned
console.log('\n--- an unplaced sound still plays ---');
{
  const { A, log } = loadAudio();
  A.setEnabled(true);
  A.listen(0, 0, 2.4);
  log.osc.length = 0;
  A.sfx('click');                       // UI sounds have no world position
  check('a sound with no position is still rendered', log.osc.length > 0,
    log.osc.length + ' oscillators');
  check('and it is not panned', log.pan.length === 0);

  // and before the camera has ever reported in, nothing should throw
  const fresh = loadAudio();
  fresh.A.setEnabled(true);
  let threw = null;
  try { fresh.A.sfx('meteor', 10, 10, 180, 120); } catch (e) { threw = e; }
  check('placing a sound before the camera has reported does not throw',
    !threw, threw ? threw.message : '');
}

// ------------------------------------------------------------- scheduling
console.log('\n--- phrases are scheduled, not chained through timers ---');
{
  const { A, log, ac } = loadAudio();
  A.setEnabled(true);
  log.osc.length = 0;
  A.sfx('levelup');                     // a five-note rising figure
  check('the whole phrase is emitted in one call', log.osc.length >= 5,
    log.osc.length + ' oscillators');
  // each note should start at a distinct, increasing, future time
  const starts = log.osc.map(o => {
    const e = o._evts.find(e => e.op === 'set');
    return e ? e.t : 0;
  }).sort((a, b) => a - b);
  check('the notes are spread across future time, not stacked',
    starts[starts.length - 1] > starts[0],
    starts[0].toFixed(2) + ' .. ' + starts[starts.length - 1].toFixed(2));
  check('and every one is scheduled at or after now',
    starts.every(t => t >= ac.currentTime - 1e-6));
}

// ---------------------------------------------------------------- whispers
console.log('\n--- prayers are heard ---');
{
  const { A, log } = loadAudio();
  A.setEnabled(true);
  A.listen(0, 0, 2.4);
  // touch the engine first so the convolver's impulse response — a 2-channel
  // buffer built once in ensure() — is not mistaken for a syllable below
  A.sfx('click');
  const syllables = () => log.buffers.filter(b => b.numberOfChannels === 1);
  log.buffers.length = 0; log.starts.length = 0;
  A.whisper([90, 60, 180, 120], 0.8);
  check('a prayer builds a voice out of noise buffers', syllables().length >= 2,
    syllables().length + ' syllables');
  check('the syllables are separate sources', log.starts.length >= 2);
  const b = syllables()[0];
  const d = b.getChannelData(0);
  let peak = 0, mid = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  mid = Math.abs(d[Math.floor(d.length / 2)]);
  check('the syllable is shaped, not a flat block of noise',
    peak > 0 && mid > 0, 'peak ' + peak.toFixed(2));
  check('and it fades in from silence at the edges',
    Math.abs(d[0]) < peak * 0.35, Math.abs(d[0]).toFixed(4));

  // a prayer on the far side of the world should not be rendered at all
  log.buffers.length = 0;
  A.whisper([0, 60, 180, 120], 0.8);
  check('a prayer from the far side of the world is not heard',
    syllables().length === 0, syllables().length + ' syllables');

  // silence must be respected
  const q = loadAudio();
  q.A.setEnabled(false);
  q.log.buffers.length = 0;
  q.A.whisper([90, 60, 180, 120], 1);
  check('no prayer is voiced when sound is off',
    q.log.buffers.filter(b => b.numberOfChannels === 1).length === 0);
}

// ------------------------------------------------------------------- mood
console.log('\n--- the score follows the state of the world ---');
{
  const { A } = loadAudio();
  A.setEnabled(true);
  check('the score starts calm', A.mood() === 'calm', A.mood());
  A.setMood('war');
  check('war changes the palette', A.mood() === 'war', A.mood());
  A.setMood('plague');
  check('plague changes it again', A.mood() === 'plague', A.mood());
  A.setMood('nonsense');
  check('an unknown mood is ignored rather than breaking the score',
    A.mood() === 'plague', A.mood());
  A.setMood('empty');
  check('a dead world falls to the empty palette', A.mood() === 'empty');
}

// ------------------------------------------------------------------- duck
console.log('\n--- an act of god presses the score down ---');
{
  const { A, log } = loadAudio();
  A.setEnabled(true);
  A.unlock();
  const musicEvents = () => {
    let ramps = 0;
    for (const g of log.gain) for (const e of g._evts) if (e.op === 'lin' || e.op === 'tgt') ramps++;
    return ramps;
  };
  const before = musicEvents();
  A.duck(0.6, 0.8);
  check('ducking schedules a dip and a recovery', musicEvents() > before,
    (musicEvents() - before) + ' new ramps');
  let threw = null;
  try { const q = loadAudio(); q.A.duck(0.5, 0.5); } catch (e) { threw = e; }
  check('ducking before the engine is started does not throw',
    !threw, threw ? threw.message : '');
}

console.log('\n=== audio failures: ' + fails + ' ===');
console.log(fails === 0 ? 'AUDIO TEST PASSED' : 'AUDIO TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
