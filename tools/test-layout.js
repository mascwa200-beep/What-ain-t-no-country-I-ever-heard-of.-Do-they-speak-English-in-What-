// Layout fit test — does the chrome actually fit the screen it is given, and
// does any of it cover or clip any of the rest?
//
// This exists because it did not fit. On a Pixel 10 Pro XL in landscape
// (851x373 CSS px) the intro card's "LET THERE BE LIGHT" button sat 51px BELOW
// the fold with no way to scroll to it, the tab rail ran 85px past the bottom
// taking two tabs with it, and the 54px HUD bar painted its contents from
// y=-97 to y=151 straight over the canvas.
//
// It then spent a long time asserting only ONE state: the intro screen, with
// the game never started, no panel open, no inspector, no modal. Everything
// the player actually looks at went unmeasured, and the only question asked
// was "does anything hang off the edge" — never "does anything cover anything"
// or "is anything cut off with no way to reach it", which is the rest of the
// complaint.
//
// The reason it stayed that way through several attempts: --dump-dom prints
// the DOM once and exits. There is no click, re-measure, click again across
// separate launches. Every state has to be reached AND measured inside one
// page load, from the injected probe, and emitted as a single report. The
// lever that makes that safe is `G.running = false` — loop() reschedules
// itself and bails on that flag, so the rAF chain stops permanently and the
// game cannot rewrite #inspect, #event-log or the HUD between the moment a
// state is set up and the moment it is measured.
//
// Usage: node tools/test-layout.js [repoRoot] [chromePath]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// must be absolute: the probe is loaded as a file:// URL
const base = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const CHROME = process.argv[3] || process.env.CHROME_PATH ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// VIEWPORT sizes. These used to be window sizes, and headless Chrome
// subtracts its own chrome from them — by a different amount per build. The
// local Chromium reserved ~87px of height where the CI runner's Chrome
// reserved ~143px, so the identical config tested 851x393 here and 851x250
// there. The suite passed locally and failed in CI on viewports that had
// never been exercised locally at all. Now the launcher converges on the
// viewport we actually asked for, so both environments test the same thing.
const SIZES = [
  { name: 'pixel10xl-landscape', w: 851, h: 373 },   // the reported device
  { name: 'short-landscape',     w: 851, h: 306 },
  { name: 'tiny-landscape',      w: 740, h: 273 },
  // the extreme CI surfaced: at 217px tall the intro is the title and the
  // button, nothing else. Keep it in the list so that stays true.
  { name: 'min-landscape',       w: 740, h: 217 },
  // 500, not the Pixel's true 412: headless Chrome refuses to open a window
  // narrower than ~500px, so asking for 412 silently tested 500 anyway. The
  // narrow-width branch is `max-width:520px`, which 500 still exercises.
  { name: 'phone-portrait',      w: 500, h: 796 },
  { name: 'tablet',              w: 1024, h: 681 },
  { name: 'desktop',             w: 1600, h: 813 }
];

// Elements that must be fully on-screen, whatever the viewport.
const MUST_FIT = ['#intro-start', '#tab-rail', '#hud-top', '.hud-center', '.hud-right'];

// Only measure viewports/states named here, when set. For local iteration:
//   LAYOUT_VIEWPORTS=desktop LAYOUT_STATES=inspect-village-max node tools/test-layout.js
const ONLY_VP = (process.env.LAYOUT_VIEWPORTS || '').split(',').filter(Boolean);
const ONLY_ST = (process.env.LAYOUT_STATES || '').split(',').filter(Boolean);

const PROBE = `
<script>
(function () {
  var MUST = ${JSON.stringify(MUST_FIT)};
  var ONLY_ST = ${JSON.stringify(ONLY_ST)};

  // The chrome that may not cover, or be covered by, other chrome. #game and
  // #overlay are excluded outright: they are inset:0 under everything, so
  // they intersect all of it by design and are never culprit nor victim.
  var ROSTER = ['#hud-top', '#toolbar', '#tab-rail', '.side-panel.show',
                '#inspect.show', '#chronicle', '#toast.show',
                '#rewind-banner.show', '.modal-overlay.show > .modal'];
  // These float over the canvas on purpose and cannot be clicked through, so
  // they can never block anything. They are still checked as victims.
  var NEVER_CULPRIT = { '#toast': 1, '#rewind-banner': 1 };

  // setTimeout ONLY — never requestAnimationFrame.
  //
  // Under --virtual-time-budget, headless Chrome produces no animation
  // frames at all: there is no compositor driving them. A settle that awaits
  // a double-rAF therefore never resolves, the probe emits nothing, and the
  // run is indistinguishable from a browser that failed to launch. Verified
  // directly: a page that awaits setTimeout reaches its next statement, and
  // the identical page awaiting rAF does not.
  //
  // The same fact means the game's own rAF loop never runs here either, so
  // the DOM is naturally stable between setup and measurement. G.running is
  // still set false below — belt and braces, and it keeps this correct if
  // the suite ever moves off virtual time.
  function settle(ms) {
    return new Promise(function (r) { setTimeout(r, ms || 0); });
  }
  function $(s) { return document.querySelector(s); }
  function shown(e) {
    if (!e) return false;
    var cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) < 0.05) return false;   // toast parked off-screen
    return true;
  }
  function label(e) {
    return e.id ? '#' + e.id
      : e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ')[0];
  }
  // Content inside a scroll container is allowed to sit outside its box —
  // that is what scrolling is for. Check both axes.
  function inScroller(e) {
    for (var p = e.parentElement; p && p.id !== 'app'; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) || /(auto|scroll)/.test(cs.overflowX)) return true;
    }
    return false;
  }
  function rectOf(e) { return e.getBoundingClientRect(); }
  function area(r) { return Math.max(0, r.width) * Math.max(0, r.height); }
  function overlap(a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return (w > 0 && h > 0) ? { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
                                right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
                                width: w, height: h } : null;
  }

  // ---------------- the two new assertion classes ----------------

  // CLIPPING: part of an element's box lies outside a non-scrolling
  // overflow:hidden ancestor, with nothing in between able to scroll to
  // reveal it. Ordering matters: a scroller BELOW the hidden ancestor
  // rescues the content; a hidden ancestor below a scroller does not. That
  // is what tells #power-info inside #toolbar (no scroller between them —
  // clipped) from a .tool scrolled out of #tools (scroller — fine).
  function ellipsisExempt(e, p, ax, pcs) {
    // deliberate single-line truncation with a visible ellipsis affordance,
    // horizontally only (#planet-name). A hidden box that clips a CHILD
    // vertically is still a bug.
    return ax === 'x' && pcs.textOverflow !== 'clip'
      && /nowrap|pre$/.test(pcs.whiteSpace) && p.children.length === 0;
  }
  function clipReport(e) {
    var r = rectOf(e), out = [];
    var scrollableBelow = { x: false, y: false };
    for (var p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      var cs = getComputedStyle(p), pr = rectOf(p);
      var box = { l: pr.left + p.clientLeft, t: pr.top + p.clientTop,
                  r: pr.left + p.clientLeft + p.clientWidth,
                  b: pr.top + p.clientTop + p.clientHeight };
      var axes = ['x', 'y'];
      for (var ai = 0; ai < 2; ai++) {
        var ax = axes[ai];
        var ov = ax === 'x' ? cs.overflowX : cs.overflowY;
        if (/(auto|scroll)/.test(ov)) {
          var canScroll = ax === 'x' ? p.scrollWidth > p.clientWidth + 1
                                     : p.scrollHeight > p.clientHeight + 1;
          if (canScroll) scrollableBelow[ax] = true;
          continue;
        }
        if (!/(hidden|clip)/.test(ov)) continue;
        if (scrollableBelow[ax]) continue;
        var cut = ax === 'x' ? Math.max(box.l - r.left, r.right - box.r)
                             : Math.max(box.t - r.top, r.bottom - box.b);
        if (cut > 1.5 && !ellipsisExempt(e, p, ax, cs)) {
          out.push({ el: label(e), by: label(p), axis: ax, cut: Math.round(cut) });
        }
      }
    }
    return out;
  }

  // OCCLUSION: use the browser's own hit test rather than reimplementing
  // stacking contexts — it handles z-index, transforms, clip-path and
  // pointer-events for free, and its answer IS the product question ("can
  // the user press this?").
  // The part of an element that is actually on show: its own box clipped to
  // every scrolling ancestor's client box. A .tool halfway out of #tools has
  // its lower half behind #power-info, and sampling there says "unclickable"
  // when the honest answer is "scroll two pixels". Sample only the visible
  // part, or not at all if none of it is showing.
  function visibleRect(e) {
    var r = { left: e.getBoundingClientRect().left, top: e.getBoundingClientRect().top,
              right: e.getBoundingClientRect().right, bottom: e.getBoundingClientRect().bottom };
    for (var p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (!/(auto|scroll|hidden|clip)/.test(cs.overflowY) &&
          !/(auto|scroll|hidden|clip)/.test(cs.overflowX)) continue;
      var pr = p.getBoundingClientRect();
      var bl = pr.left + p.clientLeft, bt = pr.top + p.clientTop;
      r.left = Math.max(r.left, bl); r.top = Math.max(r.top, bt);
      r.right = Math.min(r.right, bl + p.clientWidth);
      r.bottom = Math.min(r.bottom, bt + p.clientHeight);
    }
    r.width = r.right - r.left; r.height = r.bottom - r.top;
    return r;
  }
  function samplePoints(r) {
    // never the corners: the panels carry a 10px clip-path chamfer, and
    // chamfered corners legitimately do not hit-test
    var fr = [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]], out = [];
    for (var i = 0; i < fr.length; i++) {
      var x = r.left + r.width * fr[i][0], y = r.top + r.height * fr[i][1];
      if (x < 0.5 || y < 0.5 || x > innerWidth - 0.5 || y > innerHeight - 0.5) continue;
      out.push([x, y]);
    }
    return out;
  }
  function hitBlocked(el, x, y) {
    var hit = document.elementFromPoint(x, y);
    if (!hit) return null;                       // outside the viewport: not covered
    if (hit === el || el.contains(hit)) return null;
    if (hit.contains(el)) return null;           // an ancestor hit means nothing is on top
    return hit;
  }
  // scrolled out of a scrolling ancestor's client box -> reachable by
  // scrolling, and hit-testing it would report whatever is behind it
  function scrolledAway(e) {
    var r = rectOf(e);
    for (var p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (!/(auto|scroll)/.test(cs.overflowY) && !/(auto|scroll)/.test(cs.overflowX)) continue;
      var pr = rectOf(p);
      if (r.bottom < pr.top + 1 || r.top > pr.bottom - 1 ||
          r.right < pr.left + 1 || r.left > pr.right - 1) return true;
    }
    return false;
  }
  var FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
  function occlusionReport() {
    var out = [];
    // When a modal overlay is up, covering everything is its job: only the
    // overlay subtree is asserted and everything beneath is exempt.
    var modal = document.querySelector('.modal-overlay.show');
    var roots = [];
    if (modal) roots = [modal];
    else {
      for (var i = 0; i < ROSTER.length; i++) {
        var e = document.querySelector(ROSTER[i]);
        if (e && shown(e)) roots.push(e);
      }
    }

    // (a) no control is unreachable
    for (var ri = 0; ri < roots.length; ri++) {
      var ctrls = roots[ri].querySelectorAll(FOCUSABLE);
      for (var ci = 0; ci < ctrls.length; ci++) {
        var c = ctrls[ci];
        if (!shown(c) || scrolledAway(c)) continue;
        var cr = visibleRect(c);
        if (cr.width < 4 || cr.height < 4) continue;   // only a sliver on show
        var pts = samplePoints(cr), blocked = 0, by = null;
        for (var pi = 0; pi < pts.length; pi++) {
          var h = hitBlocked(c, pts[pi][0], pts[pi][1]);
          if (h) { blocked++; by = by || label(h); }
        }
        // 1 of 5 is a chamfer or a border; 2+ is something on top of it
        if (pts.length && blocked >= 2) {
          out.push({ kind: 'control', victim: label(c), culprit: by,
                     blocked: blocked, of: pts.length, in: label(roots[ri]) });
        }
      }
    }

    // (b) no informative surface is buried. Pairwise over the roster only —
    // O(n^2) over #app * would yield thousands of meaningless parent/child
    // pairs.
    if (!modal) {
      for (var a = 0; a < roots.length; a++) for (var b = a + 1; b < roots.length; b++) {
        var A = roots[a], B = roots[b];
        if (A.contains(B) || B.contains(A)) continue;
        var la = label(A), lb = label(B);
        var ov = overlap(rectOf(A), rectOf(B));
        if (!ov) continue;
        // which one is on top? sample the intersection
        var lost = { a: 0, b: 0 }, n = 0;
        for (var gx = 1; gx <= 4; gx++) for (var gy = 1; gy <= 4; gy++) {
          var x = ov.left + ov.width * gx / 5, y = ov.top + ov.height * gy / 5;
          if (x < 0.5 || y < 0.5 || x > innerWidth - 0.5 || y > innerHeight - 0.5) continue;
          n++;
          var hit = document.elementFromPoint(x, y);
          if (!hit) continue;
          if (A.contains(hit) || hit === A) lost.b++;
          else if (B.contains(hit) || hit === B) lost.a++;
        }
        // pointer-events:none members never win a hit test; fall back to
        // z-index so they are still reported as victims
        var aNC = NEVER_CULPRIT[la], bNC = NEVER_CULPRIT[lb];
        var victim, culprit;
        if (aNC && !bNC) { victim = A; culprit = B; }
        else if (bNC && !aNC) { victim = B; culprit = A; }
        else if (lost.a > lost.b) { victim = A; culprit = B; }
        else if (lost.b > lost.a) { victim = B; culprit = A; }
        else continue;                                  // neither clearly on top
        var frac = area(ov) / Math.max(1, area(rectOf(victim)));
        if (frac > 0.02) {
          out.push({ kind: 'cover', victim: label(victim), culprit: label(culprit),
                     frac: Math.round(frac * 100) / 100,
                     w: Math.round(ov.width), h: Math.round(ov.height) });
        }
      }
    }
    return out;
  }

  function measure(id, note, synthetic) {
    var vw = innerWidth, vh = innerHeight;
    var st = { id: id, reached: true, note: note || '', synthetic: !!synthetic,
               must: [], spill: [], occl: [], clip: [] };
    for (var i = 0; i < MUST.length; i++) {
      var sel = MUST[i], e = document.querySelector(sel);
      if (!e || !shown(e)) { st.must.push({ sel: sel, skipped: true }); continue; }
      var r = rectOf(e);
      st.must.push({ sel: sel,
        overBottom: Math.round(Math.max(0, r.bottom - vh)),
        overTop: Math.round(Math.max(0, -r.top)),
        overRight: Math.round(Math.max(0, r.right - vw)),
        overLeft: Math.round(Math.max(0, -r.left)) });
    }
    var all = document.querySelectorAll('#app *');
    for (var k = 0; k < all.length; k++) {
      var e2 = all[k];
      if (!shown(e2)) continue;
      var r2 = rectOf(e2);
      if (r2.width === 0 || r2.height === 0) continue;
      if (!inScroller(e2) &&
          (r2.bottom > vh + 1 || r2.right > vw + 1 || r2.top < -1 || r2.left < -1)) {
        if (st.spill.length < 40) st.spill.push(label(e2) + ' [' + Math.round(r2.left) + ',' +
          Math.round(r2.top) + ' ' + Math.round(r2.width) + 'x' + Math.round(r2.height) + ']');
      }
      var cl = clipReport(e2);
      for (var ci2 = 0; ci2 < cl.length && st.clip.length < 20; ci2++) st.clip.push(cl[ci2]);
    }
    var oc = occlusionReport();
    for (var oi = 0; oi < oc.length && st.occl.length < 20; oi++) st.occl.push(oc[oi]);
    return st;
  }

  function resetToBaseline() {
    var cleared = [];
    var f = document.querySelectorAll('[data-probe-filler]');
    if (f.length) { cleared.push('fillers'); for (var i = 0; i < f.length; i++) f[i].remove(); }
    var open = document.querySelector('.side-panel.show');
    if (open) { cleared.push('panel'); var t = $('#tab-' + open.id.replace('panel-', '')); if (t) t.click(); }
    var ins = $('#inspect');
    if (ins && ins.classList.contains('show')) { cleared.push('inspect'); ins.classList.remove('show'); }
    if (window.G) window.G.selected = null;
    var mods = document.querySelectorAll('.modal-overlay.show');
    for (var m = 0; m < mods.length; m++) { cleared.push('modal'); mods[m].classList.remove('show'); }
    var to = $('#toast');
    if (to && to.classList.contains('show')) { cleared.push('toast'); to.classList.remove('show'); }
    var s = $('#tool-search');
    if (s && s.value) { cleared.push('search'); s.value = ''; s.dispatchEvent(new Event('input')); }
    // the top-HUD chips. A state that turns one on must not silently make the
    // NEXT state a different measurement than the one it claims to be.
    if (window.G && (G.sabbath || G.omniscient || (G.ui && G.ui.imagery !== 'base'))) {
      cleared.push('chips');
      G.sabbath = false; G.omniscient = false; G.omniAll = false;
      if (G.ui) G.ui.imagery = 'base';
      if (window.PD && PD.Render && PD.Render.setImagery && G.r) PD.Render.setImagery(G.r, true, 'base');
      var rt = $('#toggle-chips'); if (rt) { rt.innerHTML = ''; rt.style.display = 'none'; }
    }
    return cleared;
  }

  var report = { v: 2, states: [], errors: [] };

  function wanted(id) { return !ONLY_ST.length || ONLY_ST.indexOf(id) >= 0; }

  async function state(id, setup, note, synthetic) {
    if (!wanted(id)) return;
    try {
      var leaked = resetToBaseline();
      var extra = setup ? await setup() : null;
      await settle(40);
      var st = measure(id, note || (leaked.length ? 'baseline had to clear: ' + leaked.join(',') : ''), synthetic);
      if (extra) st.note = (st.note ? st.note + ' · ' : '') + extra;
      report.states.push(st);
    } catch (e) {
      report.states.push({ id: id, reached: false, note: String(e && e.message || e),
                           must: [], spill: [], occl: [], clip: [] });
      report.errors.push(id + ': ' + (e && e.message));
    }
  }

  // a tile owned by v that no living unit is standing near — selectAt prefers
  // any unit within 2.2 tiles, so aiming at a village centre usually selects
  // a passing critter instead
  function villagePoint(v) {
    for (var r = 0; r <= 5; r++)
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        var x = Math.floor(v.x) + dx, y = Math.floor(v.y) + dy;
        if (y < 0 || y >= G.world.H) continue;
        if (G.world.owner[PD.World.idx(G.world, x, y)] !== v.id) continue;
        var ok = true;
        for (var q = 0; q < G.sim.units.length; q++) {
          var u = G.sim.units[q];
          if (!u.dead && PD.World.wdist(G.world, u.x + 0.5, u.y + 0.5, x + 0.5, y + 0.5) < 2.5) { ok = false; break; }
        }
        if (ok) return { x: x + 0.5, y: y + 0.5 };
      }
    return null;
  }

  window.addEventListener('load', function () {
    // written in the first tick: tells "the page never loaded" apart from
    // "the probe started and never finished", and carries the viewport the
    // Node-side convergence loop needs without waiting for the machine
    var vp = document.createElement('div');
    vp.id = 'layout' + '-vp';
    vp.textContent = innerWidth + 'x' + innerHeight;
    vp.style.cssText = 'position:fixed;left:0;top:0;opacity:0.01;font-size:1px;pointer-events:none;';
    document.body.appendChild(vp);

    window.addEventListener('error', function (ev) {
      report.errors.push('window.onerror: ' + (ev && ev.message));
    });

    setTimeout(async function () {
      // Everything below runs inside try/finally so the report is emitted no
      // matter what. A probe that dies silently is indistinguishable from a
      // browser that never launched, and that ambiguity cost several rounds.
      try {
      // No await on document.fonts.ready: under --virtual-time-budget that
      // promise can simply never settle, and an awaited promise that never
      // resolves is a hang no try/catch can rescue — the probe emits nothing
      // and the run is indistinguishable from a browser that never launched.
      // The stylesheet loads no webfonts, so there is nothing to wait for.

      // 1. the intro, exactly as the suite has always measured it
      await state('intro', null, 'as loaded');

      // past the intro, then freeze
      report.boot = {};
      try {
        $('#intro-start').click();
        report.boot.introHidden = $('#intro').classList.contains('hide');
        if (window.PixelDeity && PixelDeity.setSpeedIdx) PixelDeity.setSpeedIdx(4);
        // a fixed seed so every viewport and every CI run measures the same
        // world — the single biggest flake killer here
        if (window.PixelDeity && PixelDeity.newMultiverse) PixelDeity.newMultiverse('pixel-deity-layout');
        await settle(400);
        report.boot.pixelDeity = !!window.PixelDeity;
        report.boot.renderer = !!(window.G && G.r);
        window.G.running = false;                 // the rAF chain stops here
        report.boot.frozen = window.G.running === false;
      } catch (e) { report.errors.push('boot: ' + (e && e.message)); }

      if (!report.boot || !report.boot.frozen) {
        report.errors.push('could not freeze the loop — later states are unreliable');
      }

      await state('game-idle', null, 'HUD, toolbar, rail, chronicle');

      await state('toolbar-expanded', async function () {
        var gs = document.querySelectorAll('.tool-group.collapsed .tool-group-title');
        for (var i = 0; i < gs.length; i++) gs[i].click();
        return gs.length + ' groups expanded';
      });

      // the tallest #power-info: #toolbar is overflow:hidden and cannot
      // scroll, #tools collapses to nothing under pressure, and #power-info
      // is flex:0 0 auto. Find the worst case by scanning rather than by
      // guessing which power has the longest greater-form description.
      await state('power-awe-max', async function () {
        var tools = document.querySelectorAll('#tools .tool');
        var best = null, bestH = -1;
        for (var i = 0; i < tools.length; i++) {
          tools[i].click();
          var h = $('#power-info').getBoundingClientRect().height;
          if (h > bestH) { bestH = h; best = tools[i]; }
        }
        if (best) best.click();
        return tools.length + ' powers scanned, tallest info ' + Math.round(bestH) + 'px';
      });

      await state('tool-search-empty', async function () {
        var s = $('#tool-search'); s.value = 'zzzz'; s.dispatchEvent(new Event('input'));
        return 'no power by that name';
      });

      await state('inspect-unit', async function () {
        var u = G.sim.units.filter(function (x) { return !x.dead; })[0];
        if (!u) throw new Error('no living unit');
        G.selectAt(u.x + 0.5, u.y + 0.5);
        if (!G.selected || G.selected.type !== 'unit') throw new Error('selected ' + (G.selected && G.selected.type));
        return 'unit dossier';
      });

      await state('inspect-village', async function () {
        for (var i = 0; i < G.sim.villages.length; i++) {
          var pt = villagePoint(G.sim.villages[i]);
          if (!pt) continue;
          G.selectAt(pt.x, pt.y);
          if (G.selected && G.selected.type === 'village') return 'village dossier';
        }
        throw new Error('no unit-free village tile');
      });

      // A dossier at t=0 is short: no nation, no trades. Rather than run the
      // sim until one matures (slow, and not deterministic), drive #inspect
      // to the height its own CSS permits — max-height lets it reach the
      // bottom edge, and #chronicle sits at bottom:102px with up to 170px of
      // height in the same column, so the overlap is there by construction.
      await state('inspect-village-max', async function () {
        for (var i = 0; i < G.sim.villages.length; i++) {
          var pt = villagePoint(G.sim.villages[i]);
          if (!pt) continue;
          G.selectAt(pt.x, pt.y);
          if (G.selected && G.selected.type === 'village') break;
        }
        var ins = $('#inspect'), guard = 0;
        while (ins.scrollHeight <= ins.clientHeight && guard++ < 200) {
          var f = document.createElement('div');
          f.className = 'ins-row'; f.setAttribute('data-probe-filler', '1');
          f.innerHTML = '<span>Filler</span><b>x</b>';
          ins.appendChild(f);
        }
        return guard + ' filler rows — a dossier this tall is ordinary once a nation and trades exist';
      }, null, true);

      var panels = ['cosmos', 'history', 'prayers', 'feed', 'souls', 'genesis', 'time', 'testament'];
      for (var pi2 = 0; pi2 < panels.length; pi2++) {
        (function (name) {
          // eslint-disable-next-line no-unused-vars
        })(panels[pi2]);
      }
      for (var p2 = 0; p2 < panels.length; p2++) {
        var nm = panels[p2];
        await state('panel-' + nm, (function (n) {
          return async function () { $('#tab-' + n).click(); return 'panel open'; };
        })(nm));
      }

      // a panel and the inspector at once — different z, same corner
      await state('panel+inspect', async function () {
        $('#tab-history').click();
        var u = G.sim.units.filter(function (x) { return !x.dead; })[0];
        if (u) G.selectAt(u.x + 0.5, u.y + 0.5);
        return 'history panel over the inspector';
      });

      await state('menu-modal', async function () { $('#btn-menu').click(); return 'menu'; });

      await state('toast', async function () {
        $('#btn-save').click();
        await settle(60);
        var t = $('#toast');
        if (!t.textContent.length) throw new Error('toast has no text');
        return 'toast: "' + t.textContent.slice(0, 40) + '"';
      });

      // The imagery chip is the acknowledgement NASA asks for, so it has to be
      // legible rather than merely present — and it lands in the top HUD next
      // to the sabbath and omniscience chips, which is the row most likely to
      // run out of width on a landscape phone. Force all three at once.
      await state('imagery-chip', async function () {
        var b = $('#btn-imagery');
        if (!b) throw new Error('no imagery toggle');
        G.sabbath = true; G.omniscient = true; G.omniAll = true;
        b.click();                       // base -> daily, the longest label
        var el = $('#toggle-chips');
        if (el.textContent.indexOf('NASA') < 0) throw new Error('no acknowledgement: ' + el.textContent);
        return 'chips: ' + el.textContent;
      });

      // deliberately trips the ellipsis exemption: if that exemption ever
      // breaks, one named state fails instead of every viewport
      await state('planet-name-long', async function () {
        $('#planet-name').textContent = '🪐 A World With An Unreasonably Long Name Indeed';
        return 'ellipsis exemption';
      });

      } catch (e) {
        report.errors.push('machine died: ' + (e && e.message) + ' @ ' +
          String((e && e.stack) || '').split('\\n').slice(0, 3).join(' | '));
      } finally {
        var d = document.createElement('div');
        d.id = 'layout' + '-probe';
        d.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(report))));
        d.style.cssText = 'position:fixed;left:0;top:0;opacity:0.01;font-size:1px;pointer-events:none;';
        document.body.appendChild(d);
      }
    }, 1200);
  });
})();
</script>
</body>`;

const probeFile = path.join(base, '_layout_probe.html');
fs.writeFileSync(probeFile, fs.readFileSync(path.join(base, 'index.html'), 'utf8')
  .replace('</body>', PROBE));

let failures = 0;
// The chrome the browser reserves is a property of the BUILD, not of the
// window — so measure it once and reuse it. Without this the convergence
// below doubles every launch, which took the CI layout step from ~4 minutes
// to 9 and put the job within two minutes of its own timeout.
let chromeOff = null;

// The payload is base64. --dump-dom HTML-escapes text, so a raw JSON blob
// came back with &quot; in it and every reader grew another .replace() in the
// unescape chain. base64 emits only [A-Za-z0-9+/=], so that whole class of
// bug is gone rather than patched again.
const readVp = (dom) => {
  const i = dom.indexOf('id="layout-vp"');
  if (i < 0) return null;
  const j = dom.indexOf('>', i) + 1, k = dom.indexOf('</div>', j);
  const m = /^(\d+)x(\d+)$/.exec(dom.slice(j, k).trim());
  return m ? { vw: +m[1], vh: +m[2] } : null;
};
const readReport = (dom) => {
  // anchored on the id, never on a sentinel word: the marker id is built by
  // concatenation in the probe so the literal never appears in its own source
  const i = dom.indexOf('id="layout-probe"');
  if (i < 0) return null;
  const j = dom.indexOf('>', i) + 1, k = dom.indexOf('</div>', j);
  try {
    const rep = JSON.parse(Buffer.from(dom.slice(j, k).trim(), 'base64').toString('utf8'));
    return rep && rep.v === 2 ? rep : null;
  } catch (e) { return null; }
};

try {
  for (const s of SIZES) {
    if (ONLY_VP.length && ONLY_VP.indexOf(s.name) < 0) continue;
    const t0 = Date.now();
    // Ask for a window, see what viewport we actually got, correct, ask
    // again. Two attempts converge on any build's chrome height.
    const shoot = (winW, winH) => {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-layout-'));
      try {
        return execFileSync(CHROME, [
          '--headless', '--no-sandbox', '--disable-dev-shm-usage',
          '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
          // the panels animate in over .15s and the modals over .2s; a rect
          // read mid-transition is scaled and reads as hidden on opacity.
          // styles.css already zeroes every duration under this query.
          '--force-prefers-reduced-motion',
          '--user-data-dir=' + profile,
          '--window-size=' + winW + ',' + winH, '--virtual-time-budget=20000', '--dump-dom',
          'file://' + probeFile
        ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, stdio: ['ignore', 'pipe', 'ignore'] });
      } finally {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
      }
    };

    let dom;
    try {
      // apply the known offset up front; only re-shoot if we still missed
      let winW = s.w + (chromeOff ? chromeOff.w : 0);
      let winH = s.h + (chromeOff ? chromeOff.h : 0);
      dom = shoot(winW, winH);
      const first = readVp(dom);
      if (first && (first.vw !== s.w || first.vh !== s.h)) {
        const dw = s.w - first.vw, dh = s.h - first.vh;
        chromeOff = { w: (winW - s.w) + dw, h: (winH - s.h) + dh };
        winW += dw; winH += dh;
        if (winW > 0 && winH > 0) {
          const again = shoot(winW, winH);
          if (readVp(again)) dom = again;
        }
      } else if (first && !chromeOff) {
        chromeOff = { w: winW - s.w, h: winH - s.h };
      }
    } catch (e) {
      console.log('  SKIP ' + s.name + ' — browser unavailable (' + e.code + ')');
      continue;
    }

    const vp = readVp(dom);
    const rep = readReport(dom);
    if (!vp) { console.log('\nFAIL ' + s.name + ' — the page never loaded'); failures++; continue; }
    if (!rep) {
      console.log('\nFAIL ' + s.name + ' — the probe started but never finished (viewport ' +
        vp.vw + 'x' + vp.vh + ')');
      failures++; continue;
    }

    console.log('\n' + s.name + ' — viewport ' + vp.vw + 'x' + vp.vh +
      (vp.vw === s.w && vp.vh === s.h ? '' : '  (asked for ' + s.w + 'x' + s.h + ')') +
      '  [' + rep.states.length + ' states, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's]');
    if (Math.abs(vp.vh - s.h) > 4 || Math.abs(vp.vw - s.w) > 4) {
      console.log('    FAIL — could not reach the requested viewport; ' +
                  'this run tested something other than what was asked for');
      failures++;
    }
    // A syntax error in game.js made every state unreachable, every state
    // report SKIP, and the whole run report PASSED — a completely broken game
    // came out green. An assertion that cannot run is a failure, not a pass.
    if (!rep.boot || !rep.boot.pixelDeity || !rep.boot.introHidden || !rep.boot.frozen) {
      console.log('    FAIL — the game did not come up; boot: ' + JSON.stringify(rep.boot || null));
      failures++;
    }

    for (const st of rep.states) {
      const bits = [];
      if (!st.reached) {
        console.log('    FAIL ' + st.id + ' — could not be reached: ' + st.note);
        failures++;
        continue;
      }
      let bad = 0;
      for (const m of st.must) {
        if (m.skipped) continue;
        const over = [];
        if (m.overBottom) over.push(m.overBottom + 'px below the fold');
        if (m.overTop) over.push(m.overTop + 'px above the top');
        if (m.overRight) over.push(m.overRight + 'px off the right');
        if (m.overLeft) over.push(m.overLeft + 'px off the left');
        if (over.length) { bits.push('FIT ' + m.sel + ' ' + over.join(', ')); bad++; }
      }
      if (st.spill.length) { bits.push('SPILL ' + st.spill.length + ': ' + st.spill.slice(0, 4).join(', ')); bad++; }
      if (st.clip.length) {
        bits.push('CLIP ' + st.clip.length + ': ' + st.clip.slice(0, 4).map(c =>
          c.el + ' cut ' + c.cut + 'px on ' + c.axis + ' by ' + c.by).join(', '));
        bad++;
      }
      if (st.occl.length) {
        bits.push('COVER ' + st.occl.length + ': ' + st.occl.slice(0, 4).map(o =>
          o.kind === 'control'
            ? o.victim + ' unclickable (' + o.blocked + '/' + o.of + ' blocked by ' + o.culprit + ')'
            : o.culprit + ' covers ' + Math.round(o.frac * 100) + '% of ' + o.victim).join(', '));
        bad++;
      }
      if (bad) {
        failures += bad;
        console.log('    FAIL ' + st.id + (st.synthetic ? ' (synthetic)' : '') +
          (st.note ? '  — ' + st.note : ''));
        for (const b of bits) console.log('           ' + b);
      } else {
        console.log('    PASS ' + st.id + (st.note ? '  — ' + st.note : ''));
      }
    }
    if (rep.errors && rep.errors.length) {
      for (const e of rep.errors) console.log('    note: ' + e);
    }
  }
} finally {
  try { fs.unlinkSync(probeFile); } catch (e) {}
}

console.log('\n=== layout failures: ' + failures + ' ===');
console.log('LAYOUT TEST ' + (failures ? 'FAILED' : 'PASSED'));
if (failures) process.exitCode = 1;
