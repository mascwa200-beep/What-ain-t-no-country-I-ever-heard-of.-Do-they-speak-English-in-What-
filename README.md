# ✦ PIXEL DEITY — an 8-bit god simulator

A complete, offline-first idle god game in the spirit of *WorldBox*, rendered in
chunky 2D pixel art and playable forever. No build step, no server, no
dependencies — open `index.html` and you are a god.

## ▶ Play

**Just open `index.html` in any modern browser.** Everything — world
generation, simulation, pixel art, chiptune audio — is generated procedurally
at runtime. It works from a plain `file://` double-click, fully offline.

*(Optional)* serve it if you prefer: `python3 -m http.server` → `http://localhost:8000`.

### 📱 Play on your phone (Android / GrapheneOS / iOS)

Grab the **single-file build** — the entire game in one ~270 KB HTML file:

- **[Download PixelDeity.html](../../raw/main/dist/PixelDeity.html)** (right-click / long-press → save)
- **[Download PixelDeity.zip](../../raw/main/dist/PixelDeity.zip)** (~75 KB)

On a Pixel / GrapheneOS phone: download `PixelDeity.html`, open it from your
Files app (Vanadium or any browser handles it), rotate to landscape, play.
It saves locally and never needs a connection. If you serve the repo over
HTTPS instead, the included PWA manifest + service worker make it
installable from the browser menu ("Add to Home screen") as a fullscreen
offline app.

## 🌍 What it is — the GENESIS edition

You are the One True God of a **round pixel multiverse**:

- **Round worlds** — planets wrap east-west (walk far enough and come home);
  the Cosmos screen shows them as **spinning pixel globes** orbiting your sun.
- **16 peoples + your own** — Humans, Elves, Orcs, Dwarves, Gnomes, Halflings,
  Goblins, Tieflings, Dragonborn, Lizardfolk, Merfolk, Fairies, Giants… plus
  vampires, werewolves, trolls, dragons, angels, demons — or design a custom
  race in the **Genesis Lab** (body, temper, wings, gills, lifespan).
- **Named individuals** — every creature has a name, a personality, a
  profession, a family village, and **karma** that decides their afterlife.
  Inspect anyone; bless, speak to, empower, or smite them personally.
- **Nations & politics** — villages federate into nations with governments
  (tribal → monarchy → theocracy → republic → technocracy), leaders with
  traits, diplomacy, wars with actual raiding parties, revolutions — and
  Dominion powers to install leaders, force peace, incite wars, or Babel a
  proud empire into splinters.
- **Technology eras** — Stone Age to Space Age. When a nation hits the
  Modern era it invents the internet, and the **PixelNet tab** fills with
  citizens posting about your miracles ("meteor??? in THIS economy").
- **Religion & prayers** — faiths arise around temples with named prophets;
  the **Prayers tab** queues real pleas from the sick, starving, and
  besieged. Answer, ignore, or refuse. Hand down Commandments. Anoint
  prophets. Flood the world (the most righteous village is spared).
- **Heavens & hells** — souls route by karma to five planes: Elysium, the
  Meadows, the Grayfields, the Ashen Hell, the Frozen Deep. Visit them,
  meet the dead, promote souls to angels, condemn the wicked, or
  **resurrect** anyone back into the living world.
- **The multiverse** — create up to 8 planets (verdant, desert, frozen,
  oceanic, hellscape, primordial, **doomed**), rename them, or unmake them.
  Doomed worlds count down to core collapse — save them, or watch a family
  seal their child into an escape rocket bound for another of your planets,
  where the orphan grows into a superpowered **Paragon**.
- **Primordial evolution** — seed an ooze world and guide it from microbes
  to sapience. You created evolution, after all.
- **Time travel** — the chronicle snapshots your world; rewind it, or
  **branch a parallel universe** from any recorded moment.
- **A story, if you want it** — the **Testament tab** unfolds 12 chapters
  (Genesis → the Wired Age → Eternity) with hints hidden behind a button.
- **Idle to the bone** — faith from worshippers, temples, faiths, wonders,
  and answered prayers; autosave every 20s; true offline progression with an
  away report; nothing ever ends.
- **OVERPOWERED endgame** — an Omnipotence power tier (black holes, raptures,
  armageddons, titans, instant necropolises); golden **Wonders** that pour
  faith; cosmic **omens** (blood moons that empower every monster, auroras,
  eclipses, golden ages, krakens, monster hordes); 12 **achievements**; and
  **Transcendence** — a prestige reset that permanently multiplies all faith
  gain, forever, every time.

## ⚡ Divine powers

| Category | Powers |
|---|---|
| **Divine** | Inspect (deep dossier on any soul) · Move map |
| **Life** | Spawn any people or beast · Found instant Settlement · your custom races |
| **Terraform** | Raise/Lower Land · Grow Forest/Grass · Desertify · Raise Peaks |
| **Blessings** | Bless · Rain |
| **Wrath** | Lightning · Ignite · Meteor · Plague · Earthquake · Freeze · Raise Dead · Thunderstorm · Tornado · Volcano |
| **Godhead** | Divine Voice · Empower Hero (Paragons) · Miracle · Calm the Core · Guide Evolution |
| **Dominion** | Install Leader · Force Peace · Incite War · Revolution |
| **Testament** | Great Flood · Ten Plagues · Anoint Prophet · Commandments · Confusion of Tongues |
| **Omnipotence** | Midas Touch · Black Hole · Heaven's Host · Hell's Legion · Armageddon · Necropolis · Polymorph · Fountain of Youth · Fertility Rite · Rapture · Divine Aegis · Titanize |

Plus panel-driven powers: create/destroy/rename planets (Cosmos), answer or
refuse prayers, resurrect/ascend/condemn souls (the Beyond), rewind or branch
time, and the Genesis Lab race designer.

## 🎮 Controls

| Input | Action |
|---|---|
| Left-drag / tap | Use selected power |
| Right-drag / ✋ tool | Pan the map |
| Wheel / pinch | Zoom (to the cursor) |
| `WASD` / arrows | Pan |
| `Space`, `1` `2` `3`, `0` | Pause · speed ×1 ×2 ×4 · pause |
| `[` `]` | Brush size |
| `L` | Toggle town labels |
| `Esc` | Close panel / deselect |
| `C` `P` `H` | Cosmos · Prayers · History panels |
| `M` | Menu (save, new multiverse, custom seed) |
| Minimap click | Jump camera |

## 🏗 Architecture

Plain ES5-compatible scripts sharing a `window.PD` namespace — deliberately
buildless so the "built version" *is* the source:

```
index.html       shell + HUD/toolbar/tab-rail/panels
styles.css       retro UI theme
js/util.js       seeded RNG, fractal value noise, 8-bit WebAudio synth
js/codec.js      RLE + quantized typed-array save codec (a planet ≈ tens of KB)
js/world.js      procgen → 18 biomes, ROUND wrap worlds, terraforming, fire sim
js/sim.js        21 races, units w/ identity+karma, villages, ecology, combat
js/society.js    nations, politics, religion, prayers, tech eras, PixelNet, history
js/afterlife.js  souls, the five planes of the Beyond, angels/demons, resurrection
js/cosmos.js     the multiverse: planets, spinning globes, doomed cores, evolution, Genesis Lab
js/render.js     cached terrain, seam-wrapped camera, sprites, particles, minimap
js/powers.js     the god's toolbox (40 powers)
js/game.js       loop, faith economy, floods/storms/time travel, panels, save/load
```

Design notes:

- **Deterministic worlds** — any text seed reproduces the same map (mulberry32
  + domain-warped fBm value noise).
- **Logistic civilization model** — village capacity derives from worked land
  fertility + farms, so towns grow to a stable size, then colonize outward;
  collapse (fire, war, plague, famine) frees land for the next dynasty.
  That's what makes it infinite instead of convergent.
- **Performance** — terrain renders once into an offscreen buffer and only
  re-blits; units use a spatial hash for neighbor queries; population is
  capped at ~1100 with the excess pressure expressed through the economy.
- **Saves** — full typed-array world state is base64-packed into
  `localStorage`; elapsed real time is re-simulated on load (bounded by a
  wall-clock budget) with the remainder credited as idle faith, capped at 24h.

## 📜 License

MIT — do godlike things with it.
