// Layout fit test — does the chrome actually fit the screen it is given?
//
// This exists because it did not. On a Pixel 10 Pro XL in landscape (851x373
// CSS px) the intro card's "LET THERE BE LIGHT" button sat 51px BELOW the fold
// with no way to scroll to it, the tab rail ran 85px past the bottom taking
// two tabs with it, and the 54px HUD bar painted its contents from y=-97 to
// y=151 straight over the canvas.
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

// Window sizes, not viewport sizes — headless subtracts a little chrome.
const SIZES = [
  { name: 'pixel10xl-landscape', w: 851, h: 460 },   // the reported device
  { name: 'short-landscape',     w: 851, h: 393 },
  { name: 'tiny-landscape',      w: 740, h: 360 },
  { name: 'phone-portrait',      w: 412, h: 883 },
  { name: 'tablet',              w: 1024, h: 768 },
  { name: 'desktop',             w: 1600, h: 900 }
];

// Elements that must be fully on-screen, whatever the viewport.
const MUST_FIT = ['#intro-start', '#tab-rail', '#hud-top', '.hud-center', '.hud-right'];

const PROBE = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var vw = innerWidth, vh = innerHeight;
    // Content inside a scroll container is allowed to sit outside its box —
    // that is what scrolling is for. Check both axes.
    function inScroller(e) {
      for (var p = e.parentElement; p && p.id !== 'app'; p = p.parentElement) {
        var cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY) || /(auto|scroll)/.test(cs.overflowX)) return true;
      }
      return false;
    }
    function shown(e) {
      var cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) < 0.05) return false;   // toast parked off-screen
      return true;
    }
    function label(e) {
      return e.id ? '#' + e.id
        : e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ')[0];
    }
    var report = { vw: vw, vh: vh, must: [], spill: [] };
    ${JSON.stringify(MUST_FIT)}.forEach(function (sel) {
      var e = document.querySelector(sel);
      if (!e || !shown(e)) { report.must.push({ sel: sel, skipped: true }); return; }
      var r = e.getBoundingClientRect();
      report.must.push({
        sel: sel,
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right),
        overBottom: Math.round(Math.max(0, r.bottom - vh)),
        overTop: Math.round(Math.max(0, -r.top)),
        overRight: Math.round(Math.max(0, r.right - vw)),
        overLeft: Math.round(Math.max(0, -r.left))
      });
    });
    document.querySelectorAll('#app *').forEach(function (e) {
      if (!shown(e) || inScroller(e)) return;
      var r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.bottom > vh + 1 || r.right > vw + 1 || r.top < -1 || r.left < -1) {
        report.spill.push(label(e) + ' [' + Math.round(r.left) + ',' + Math.round(r.top) +
          ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ']');
      }
    });
    var d = document.createElement('div');
    d.id = 'layout-probe';
    d.textContent = JSON.stringify(report);
    d.style.cssText = 'position:fixed;left:0;top:0;opacity:0.01;font-size:1px;pointer-events:none;';
    document.body.appendChild(d);
  }, 1200);
});
</script>
</body>`;

const probeFile = path.join(base, '_layout_probe.html');
fs.writeFileSync(probeFile, fs.readFileSync(path.join(base, 'index.html'), 'utf8')
  .replace('</body>', PROBE));

let failures = 0;
try {
  for (const s of SIZES) {
    let dom;
    try {
      // a private profile per run: concurrent/rapid launches otherwise fight
      // over the default user-data-dir and die before the page ever loads
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-layout-'));
      try {
        dom = execFileSync(CHROME, [
          '--headless', '--no-sandbox', '--disable-dev-shm-usage',
          '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
          '--user-data-dir=' + profile,
          '--window-size=' + s.w + ',' + s.h, '--virtual-time-budget=8000', '--dump-dom',
          'file://' + probeFile
        ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, stdio: ['ignore', 'pipe', 'ignore'] });
      } finally {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
      }
    } catch (e) {
      console.log('  SKIP ' + s.name + ' — browser unavailable (' + e.code + ')');
      continue;
    }
    const i = dom.indexOf('id="layout-probe"');
    if (i < 0) { console.log('  FAIL ' + s.name + ' — probe never ran'); failures++; continue; }
    const j = dom.indexOf('>', i) + 1, k = dom.indexOf('</div>', j);
    const rep = JSON.parse(dom.slice(j, k).replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

    console.log('\n' + s.name + ' — viewport ' + rep.vw + 'x' + rep.vh);
    for (const m of rep.must) {
      if (m.skipped) { console.log('    --   ' + m.sel + ' (not shown)'); continue; }
      const over = [];
      if (m.overBottom) over.push(m.overBottom + 'px below the fold');
      if (m.overTop) over.push(m.overTop + 'px above the top');
      if (m.overRight) over.push(m.overRight + 'px off the right');
      if (m.overLeft) over.push(m.overLeft + 'px off the left');
      const ok = over.length === 0;
      if (!ok) failures++;
      console.log('    ' + (ok ? 'PASS' : 'FAIL') + ' ' + m.sel +
        (ok ? '  fits' : '  ' + over.join(', ')));
    }
    const ok = rep.spill.length === 0;
    if (!ok) failures++;
    console.log('    ' + (ok ? 'PASS' : 'FAIL') + ' nothing spills outside the viewport' +
      (ok ? '' : ' — ' + rep.spill.length + ': ' + rep.spill.slice(0, 8).join(', ')));
  }
} finally {
  try { fs.unlinkSync(probeFile); } catch (e) {}
}

console.log('\n=== layout failures: ' + failures + ' ===');
console.log('LAYOUT TEST ' + (failures ? 'FAILED' : 'PASSED'));
if (failures) process.exitCode = 1;
