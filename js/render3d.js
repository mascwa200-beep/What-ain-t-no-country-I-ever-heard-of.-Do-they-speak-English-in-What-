/* =========================================================================
   PIXEL DEITY — render3d.js
   The Solar-Smash view: a real 3D planet in space. Custom WebGL engine —
   no libraries. The 8-bit tile world is baked by render.js into a pixel
   texture and wrapped around a displaced sphere: real mountains, oceans
   with sun-glint, a sweeping day/night terminator, city lights on the
   dark side, burning forests glowing from orbit, clouds, atmosphere,
   starfield, and full-3D particle physics with gravity toward the core.
   The heavens and hells render as their own orbs.
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;
  const R2 = PD.Render2D;
  const TILE = R2.TILE;

  // ---------- tiny mat4 ----------
  function mat4Persp(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function mat4LookAt(eye, at, up) {
    let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
    let zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    let xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
  }
  function mat4Mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
    return o;
  }

  // ---------- world <-> sphere mapping ----------
  // tile (x,y) -> unit sphere point. y=0 is the north pole row.
  function tileToSphere(world, x, y, out, lift) {
    const lon = (x / world.W) * Math.PI * 2;
    const lat = Math.PI / 2 - (y / world.H) * Math.PI;
    const r = 1 + (lift || 0);
    const cl = Math.cos(lat);
    out[0] = r * cl * Math.sin(lon);
    out[1] = r * Math.sin(lat);
    out[2] = r * cl * Math.cos(lon);
    return out;
  }
  function sphereToTile(world, p) {
    const len = Math.hypot(p[0], p[1], p[2]) || 1;
    const lat = Math.asin(PD.clamp(p[1] / len, -1, 1));
    let lon = Math.atan2(p[0], p[2]);
    if (lon < 0) lon += Math.PI * 2;
    return {
      x: W.wrapX(world, (lon / (Math.PI * 2)) * world.W),
      y: PD.clamp((Math.PI / 2 - lat) / Math.PI * world.H, 0, world.H - 0.01)
    };
  }

  // ---------- shaders ----------
  const VS_PLANET = `
attribute vec3 aPos; attribute vec2 aUV; attribute float aH;
uniform mat4 uMVP; uniform float uDisp; uniform float uSea;
varying vec2 vUV; varying vec3 vN; varying float vLand;
void main(){
  float h = max(aH - uSea, 0.0);
  vec3 p = aPos * (1.0 + h * uDisp);
  vUV = aUV; vN = aPos; vLand = h;
  gl_Position = uMVP * vec4(p, 1.0);
}`;
  const FS_PLANET = `
precision mediump float;
varying vec2 vUV; varying vec3 vN; varying float vLand;
uniform sampler2D uTex; uniform sampler2D uData; uniform sampler2D uNorm;
uniform vec3 uSun; uniform vec3 uEye; uniform vec3 uAtmo;
uniform float uBlood; uniform float uDoom; uniform float uTime;
void main(){
  vec3 base = texture2D(uTex, vUV).rgb;
  vec4 data = texture2D(uData, vUV); // r=city light g=water b=fire a=crackmask
  vec3 Ns = normalize(vN);
  // tangent frame on the sphere: east (d/dlon) and south (d/dgrid-y)
  vec3 east = normalize(vec3(Ns.z, 0.0, -Ns.x) + vec3(0.0001));
  vec3 south = normalize(cross(east, Ns));
  vec3 Nt = texture2D(uNorm, vUV).xyz * 2.0 - 1.0;
  vec3 N = normalize(east * Nt.x + south * Nt.y + Ns * max(Nt.z, 0.2));
  float diff = max(dot(N, uSun), 0.0);
  float terminator = max(dot(Ns, uSun), 0.0);
  float light = 0.16 + 1.05 * diff;
  vec3 col = base * light;
  // warm sunlight, cool skylight ambient
  col += base * vec3(0.10, 0.12, 0.18) * (1.0 - diff);
  // specular: crisp on water, faint sheen on land
  vec3 V = normalize(uEye);
  vec3 H = normalize(uSun + V);
  float spec = pow(max(dot(N, H), 0.0), mix(10.0, 90.0, data.g));
  col += vec3(1.0, 0.97, 0.9) * spec * mix(0.06, 0.55, data.g) * terminator;
  // night side: the cities are awake
  float night = 1.0 - smoothstep(0.0, 0.18, terminator);
  col += vec3(1.0, 0.82, 0.45) * data.r * night * 1.7;
  col += vec3(0.4, 0.5, 0.9) * data.r * night * 0.3; // cool halo
  // wildfire glow visible from orbit
  float flick = 0.75 + 0.25 * sin(uTime * 18.0 + vUV.x * 200.0 + vUV.y * 140.0);
  col += vec3(1.0, 0.45, 0.1) * data.b * flick * 1.7;
  // doomed core: magma cracks bleed through the crust
  col += vec3(1.0, 0.25, 0.05) * data.a * uDoom * (0.7 + 0.3 * sin(uTime * 6.0));
  // blood moon tint
  col = mix(col, col * vec3(1.5, 0.5, 0.5), uBlood * 0.45);
  // atmosphere rim scattering
  float rim = pow(1.0 - max(dot(Ns, V), 0.0), 2.2);
  col += uAtmo * rim * (0.22 + 0.55 * terminator);
  // filmic-ish tonemap + gamma
  col = col / (col + vec3(0.62)) * 1.55;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.18);            // gentle saturation lift
  col = pow(max(col, 0.0), vec3(0.95));
  gl_FragColor = vec4(col, 1.0);
}`;
  const VS_CLOUD = `
attribute vec3 aPos; attribute vec2 aUV;
uniform mat4 uMVP; uniform float uScroll;
varying vec2 vUV; varying vec3 vN;
void main(){ vUV = vec2(aUV.x + uScroll, aUV.y); vN = aPos; gl_Position = uMVP * vec4(aPos * 1.035, 1.0); }`;
  const FS_CLOUD = `
precision mediump float;
varying vec2 vUV; varying vec3 vN;
uniform sampler2D uTex; uniform vec3 uSun;
void main(){
  float a = texture2D(uTex, vUV).r;
  float diff = max(dot(normalize(vN), uSun), 0.0);
  gl_FragColor = vec4(vec3(0.66 + 0.6 * diff), a * 0.5);
}`;
  const VS_ATMO = `
attribute vec3 aPos; uniform mat4 uMVP; varying vec3 vN;
void main(){ vN = aPos; gl_Position = uMVP * vec4(aPos * 1.10, 1.0); }`;
  const FS_ATMO = `
precision mediump float;
varying vec3 vN; uniform vec3 uEye; uniform vec3 uAtmo;
void main(){
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(uEye))), 2.0);
  gl_FragColor = vec4(uAtmo, rim * 0.6);
}`;
  const VS_PTS = `
attribute vec3 aPos; attribute vec4 aCol; attribute float aSize;
uniform mat4 uMVP; varying vec4 vCol;
void main(){ vCol = aCol; gl_Position = uMVP * vec4(aPos, 1.0); gl_PointSize = aSize / max(gl_Position.w, 0.001); }`;
  const FS_PTS = `
precision mediump float; varying vec4 vCol;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d,d);
  if (r2 > 0.25) discard;
  float soft = smoothstep(0.25, 0.02, r2);
  gl_FragColor = vec4(vCol.rgb * (0.85 + soft * 0.5), vCol.a * soft);
}`;
  const VS_LINE = `
attribute vec3 aPos; attribute vec4 aCol; uniform mat4 uMVP; varying vec4 vCol;
void main(){ vCol = aCol; gl_Position = uMVP * vec4(aPos, 1.0); }`;
  const FS_LINE = `
precision mediump float; varying vec4 vCol;
void main(){ gl_FragColor = vCol; }`;

  function compile(gl, vsSrc, fsSrc) {
    function sh(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const out = { p, a: {}, u: {} };
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) { const info = gl.getActiveAttrib(p, i); out.a[info.name] = gl.getAttribLocation(p, info.name); }
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i); out.u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
    return out;
  }

  // ---------- 3D particle FX (same API surface the sim & powers call) ----
  const FX = (function () {
    const parts = [];      // {p:[3], v:[3], life, max, col:[4], size, grav}
    const MAX = 5000;
    const rings = [];      // {x,y,r,max,life,max2,col}
    const bolts = [];      // {pts:[[x,y]..] tile coords, life, max}
    let world = null;      // bound by renderer
    const tmp = [0, 0, 0];

    function col4(hex, a) {
      const c = R2.hexToRgb(hex);
      return [c[0] / 255, c[1] / 255, c[2] / 255, a == null ? 1 : a];
    }
    // tile coords + tile-space velocity -> 3D pos/vel on the sphere
    function emit(x, y, vx, vy, life, color, size, grav) {
      if (!world || parts.length >= MAX) return;
      tileToSphere(world, x, y, tmp, 0.012);
      const p = [tmp[0], tmp[1], tmp[2]];
      // tangent basis: east & south
      const lon = (x / world.W) * Math.PI * 2;
      const ex = Math.cos(lon), ez = -Math.sin(lon);
      const n = p, nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const nx = n[0] / nl, ny = n[1] / nl, nz = n[2] / nl;
      // south = normal x east
      const sx = ny * 0 - nz * ez, sy = nz * ex - nx * 0, sz = nx * ez - ny * ex;
      const k = 0.03; // tile velocity -> world velocity scale
      const up = (grav && grav < 0) ? 0.02 : 0.006;
      parts.push({
        p,
        v: [(vx * ex + vy * sx) * k + nx * up, (vx * 0 + vy * sy) * k + ny * up, (vx * ez + vy * sz) * k + nz * up],
        life, max: life, col: typeof color === 'string' ? col4(color) : color,
        size: (size || 1) * 26, grav: grav || 0
      });
    }
    return {
      parts, rings, bolts,
      bind(w) { world = w; },
      spawn(x, y, vx, vy, life, color, size, grav) { emit(x, y, vx, vy, life, color, size, grav); },
      blood(x, y) { for (let i = 0; i < 4; i++) emit(x, y, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, 18, '#b02a2a', 1, 0.004); },
      hit(x, y) { for (let i = 0; i < 3; i++) emit(x, y, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, 9, '#ffe066', 1); },
      puff(x, y, c) { for (let i = 0; i < 8; i++) emit(x, y, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, 24, c || '#cfd6df', 1.6, -0.001); },
      spark(x, y, c) { for (let i = 0; i < 10; i++) emit(x, y, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35, 18, c || '#ffe680', 1); },
      fireBurst(x, y) { for (let i = 0; i < 14; i++) emit(x, y, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 22, ['#ff5722', '#ffb020', '#ffe066'][(Math.random() * 3) | 0], 1.8, -0.002); },
      explosion(x, y, big) {
        const n = big ? 70 : 30;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * 6.283, s = Math.random() * (big ? 0.7 : 0.4);
          emit(x, y, Math.cos(a) * s, Math.sin(a) * s, 26 + Math.random() * 24, ['#fff2a0', '#ff9a20', '#ff4020', '#7a2a10'][(Math.random() * 4) | 0], big ? 2.6 : 1.8, 0.002);
        }
        if (big && world) this.streak(x, y); // the rock that did it, coming in hot
        this.shock(x, y, big ? 6 : 3, big ? '#ffb060' : '#ffe0a0');
      },
      // an incoming orbital streak toward (x,y)
      streak(x, y) {
        if (!world) return;
        const target = tileToSphere(world, x, y, [0, 0, 0], 0.01);
        const dir = [Math.random() - 0.5, Math.random() * 0.6 + 0.4, Math.random() - 0.5];
        const dl = Math.hypot(dir[0], dir[1], dir[2]);
        for (let i = 0; i < 16; i++) {
          const t = i / 16;
          const px = target[0] + dir[0] / dl * t * 2.2, py = target[1] + dir[1] / dl * t * 2.2, pz = target[2] + dir[2] / dl * t * 2.2;
          parts.push({ p: [px, py, pz], v: [-dir[0] / dl * 0.09, -dir[1] / dl * 0.09, -dir[2] / dl * 0.09], life: 10 + t * 12, max: 22, col: [1, 0.7 - t * 0.3, 0.2, 1], size: (2.6 - t * 1.8) * 26, grav: 0 });
        }
      },
      lightning(x, y) { for (let i = 0; i < 22; i++) emit(x, y, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 12, '#d0e8ff', 1.6); },
      shock(x, y, r, colr) { rings.push({ x, y, r: 0.2, max: r, life: 24, max2: 24, col: typeof colr === 'string' ? col4(colr, 0.8) : (colr || [1, 1, 1, 0.8]) }); },
      bolt(x0, y0, x1, y1) {
        const pts = [[x1, y1]];
        // in 3D the bolt drops from the sky above the strike point
        bolts.push({ pts, life: 9, max: 9, sky: true });
        this.lightning(x1, y1);
      },
      update() {
        // under reversed time everything falls upward and inward again
        const dir = (global.G && global.G.speed < 0) ? -1 : 1;
        for (let i = parts.length - 1; i >= 0; i--) {
          const q = parts[i];
          q.p[0] += q.v[0] * dir; q.p[1] += q.v[1] * dir; q.p[2] += q.v[2] * dir;
          // spherical gravity: everything falls back to the world
          if (q.grav) {
            const l = Math.hypot(q.p[0], q.p[1], q.p[2]) || 1;
            const g = q.grav * 0.06;
            q.v[0] -= q.p[0] / l * g; q.v[1] -= q.p[1] / l * g; q.v[2] -= q.p[2] / l * g;
          }
          if (--q.life <= 0) parts.splice(i, 1);
        }
        for (let i = rings.length - 1; i >= 0; i--) {
          const r = rings[i]; r.r += r.max / r.max2; if (--r.life <= 0) rings.splice(i, 1);
        }
        for (let i = bolts.length - 1; i >= 0; i--) { if (--bolts[i].life <= 0) bolts.splice(i, 1); }
      },
      clear() { parts.length = 0; rings.length = 0; bolts.length = 0; }
    };
  })();

  // ---------- renderer ----------
  function createRenderer(canvas, world) {
    let gl = null;
    try {
      gl = canvas.getContext('webgl2', { antialias: true, alpha: false }) ||
           canvas.getContext('webgl', { antialias: true, alpha: false });
    } catch (e) { gl = null; }
    // detect stub/headless contexts that aren't real WebGL
    let headless = true;
    try { headless = !(gl && gl.createShader && gl.createShader(35633)); } catch (e) { headless = true; }

    // pixel-art terrain bake target (texture source)
    const terra = document.createElement('canvas');
    terra.width = world.W * TILE; terra.height = world.H * TILE;
    const tctx = terra.getContext('2d');

    // 2D overlay for labels / cursor / weather / minimap
    const overlay = document.getElementById('overlay');
    const octx = overlay ? overlay.getContext('2d') : null;

    const cam = { lon: 0.6, lat: 0.45, dist: 2.6, min: 1.25, max: 6.5, idle: 0 };

    const r = {
      gl, canvas, world, terra, tctx, cam, headless,
      overlay, octx,
      w: 0, h: 0, dpr: 1,
      weather: 'clear', rainDrops: [], snowFlakes: [],
      lastPick: null, texDirty: true,
      resize() {
        this.dpr = Math.min(2, global.devicePixelRatio || 1);
        this.w = canvas.clientWidth || 800; this.h = canvas.clientHeight || 600;
        canvas.width = Math.floor(this.w * this.dpr);
        canvas.height = Math.floor(this.h * this.dpr);
        if (overlay) {
          overlay.width = Math.floor(this.w * this.dpr);
          overlay.height = Math.floor(this.h * this.dpr);
          if (octx) octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }
        if (gl && !headless) gl.viewport(0, 0, canvas.width, canvas.height);
        this.initWeather();
      },
      initWeather() {
        this.rainDrops = [];
        for (let i = 0; i < 200; i++) this.rainDrops.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: 3 + Math.random() * 4 });
        this.snowFlakes = [];
        for (let i = 0; i < 150; i++) this.snowFlakes.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: 0.5 + Math.random(), d: Math.random() * 6.28 });
      }
    };

    FX.bind(world);
    bakeTerrain(r);

    if (!headless) initGL(r);
    r.resize();
    return r;
  }

  // ================= HD terrain bake ===================================
  // No more chunky tiles. Per-pixel albedo + normal maps are baked from
  // bilinearly-sampled world fields, with hypsometric ramps, depth-graded
  // oceans, beaches, forest mottling, snowlines, city districts and
  // micro-detail — then lit per-pixel by the shader. Photorealism from
  // math, not gigabytes of assets.
  //
  // Speed matters: everything expensive is precomputed once per bake into
  // tile-resolution fields, sampling is hoisted per row, and all noise
  // comes from a wrapping lookup tile instead of live fBm.
  const HD = 8;          // baked pixels per tile -> 1440x960 for a 180x120 world
  const NT = 256;        // detail-noise tile size (wraps)
  const SEA = 0.38;

  const HD_COLORS = {
    2:  [214, 196, 148], 3:  [92, 138, 62],  4:  [44, 94, 48],
    5:  [125, 101, 74],  6:  [120, 118, 120], 7: [235, 240, 246],
    8:  [204, 168, 110], 9:  [36, 104, 54],  10: [84, 104, 66],
    11: [56, 50, 52],    12: [92, 44, 52],   13: [255, 92, 20],
    14: [235, 238, 248], 15: [222, 198, 112], 16: [66, 96, 80],
    17: [44, 36, 66]
  };

  // per-renderer scratch: tile-resolution fields + noise LUT
  function ensureFields(r) {
    const w = r.world, n = w.n;
    if (!r.f || r.f.n !== n) {
      r.f = {
        n, cr: new Float32Array(n), cg: new Float32Array(n), cb: new Float32Array(n),
        water: new Float32Array(n), lava: new Float32Array(n), tree: new Float32Array(n),
        gx: new Float32Array(n), gy: new Float32Array(n)
      };
    }
    if (!r.noiseTile) {
      const nz = PD.makeNoise(0xD37A11);
      const t1 = new Float32Array(NT * NT), t2 = new Float32Array(NT * NT);
      for (let y = 0; y < NT; y++) for (let x = 0; x < NT; x++) {
        // crossfade with a shifted copy so the tile wraps seamlessly
        const u = x / NT, v = y / NT;
        const a1 = nz.fbm(x * 0.09, y * 0.09, 3), b1 = nz.fbm((x - NT) * 0.09, y * 0.09, 3);
        const c1 = nz.fbm(x * 0.09, (y - NT) * 0.09, 3), d1 = nz.fbm((x - NT) * 0.09, (y - NT) * 0.09, 3);
        t1[y * NT + x] = ((a1 * (1 - u) + b1 * u) * (1 - v) + (c1 * (1 - u) + d1 * u) * v);
        const a2 = nz.fbm(x * 0.023 + 40, y * 0.023, 4), b2 = nz.fbm((x - NT) * 0.023 + 40, y * 0.023, 4);
        const c2 = nz.fbm(x * 0.023 + 40, (y - NT) * 0.023, 4), d2 = nz.fbm((x - NT) * 0.023 + 40, (y - NT) * 0.023, 4);
        t2[y * NT + x] = ((a2 * (1 - u) + b2 * u) * (1 - v) + (c2 * (1 - u) + d2 * u) * v);
      }
      r.noiseTile = t1; r.noiseTile2 = t2;
    }
  }

  // Rebuild the tile-resolution source fields the pixel bake samples from.
  function buildFields(r) {
    const w = r.world, f = r.f, W2 = w.W, H2 = w.H;
    for (let i = 0; i < w.n; i++) {
      const b = w.biome[i];
      const c = HD_COLORS[b];
      f.cr[i] = c ? c[0] : 60; f.cg[i] = c ? c[1] : 70; f.cb[i] = c ? c[2] : 90;
      f.water[i] = W.isWater(b) ? 1 : 0;
      f.lava[i] = b === 13 ? 1 : 0;
      f.tree[i] = w.tree[i];
    }
    // elevation gradients (wrap in x, clamp at poles) for the normal map
    for (let y = 0; y < H2; y++) {
      const row = y * W2;
      const up = (y > 0 ? y - 1 : 0) * W2, dn = (y < H2 - 1 ? y + 1 : H2 - 1) * W2;
      for (let x = 0; x < W2; x++) {
        const xr = x === W2 - 1 ? 0 : x + 1, xl = x === 0 ? W2 - 1 : x - 1;
        f.gx[row + x] = w.elev[row + xr] - w.elev[row + xl];
        f.gy[row + x] = w.elev[dn + x] - w.elev[up + x];
      }
    }
  }

  // Bake a rectangle of output pixels [px0,px0+pw) x [py0,py0+ph).
  // Row-hoisted, direct-indexed, LUT noise: ~50x faster than naive per-pixel fBm.
  function bakeRect(r, px0, py0, pw, ph) {
    const w = r.world, f = r.f;
    const W2 = w.W, H2 = w.H, Wp = W2 * HD, Hp = H2 * HD;
    const alb = r.albedo, nrm = r.normal;
    const nt = r.noiseTile, nt2 = r.noiseTile2;
    const elev = w.elev, struct = w.struct;
    const invHD = 1 / HD;

    for (let yy = 0; yy < ph; yy++) {
      const py = py0 + yy;
      if (py < 0 || py >= Hp) continue;
      // sample position in tile space (pixel centers offset by half a tile)
      let fy = py * invHD - 0.5;
      if (fy < 0) fy = 0; else if (fy > H2 - 1.001) fy = H2 - 1.001;
      const y0 = fy | 0, ty = fy - y0;
      const y1 = y0 + 1 < H2 ? y0 + 1 : H2 - 1;
      const r0 = y0 * W2, r1 = y1 * W2;
      const nrow = (py & (NT - 1)) * NT;
      const nrow2 = ((py >> 2) & (NT - 1)) * NT;
      const sy = (py * invHD + 0.5) | 0;
      const srow = (sy < H2 ? sy : H2 - 1) * W2;

      for (let xx = 0; xx < pw; xx++) {
        let px = px0 + xx;
        if (px >= Wp) px -= Wp; else if (px < 0) px += Wp;
        let fx = px * invHD - 0.5;
        if (fx < 0) fx += W2;
        const x0 = fx | 0, tx = fx - x0;
        const x1 = x0 + 1 < W2 ? x0 + 1 : 0;

        const i00 = r0 + x0, i10 = r0 + x1, i01 = r1 + x0, i11 = r1 + x1;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;

        const e = elev[i00] * w00 + elev[i10] * w10 + elev[i01] * w01 + elev[i11] * w11;
        const water = f.water[i00] * w00 + f.water[i10] * w10 + f.water[i01] * w01 + f.water[i11] * w11;
        const lava = f.lava[i00] * w00 + f.lava[i10] * w10 + f.lava[i01] * w01 + f.lava[i11] * w11;
        const tree = f.tree[i00] * w00 + f.tree[i10] * w10 + f.tree[i01] * w01 + f.tree[i11] * w11;

        const nse = nt[nrow + (px & (NT - 1))];
        const nse2 = nt2[nrow2 + ((px >> 2) & (NT - 1))];

        let rr, gg, bb;
        if (lava > 0.5) {
          const gl = 0.75 + nse * 0.5;
          rr = 255 * gl; gg = 88 * gl; bb = 18 * gl;
        } else if (water > 0.5) {
          // ocean: depth-graded blues with a hint of swell
          let depth = (SEA - e) * 4.2; depth = depth < 0 ? 0 : depth > 1 ? 1 : depth;
          const inv = 1 - depth;
          rr = 18 + inv * 44;
          gg = 62 + inv * 92 + nse * 8;
          bb = 118 + inv * 92 + nse * 10;
        } else {
          rr = f.cr[i00] * w00 + f.cr[i10] * w10 + f.cr[i01] * w01 + f.cr[i11] * w11;
          gg = f.cg[i00] * w00 + f.cg[i10] * w10 + f.cg[i01] * w01 + f.cg[i11] * w11;
          bb = f.cb[i00] * w00 + f.cb[i10] * w10 + f.cb[i01] * w01 + f.cb[i11] * w11;
          const shade = 0.82 + nse2 * 0.36;
          rr *= shade; gg *= shade; bb *= shade;
          // forest mottling
          if (tree > 0.3) {
            const dark = 1 - tree * 0.085 * (0.6 + nse);
            rr *= dark; gg *= dark * 1.04; bb *= dark;
          }
          let alt = (e - SEA) / (1 - SEA);
          if (alt < 0) alt = 0; else if (alt > 1) alt = 1;
          if (alt > 0.55) {
            let rockT = (alt - 0.55) / 0.2; if (rockT > 1) rockT = 1;
            rockT *= 0.7;
            rr += (118 - rr) * rockT; gg += (114 - gg) * rockT; bb += (118 - bb) * rockT;
          }
          const snowLine = 0.72 + nse * 0.06;
          if (alt > snowLine) {
            let snowT = (alt - snowLine) / 0.12; if (snowT > 1) snowT = 1;
            rr += (240 - rr) * snowT; gg += (244 - gg) * snowT; bb += (250 - bb) * snowT;
          }
          // beaches kiss the waterline
          if (e < SEA + 0.02) {
            const bt = ((SEA + 0.02 - e) / 0.02) * 0.6;
            rr += (214 - rr) * bt; gg += (196 - gg) * bt; bb += (150 - bb) * bt;
          }
          const micro = 0.92 + nse * 0.16;
          rr *= micro; gg *= micro; bb *= micro;
          // settlements: warm rooftops, plazas, gilded wonders
          const st = struct[srow + ((px * invHD + 0.5) | 0) % W2];
          if (st) {
            const cellN = nt[((py * 3) & (NT - 1)) * NT + ((px * 3) & (NT - 1))];
            if (cellN > 0.45) {
              const gold = st === W.S.WONDER;
              const urban = (st === W.S.TOWN || gold) ? 1 : 0.7;
              const tr = gold ? 235 : 188, tg = gold ? 205 : 158, tb = gold ? 92 : 128;
              rr = rr * 0.35 + tr * 0.65 * urban;
              gg = gg * 0.35 + tg * 0.65 * urban;
              bb = bb * 0.35 + tb * 0.65 * urban;
            }
          }
        }

        const o = (py * Wp + px) * 4;
        // Uint8Array wraps on overflow, so clamp: an over-bright snow peak
        // would otherwise wrap its blue channel to zero and turn yellow
        alb[o] = rr > 255 ? 255 : rr < 0 ? 0 : rr;
        alb[o + 1] = gg > 255 ? 255 : gg < 0 ? 0 : gg;
        alb[o + 2] = bb > 255 ? 255 : bb < 0 ? 0 : bb;
        alb[o + 3] = 255;

        // normal map from the interpolated elevation gradient (+ land micro-relief)
        const gx = f.gx[i00] * w00 + f.gx[i10] * w10 + f.gx[i01] * w01 + f.gx[i11] * w11;
        const gy = f.gy[i00] * w00 + f.gy[i10] * w10 + f.gy[i01] * w01 + f.gy[i11] * w11;
        const isWater = water > 0.5;
        const k = isWater ? 2.5 : 26;
        const mx = isWater ? 0 : (nt[nrow + ((px + 3) & (NT - 1))] - nse) * 0.9;
        const my = isWater ? 0 : (nt[((py + 3) & (NT - 1)) * NT + (px & (NT - 1))] - nse) * 0.9;
        const nx = -(gx * k + mx), ny = -(gy * k + my);
        const nl = Math.sqrt(nx * nx + ny * ny + 1);
        nrm[o] = (nx / nl * 0.5 + 0.5) * 255;
        nrm[o + 1] = (ny / nl * 0.5 + 0.5) * 255;
        nrm[o + 2] = (1 / nl * 0.5 + 0.5) * 255;
        nrm[o + 3] = 255;
      }
    }
  }

  function bakeTerrain(r) {
    const w = r.world;
    const Wp = w.W * HD, Hp = w.H * HD;
    ensureFields(r);
    if (!r.albedo || r.albedo.length !== Wp * Hp * 4) {
      r.albedo = new Uint8Array(Wp * Hp * 4);
      r.normal = new Uint8Array(Wp * Hp * 4);
    }
    buildFields(r);
    bakeRect(r, 0, 0, Wp, Hp);
    w.dirty = false; w.dirtyTiles.length = 0;
    r.texDirty = true;
    r.heightsDirty = true;
    r.subRects = null;
  }

  // Refresh the source fields for one tile and the neighbours whose
  // gradients depend on it — the per-frame path must not touch all 21,600.
  function updateFieldsAt(r, tx, ty) {
    const w = r.world, f = r.f, W2 = w.W, H2 = w.H;
    for (let dy = -1; dy <= 1; dy++) {
      const y = ty + dy;
      if (y < 0 || y >= H2) continue;
      const row = y * W2;
      const up = (y > 0 ? y - 1 : 0) * W2, dn = (y < H2 - 1 ? y + 1 : H2 - 1) * W2;
      for (let dx = -1; dx <= 1; dx++) {
        const x = ((tx + dx) % W2 + W2) % W2;
        const i = row + x;
        const b = w.biome[i], c = HD_COLORS[b];
        f.cr[i] = c ? c[0] : 60; f.cg[i] = c ? c[1] : 70; f.cb[i] = c ? c[2] : 90;
        f.water[i] = W.isWater(b) ? 1 : 0;
        f.lava[i] = b === 13 ? 1 : 0;
        f.tree[i] = w.tree[i];
        const xr = x === W2 - 1 ? 0 : x + 1, xl = x === 0 ? W2 - 1 : x - 1;
        f.gx[i] = w.elev[row + xr] - w.elev[row + xl];
        f.gy[i] = w.elev[dn + x] - w.elev[up + x];
      }
    }
  }

  function bakeDirtyTiles(r) {
    const w = r.world, tiles = w.dirtyTiles;
    const Wp = w.W * HD, Hp = w.H * HD;
    if (!r.albedo || !r.f) { bakeTerrain(r); return; }
    r.subRects = r.subRects || [];
    for (let k = 0; k < tiles.length; k++) {
      const i = tiles[k];
      const tx = i % w.W, ty = (i / w.W) | 0;
      updateFieldsAt(r, tx, ty);
      // rebake with a one-tile margin so blends and normals stay continuous
      const x0 = (((tx - 1) * HD) % Wp + Wp) % Wp;
      const y0 = Math.max(0, (ty - 1) * HD);
      const wpx = 3 * HD, hpx = Math.min(Hp - y0, 3 * HD);
      bakeRect(r, x0, y0, wpx, hpx);
      r.subRects.push([x0, y0, wpx, hpx]);
      if (r.subRects.length > 40) { r.subRects = null; break; } // large edit: full upload
    }
    tiles.length = 0;
    r.texDirty = true;
    r.heightsDirty = true;
  }

  // ---------- GL init ----------
  const SEG_LON = 256, SEG_LAT = 170;
  function initGL(r) {
    const gl = r.gl;
    r.progPlanet = compile(gl, VS_PLANET, FS_PLANET);
    r.progCloud = compile(gl, VS_CLOUD, FS_CLOUD);
    r.progAtmo = compile(gl, VS_ATMO, FS_ATMO);
    r.progPts = compile(gl, VS_PTS, FS_PTS);
    r.progLine = compile(gl, VS_LINE, FS_LINE);

    // sphere geometry
    const nv = (SEG_LON + 1) * (SEG_LAT + 1);
    const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    r.heights = new Float32Array(nv);
    let vi = 0;
    for (let j = 0; j <= SEG_LAT; j++) {
      const lat = Math.PI / 2 - (j / SEG_LAT) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i <= SEG_LON; i++) {
        const lon = (i / SEG_LON) * Math.PI * 2;
        pos[vi * 3] = cl * Math.sin(lon); pos[vi * 3 + 1] = sl; pos[vi * 3 + 2] = cl * Math.cos(lon);
        uv[vi * 2] = i / SEG_LON; uv[vi * 2 + 1] = j / SEG_LAT;
        vi++;
      }
    }
    const idx = [];
    for (let j = 0; j < SEG_LAT; j++) for (let i = 0; i < SEG_LON; i++) {
      const a = j * (SEG_LON + 1) + i, b = a + SEG_LON + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    r.nIdx = idx.length;
    r.bufPos = glBuf(gl, pos); r.bufUV = glBuf(gl, uv);
    r.bufH = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, r.bufH);
    gl.bufferData(gl.ARRAY_BUFFER, r.heights, gl.DYNAMIC_DRAW);
    r.bufIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.bufIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    r.idxType = gl.UNSIGNED_INT;
    if (!(gl instanceof (global.WebGL2RenderingContext || function () {}))) {
      const ext = gl.getExtension('OES_element_index_uint');
      if (!ext) { // fall back to 16-bit (fits: nv < 65536? (193*129=24897) yes)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
        r.idxType = gl.UNSIGNED_SHORT;
      }
    }

    // textures (LINEAR: the smooth, cinematic look)
    r.texTerra = glTex(gl, true);
    r.texNorm = glTex(gl, true);
    r.texData = glTex(gl, true);
    r.dataBuf = new Uint8Array(r.world.W * r.world.H * 4);
    // clouds: bake once from fBm noise
    const cw = 1024, ch = 512, cnv = document.createElement('canvas');
    cnv.width = cw; cnv.height = ch;
    const cctx = cnv.getContext('2d');
    const img = cctx.createImageData(cw, ch);
    const noise = PD.makeNoise(1234567);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      // seamless in x by crossfading
      const t = x / cw;
      const n1 = noise.fbm(x * 0.012, y * 0.012, 6), n2 = noise.fbm((x - cw) * 0.012, y * 0.012, 6);
      const w1 = noise.fbm(x * 0.045 + 91, y * 0.045, 4), w2 = noise.fbm((x - cw) * 0.045 + 91, y * 0.045, 4);
      const v = (n1 * (1 - t) + n2 * t) * 0.7 + (w1 * (1 - t) + w2 * t) * 0.3;
      // trade-wind banding: dense at the equator and mid-latitudes, clear
      // over the horse latitudes — weather systems, not a blanket
      const lat = (y / ch) * Math.PI;
      const band = 0.42 + 0.58 * Math.pow(Math.abs(Math.sin(lat * 3.0)), 1.5);
      const a = Math.pow(PD.clamp((v - 0.60) * 5.0, 0, 1), 1.35) * band * 255;
      const o = (y * cw + x) * 4;
      img.data[o] = a; img.data[o + 1] = a; img.data[o + 2] = a; img.data[o + 3] = 255;
    }
    cctx.putImageData(img, 0, 0);
    r.texCloud = glTex(gl, true);
    gl.bindTexture(gl.TEXTURE_2D, r.texCloud);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cnv);

    // starfield points
    const stars = [];
    const srng = PD.makeRNG(42);
    for (let i = 0; i < 900; i++) {
      const a = srng() * 6.283, z = srng() * 2 - 1, rr = Math.sqrt(1 - z * z);
      stars.push(rr * Math.cos(a) * 40, z * 40, rr * Math.sin(a) * 40);
    }
    r.nStars = stars.length / 3;
    r.bufStars = glBuf(gl, new Float32Array(stars));
    const scol = new Float32Array(r.nStars * 4), ssize = new Float32Array(r.nStars);
    for (let i = 0; i < r.nStars; i++) {
      const b = 0.4 + srng() * 0.6;
      scol[i * 4] = b; scol[i * 4 + 1] = b; scol[i * 4 + 2] = b * (0.8 + srng() * 0.2); scol[i * 4 + 3] = 1;
      ssize[i] = (srng() < 0.1 ? 5 : 2.6) * 40;
    }
    r.bufStarCol = glBuf(gl, scol); r.bufStarSize = glBuf(gl, ssize);

    // dynamic buffers
    r.bufPts = gl.createBuffer(); r.bufPtsCol = gl.createBuffer(); r.bufPtsSize = gl.createBuffer();
    r.bufLine = gl.createBuffer(); r.bufLineCol = gl.createBuffer();

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.012, 0.02, 0.05, 1);
    // crack mask (for doomed planets) baked into data texture alpha
    r.crackNoise = PD.makeNoise(r.world.seed ^ 0xC0FFEE);
  }
  function glBuf(gl, arr) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    return b;
  }
  function glTex(gl, linear) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    return t;
  }

  // sample tile elevation into the sphere's per-vertex height attribute
  function updateHeights(r) {
    const w = r.world, gl = r.gl;
    let vi = 0;
    for (let j = 0; j <= SEG_LAT; j++) {
      const ty = PD.clamp((j / SEG_LAT) * w.H, 0, w.H - 1);
      for (let i = 0; i <= SEG_LON; i++) {
        const tx = ((i / SEG_LON) * w.W) % w.W;
        r.heights[vi++] = w.elev[W.idx(w, tx | 0, ty | 0)];
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, r.bufH);
    gl.bufferData(gl.ARRAY_BUFFER, r.heights, gl.DYNAMIC_DRAW);
    r.heightsDirty = false;
  }

  // city lights / water mask / fire / crack mask, rebuilt cheaply per frame
  function updateDataTex(r, sim) {
    const w = r.world, gl = r.gl, d = r.dataBuf;
    const S = W.S;
    for (let i = 0; i < w.n; i++) {
      const o = i * 4;
      const st = w.struct[i];
      d[o] = st === S.TOWN ? 235 : st === S.HOUSE ? 140 : st === S.TEMPLE || st === S.WONDER ? 255 : st === S.TOWER ? 90 : 0;
      d[o + 1] = W.isWater(w.biome[i]) ? 255 : 0;
      d[o + 2] = w.fire[i];
      if (r.crackDirty !== false) {
        d[o + 3] = PD.clamp((r.crackNoise.fbm((i % w.W) * 0.15, ((i / w.W) | 0) * 0.15, 3) - 0.55) * 6, 0, 1) * 255;
      }
    }
    r.crackDirty = false;
    gl.bindTexture(gl.TEXTURE_2D, r.texData);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w.W, w.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  }

  function camEye(cam) {
    const cl = Math.cos(cam.lat);
    return [cam.dist * cl * Math.sin(cam.lon), cam.dist * Math.sin(cam.lat), cam.dist * cl * Math.cos(cam.lon)];
  }

  // ---------- picking ----------
  function screenToWorld(r, sx, sy) {
    if (r.headless) return { x: r.world.W / 2, y: r.world.H / 2 };
    const cam = r.cam;
    const eye = camEye(cam);
    // build ray in world space from screen point
    const aspect = r.w / r.h, fov = 0.9;
    const ndcX = (sx / r.w) * 2 - 1, ndcY = 1 - (sy / r.h) * 2;
    const tanF = Math.tan(fov / 2);
    // camera basis
    const f = [-eye[0], -eye[1], -eye[2]];
    const fl = Math.hypot(f[0], f[1], f[2]); f[0] /= fl; f[1] /= fl; f[2] /= fl;
    const up = [0, 1, 0];
    let rt = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
    const rl = Math.hypot(rt[0], rt[1], rt[2]) || 1; rt = [rt[0] / rl, rt[1] / rl, rt[2] / rl];
    const uv2 = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
    const dir = [
      f[0] + rt[0] * ndcX * tanF * aspect + uv2[0] * ndcY * tanF,
      f[1] + rt[1] * ndcX * tanF * aspect + uv2[1] * ndcY * tanF,
      f[2] + rt[2] * ndcX * tanF * aspect + uv2[2] * ndcY * tanF
    ];
    // ray-sphere (unit radius)
    const b = 2 * (eye[0] * dir[0] + eye[1] * dir[1] + eye[2] * dir[2]);
    const a = dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2];
    const c = eye[0] * eye[0] + eye[1] * eye[1] + eye[2] * eye[2] - 1.045; // slight fudge for mountains
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null; // clicked space
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) return null;
    const hit = [eye[0] + dir[0] * t, eye[1] + dir[1] * t, eye[2] + dir[2] * t];
    return sphereToTile(r.world, hit);
  }
  const screenToWorldRaw = screenToWorld;

  function worldToScreen(r, wx, wy) {
    if (r.headless || !r._vp) return null;
    const p = tileToSphere(r.world, wx, wy, [0, 0, 0], 0.02);
    // cull back hemisphere
    const eye = camEye(r.cam);
    if (p[0] * eye[0] + p[1] * eye[1] + p[2] * eye[2] < 1.0) return null;
    const m = r._vp;
    const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (cw <= 0) return null;
    return { x: (cx / cw * 0.5 + 0.5) * r.w, y: (0.5 - cy / cw * 0.5) * r.h };
  }

  function centerTile(r) {
    const w = r.world, cam = r.cam;
    return {
      x: W.wrapX(w, (cam.lon / (Math.PI * 2)) * w.W),
      y: PD.clamp((Math.PI / 2 - cam.lat) / Math.PI * w.H, 0, w.H - 1)
    };
  }

  // ---------- draw ----------
  function draw(r, sim, ui) {
    if (r.world.dirty) bakeTerrain(r);
    else if (r.world.dirtyTiles.length) bakeDirtyTiles(r);
    if (r.headless) return;

    const gl = r.gl, cam = r.cam, world = r.world;
    // idle auto-spin: the world turns beneath the god's gaze
    cam.idle++;
    if (cam.idle > 300) cam.lon += 0.0006;

    if (r.texDirty) {
      const Wp = world.W * HD, Hp = world.H * HD;
      const isGL2 = !!gl.texStorage2D;
      if (r.subRects && isGL2 && r._texInit === world) {
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, Wp);
        for (const [x0, y0, wpx, hpx] of r.subRects) {
          if (x0 + wpx <= Wp) {
            gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
            gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
            gl.bindTexture(gl.TEXTURE_2D, r.texTerra);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, wpx, hpx, gl.RGBA, gl.UNSIGNED_BYTE, r.albedo);
            gl.bindTexture(gl.TEXTURE_2D, r.texNorm);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, wpx, hpx, gl.RGBA, gl.UNSIGNED_BYTE, r.normal);
          } else {
            // wrapped rect: fall back to full upload this frame
            r.subRects = null; break;
          }
        }
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      }
      if (!r.subRects || r._texInit !== world) {
        gl.bindTexture(gl.TEXTURE_2D, r.texTerra);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, Wp, Hp, 0, gl.RGBA, gl.UNSIGNED_BYTE, r.albedo);
        gl.bindTexture(gl.TEXTURE_2D, r.texNorm);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, Wp, Hp, 0, gl.RGBA, gl.UNSIGNED_BYTE, r.normal);
        r._texInit = world;
      }
      r.subRects = null;
      r.texDirty = false;
    }
    if (r.heightsDirty) updateHeights(r);
    updateDataTex(r, sim);

    const eye = camEye(cam);
    const proj = mat4Persp(0.9, r.w / r.h, 0.05, 100);
    const view = mat4LookAt(eye, [0, 0, 0], [0, 1, 0]);
    const vp = mat4Mul(proj, view);
    r._vp = vp;

    // sun sweeps with the day cycle; planes get fixed dramatic light
    const cyc = (sim.tick % 480) / 480 * Math.PI * 2;
    let sun = [Math.sin(cyc), 0.25, Math.cos(cyc)];
    if (world.mode === 'hell') sun = [0.2, -0.6, 0.5];
    if (world.mode === 'heaven') sun = [0.3, 0.9, 0.3];
    // before the first word there is no sun at all
    const unlit = world.mode === 'deep' || world.mode === 'nothing';
    if (unlit) sun = [0, 0, 0];
    if (world.mode === 'firmament') sun = [0.4, 0.55, 0.4];
    const sl = Math.hypot(sun[0], sun[1], sun[2]); sun = [sun[0] / sl, sun[1] / sl, sun[2] / sl];

    const atmo = world.mode === 'hell' ? [0.9, 0.25, 0.1]
      : world.mode === 'heaven' ? [1.0, 0.85, 0.4]
      : world.mode === 'void' ? [0.45, 0.3, 0.8]
      : world.mode === 'deep' ? [0.05, 0.06, 0.12]
      : world.mode === 'nothing' ? [0.02, 0.02, 0.04]
      : world.mode === 'firmament' ? [0.30, 0.45, 0.85]
      : [0.35, 0.55, 1.0];

    const p = PD.Cosmos && PD.Cosmos.active ? PD.Cosmos.active() : null;
    const doom = (p && p.meta && p.meta.doom != null && r.world === p.world)
      ? PD.clamp(1 - p.meta.doom / 4800, 0.15, 1) : 0;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // stars — they go out as the last of creation is unmade
    const dissolve = (global.G && global.G.dissolve) || 0;
    gl.disable(gl.DEPTH_TEST);
    if (dissolve < 0.98) drawPoints(r, vp, r.bufStars, r.bufStarCol, r.bufStarSize, r.nStars);
    gl.enable(gl.DEPTH_TEST);
    if (dissolve >= 1) { drawOverlay2D(r, sim, ui); return; }  // nothing left to draw

    // planet
    const pp = r.progPlanet;
    gl.useProgram(pp.p);
    bindAttr(gl, pp.a.aPos, r.bufPos, 3);
    bindAttr(gl, pp.a.aUV, r.bufUV, 2);
    bindAttr(gl, pp.a.aH, r.bufH, 1);
    gl.uniformMatrix4fv(pp.u.uMVP, false, vp);
    gl.uniform1f(pp.u.uDisp, 0.13 * (1 - dissolve));
    gl.uniform1f(pp.u.uSea, 0.38);
    gl.uniform3fv(pp.u.uSun, sun);
    gl.uniform3fv(pp.u.uEye, eye);
    gl.uniform3fv(pp.u.uAtmo, atmo);
    gl.uniform1f(pp.u.uBlood, sim.bloodMoonT > 0 ? 1 : 0);
    gl.uniform1f(pp.u.uDoom, doom);
    gl.uniform1f(pp.u.uTime, performance.now() * 0.001);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.texTerra); gl.uniform1i(pp.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, r.texData); gl.uniform1i(pp.u.uData, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, r.texNorm); gl.uniform1i(pp.u.uNorm, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.bufIdx);
    gl.drawElements(gl.TRIANGLES, r.nIdx, r.idxType, 0);

    // units as living embers on the surface
    drawUnits(r, sim, vp);

    // particles / rings / bolts
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    drawFXPoints(r, vp);
    drawFXLines(r, vp);

    // clouds (normal blending)
    if (world.mode !== 'hell' && world.mode !== 'void') {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const pc = r.progCloud;
      gl.useProgram(pc.p);
      bindAttr(gl, pc.a.aPos, r.bufPos, 3);
      bindAttr(gl, pc.a.aUV, r.bufUV, 2);
      gl.uniformMatrix4fv(pc.u.uMVP, false, vp);
      gl.uniform1f(pc.u.uScroll, performance.now() * 0.0000045);
      gl.uniform3fv(pc.u.uSun, sun);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.texCloud); gl.uniform1i(pc.u.uTex, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.bufIdx);
      gl.drawElements(gl.TRIANGLES, r.nIdx, r.idxType, 0);
    }

    // atmosphere halo
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.cullFace && gl.disable(gl.CULL_FACE);
    const pa = r.progAtmo;
    gl.useProgram(pa.p);
    bindAttr(gl, pa.a.aPos, r.bufPos, 3);
    gl.uniformMatrix4fv(pa.u.uMVP, false, vp);
    gl.uniform3fv(pa.u.uEye, eye);
    gl.uniform3fv(pa.u.uAtmo, atmo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.bufIdx);
    gl.drawElements(gl.TRIANGLES, r.nIdx, r.idxType, 0);

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // ---- 2D overlay: labels, cursor, weather, minimap ----
    drawOverlay2D(r, sim, ui);
  }

  function bindAttr(gl, loc, buf, size) {
    if (loc == null || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }
  function drawPoints(r, vp, bufP, bufC, bufS, n) {
    const gl = r.gl, pr = r.progPts;
    gl.useProgram(pr.p);
    bindAttr(gl, pr.a.aPos, bufP, 3);
    bindAttr(gl, pr.a.aCol, bufC, 4);
    bindAttr(gl, pr.a.aSize, bufS, 1);
    gl.uniformMatrix4fv(pr.u.uMVP, false, vp);
    gl.drawArrays(gl.POINTS, 0, n);
  }

  const _upos = [0, 0, 0];
  function drawUnits(r, sim, vp) {
    const gl = r.gl;
    const units = sim.units;
    let n = 0;
    const cap = Math.min(units.length, 1400);
    if (!r._uP || r._uP.length < cap * 3) {
      r._uP = new Float32Array(cap * 3); r._uC = new Float32Array(cap * 4); r._uS = new Float32Array(cap);
    }
    const zoomSize = 260 / r.cam.dist;
    for (let i = 0; i < units.length && n < cap; i++) {
      const u = units[i];
      if (u.dead) continue;
      const R = PD.Sim.RACES[u.race];
      if (!R) continue;
      tileToSphere(r.world, u.x, u.y, _upos, 0.014 + (R.flies ? 0.015 : 0));
      r._uP[n * 3] = _upos[0]; r._uP[n * 3 + 1] = _upos[1]; r._uP[n * 3 + 2] = _upos[2];
      const c = R2.hexToRgb(u.paragon ? '#ffd700' : R.col);
      r._uC[n * 4] = c[0] / 255; r._uC[n * 4 + 1] = c[1] / 255; r._uC[n * 4 + 2] = c[2] / 255;
      r._uC[n * 4 + 3] = R.ghost ? 0.5 : 1;
      let sz = 0.09 * zoomSize;
      if (R.big) sz *= R.big; if (u.big) sz *= u.big; if (u.paragon) sz *= 1.5;
      r._uS[n] = Math.max(2.2, sz);
      n++;
    }
    if (!n) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, r.bufPts); gl.bufferData(gl.ARRAY_BUFFER, r._uP.subarray(0, n * 3), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.bufPtsCol); gl.bufferData(gl.ARRAY_BUFFER, r._uC.subarray(0, n * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.bufPtsSize); gl.bufferData(gl.ARRAY_BUFFER, r._uS.subarray(0, n), gl.DYNAMIC_DRAW);
    drawPoints(r, vp, r.bufPts, r.bufPtsCol, r.bufPtsSize, n);
  }

  function drawFXPoints(r, vp) {
    const gl = r.gl, parts = FX.parts;
    const n = parts.length;
    if (!n) return;
    if (!r._fP || r._fP.length < n * 3) {
      r._fP = new Float32Array(Math.max(1024, n) * 3);
      r._fC = new Float32Array(Math.max(1024, n) * 4);
      r._fS = new Float32Array(Math.max(1024, n));
    }
    for (let i = 0; i < n; i++) {
      const q = parts[i];
      r._fP[i * 3] = q.p[0]; r._fP[i * 3 + 1] = q.p[1]; r._fP[i * 3 + 2] = q.p[2];
      const a = Math.min(1, q.life / q.max * 1.6);
      r._fC[i * 4] = q.col[0]; r._fC[i * 4 + 1] = q.col[1]; r._fC[i * 4 + 2] = q.col[2]; r._fC[i * 4 + 3] = a * q.col[3];
      r._fS[i] = q.size / r.cam.dist;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, r.bufPts); gl.bufferData(gl.ARRAY_BUFFER, r._fP.subarray(0, n * 3), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.bufPtsCol); gl.bufferData(gl.ARRAY_BUFFER, r._fC.subarray(0, n * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.bufPtsSize); gl.bufferData(gl.ARRAY_BUFFER, r._fS.subarray(0, n), gl.DYNAMIC_DRAW);
    drawPoints(r, vp, r.bufPts, r.bufPtsCol, r.bufPtsSize, n);
  }

  const _rtmp = [0, 0, 0];
  function drawFXLines(r, vp) {
    const gl = r.gl;
    const verts = [], cols = [];
    // shock rings: circles traced on the sphere surface
    for (const ring of FX.rings) {
      const alpha = ring.life / ring.max2;
      const segs = 40;
      const c = tileToSphere(r.world, ring.x, ring.y, _rtmp, 0.015);
      const cl = Math.hypot(c[0], c[1], c[2]);
      const nx = c[0] / cl, ny = c[1] / cl, nz = c[2] / cl;
      // tangent basis
      let tx = -nz, ty2 = 0, tz = nx;
      const tl = Math.hypot(tx, ty2, tz) || 1; tx /= tl; tz /= tl;
      const bx = ny * tz - nz * ty2, by = nz * tx - nx * tz, bz = nx * ty2 - ny * tx;
      const rad = ring.r * (Math.PI * 2 / r.world.W); // tile radius -> radians-ish
      let prev = null;
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const ox = (tx * Math.cos(a) + bx * Math.sin(a)) * Math.sin(rad);
        const oy = (ty2 * Math.cos(a) + by * Math.sin(a)) * Math.sin(rad);
        const oz = (tz * Math.cos(a) + bz * Math.sin(a)) * Math.sin(rad);
        const px = (nx * Math.cos(rad) + ox) * 1.015, py = (ny * Math.cos(rad) + oy) * 1.015, pz = (nz * Math.cos(rad) + oz) * 1.015;
        if (prev) {
          verts.push(prev[0], prev[1], prev[2], px, py, pz);
          for (let k = 0; k < 2; k++) cols.push(ring.col[0], ring.col[1], ring.col[2], alpha * ring.col[3]);
        }
        prev = [px, py, pz];
      }
    }
    // lightning bolts: jagged strike from the sky
    for (const b of FX.bolts) {
      const alpha = b.life / b.max;
      const t = b.pts[0];
      const surf = tileToSphere(r.world, t[0], t[1], [0, 0, 0], 0.01);
      const top = [surf[0] * 1.8, surf[1] * 1.8, surf[2] * 1.8];
      let prev = top;
      const segs = 7;
      for (let s = 1; s <= segs; s++) {
        const tt = s / segs;
        const px = top[0] + (surf[0] - top[0]) * tt + (Math.random() - 0.5) * 0.05 * (1 - tt);
        const py = top[1] + (surf[1] - top[1]) * tt + (Math.random() - 0.5) * 0.05 * (1 - tt);
        const pz = top[2] + (surf[2] - top[2]) * tt + (Math.random() - 0.5) * 0.05 * (1 - tt);
        verts.push(prev[0], prev[1], prev[2], px, py, pz);
        for (let k = 0; k < 2; k++) cols.push(0.85, 0.93, 1, alpha);
        prev = [px, py, pz];
      }
    }
    if (!verts.length) return;
    const pr = r.progLine;
    gl.useProgram(pr.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.bufLine); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(pr.a.aPos); gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.bufLineCol); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cols), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(pr.a.aCol); gl.vertexAttribPointer(pr.a.aCol, 4, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(pr.u.uMVP, false, vp);
    gl.lineWidth && gl.lineWidth(2);
    gl.drawArrays(gl.LINES, 0, verts.length / 3);
  }

  // ---------- overlay (labels / cursor / weather / minimap) ----------
  let miniCanvas = null, miniCtx = null, miniTick = -1, miniImg = null, biomeLUT = null;
  function drawOverlay2D(r, sim, ui) {
    const ctx = r.octx;
    if (!ctx) return;
    ctx.clearRect(0, 0, r.w, r.h);

    // omniscience: every soul named and weighed
    if (global.G && global.G.omniscient && r.cam.dist < 4.2) {
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      let shown = 0;
      for (const u of sim.units) {
        if (u.dead || shown > 90) continue;
        const s2 = worldToScreen(r, u.x, u.y);
        if (!s2) continue;
        shown++;
        ctx.fillStyle = u.karma >= 0 ? 'rgba(150,255,190,0.92)' : 'rgba(255,150,130,0.92)';
        ctx.fillText(`${u.name} ${u.karma >= 0 ? '+' : ''}${Math.round(u.karma)}`, s2.x, s2.y - 10);
      }
      ctx.textAlign = 'left';
    }

    // village labels (front hemisphere, close zoom)
    if (ui.showLabels && r.cam.dist < 3.4) {
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      for (const v of sim.villages) {
        const s = worldToScreen(r, v.x + 0.5, v.y);
        if (!s) continue;
        const label = v.name + ' ' + v.pop;
        const wpx = label.length * 5 + 6;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(s.x - wpx / 2, s.y - 14, wpx, 11);
        ctx.fillStyle = v.col;
        ctx.fillRect(s.x - wpx / 2, s.y - 14, 3, 11);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, s.x, s.y - 5);
      }
      ctx.textAlign = 'left';
    }

    // brush cursor at the picked tile
    if (ui.mouseW && !ui.overUI) {
      const s = worldToScreen(r, ui.mouseW.x, ui.mouseW.y);
      if (s) {
        const rad = (ui.brushRadius || 1) * (46 / r.cam.dist);
        ctx.strokeStyle = ui.brushColor || 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(6, rad), 0, 6.283); ctx.stroke();
        ctx.fillStyle = ui.brushColor || 'rgba(255,255,255,0.7)';
        ctx.fillRect(s.x - 1, s.y - 6, 2, 12); ctx.fillRect(s.x - 6, s.y - 1, 12, 2);
      }
    }

    // weather (screen-space over the globe)
    if (r.weather === 'rain') {
      ctx.strokeStyle = 'rgba(150,180,220,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of r.rainDrops) {
        d.y += d.s * 4; d.x += 1.2;
        if (d.y > r.h) { d.y = -5; d.x = Math.random() * r.w; }
        if (d.x > r.w) d.x = 0;
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y - 6);
      }
      ctx.stroke();
    } else if (r.weather === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (const f of r.snowFlakes) {
        f.d += 0.03; f.y += f.s * 1.2; f.x += Math.sin(f.d) * 0.6;
        if (f.y > r.h) { f.y = -5; f.x = Math.random() * r.w; }
        ctx.fillRect(f.x, f.y, 2, 2);
      }
    }

    // the sun itself, with a soft flare when it swings into view
    const noSun = r.world.mode === 'deep' || r.world.mode === 'nothing';
    if (r._vp && !noSun) {
      const cyc = (sim.tick % 480) / 480 * Math.PI * 2;
      const sp = [Math.sin(cyc) * 30, 7, Math.cos(cyc) * 30];
      const m = r._vp;
      const cw2 = m[3] * sp[0] + m[7] * sp[1] + m[11] * sp[2] + m[15];
      if (cw2 > 0) {
        const sx = ((m[0] * sp[0] + m[4] * sp[1] + m[8] * sp[2] + m[12]) / cw2 * 0.5 + 0.5) * r.w;
        const sy = (0.5 - (m[1] * sp[0] + m[5] * sp[1] + m[9] * sp[2] + m[13]) / cw2 * 0.5) * r.h;
        if (sx > -200 && sx < r.w + 200 && sy > -200 && sy < r.h + 200) {
          const g2 = ctx.createRadialGradient(sx, sy, 0, sx, sy, 130);
          g2.addColorStop(0, 'rgba(255,250,230,0.9)');
          g2.addColorStop(0.15, 'rgba(255,235,180,0.45)');
          g2.addColorStop(0.5, 'rgba(255,210,120,0.12)');
          g2.addColorStop(1, 'rgba(255,200,100,0)');
          ctx.fillStyle = g2;
          ctx.fillRect(sx - 130, sy - 130, 260, 260);
        }
      }
    }

    drawMinimap(r, sim, ctx);

    // vignette
    const g = ctx.createRadialGradient(r.w / 2, r.h / 2, Math.min(r.w, r.h) * 0.4, r.w / 2, r.h / 2, Math.max(r.w, r.h) * 0.8);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, r.w, r.h);
  }

  function drawMinimap(r, sim, ctx) {
    const world = r.world;
    const MW = 120, scale = MW / world.W, MH = Math.round(world.H * scale);
    if (!miniCanvas || miniCanvas.width !== world.W || miniCanvas.height !== world.H) {
      miniCanvas = document.createElement('canvas');
      miniCanvas.width = world.W; miniCanvas.height = world.H;
      miniCtx = miniCanvas.getContext('2d');
      miniTick = -1;
    }
    if (!biomeLUT) {
      biomeLUT = [];
      for (const k in W.BIOME_COLORS) biomeLUT[+k] = R2.hexToRgb(W.BIOME_COLORS[k]);
    }
    if (world.dirtyMini || miniTick < 0 || Math.abs(sim.tick - miniTick) > 30) {
      if (!miniImg || miniImg.width !== world.W) miniImg = miniCtx.createImageData(world.W, world.H);
      const ownerRGB = new Map();
      for (const v of sim.villages) ownerRGB.set(v.id, R2.hexToRgb(v.col));
      for (let i = 0; i < world.n; i++) {
        const c = biomeLUT[world.biome[i]] || [40, 40, 60];
        let rr = c[0], gg = c[1], bb = c[2];
        const o = world.owner[i];
        if (o >= 0) { const vc = ownerRGB.get(o); if (vc) { rr = (rr + vc[0] * 2) / 3; gg = (gg + vc[1] * 2) / 3; bb = (bb + vc[2] * 2) / 3; } }
        if (world.fire[i] > 0) { rr = 255; gg = 120; bb = 20; }
        const q = i * 4;
        miniImg.data[q] = rr; miniImg.data[q + 1] = gg; miniImg.data[q + 2] = bb; miniImg.data[q + 3] = 255;
      }
      miniCtx.putImageData(miniImg, 0, 0);
      miniTick = sim.tick; world.dirtyMini = false;
    }
    const mx = r.w - MW - 10, my = r.h - MH - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(mx - 3, my - 3, MW + 6, MH + 6);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(miniCanvas, mx, my, MW, MH);
    // camera center marker
    const ct = centerTile(r);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + ct.x * scale - 6, my + ct.y * scale - 4, 12, 8);
    ctx.strokeStyle = '#2a2f45'; ctx.strokeRect(mx - 3, my - 3, MW + 6, MH + 6);
    r._mini = { mx, my, MW, MH, scale };
  }

  function setWorld(r, world) {
    r.world = world;
    if (r.terra.width !== world.W * TILE || r.terra.height !== world.H * TILE) {
      r.terra.width = world.W * TILE; r.terra.height = world.H * TILE;
    }
    FX.bind(world);
    FX.clear();
    if (r.gl && !r.headless) {
      r.crackNoise = PD.makeNoise(world.seed ^ 0xC0FFEE);
      r.crackDirty = true;
      if (!r.dataBuf || r.dataBuf.length !== world.n * 4) r.dataBuf = new Uint8Array(world.n * 4);
    }
    bakeTerrain(r);
    world.dirtyMini = true;
    r.cam.lon = 0.6; r.cam.lat = 0.45;
  }

  function renderTerrain(r) { bakeTerrain(r); }

  PD.FX = FX;
  PD.Render = {
    createRenderer, draw, renderTerrain, setWorld,
    worldToScreen, screenToWorld, screenToWorldRaw, centerTile,
    TILE, FX, hexToRgb: R2.hexToRgb
  };
})(window);
