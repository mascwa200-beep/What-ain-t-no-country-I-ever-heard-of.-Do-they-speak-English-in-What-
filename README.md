# ✦ PIXEL DEITY — an 8-bit god simulator

A complete, offline-first idle god game in the spirit of *WorldBox*, rendered in
chunky 2D pixel art and playable forever. No build step, no server, no
dependencies — open `index.html` and you are a god.

## ▶ Play

**Just open `index.html` in any modern browser.** Everything — world
generation, simulation, pixel art, chiptune audio — is generated procedurally
at runtime. It works from a plain `file://` double-click, fully offline.

*(Optional)* serve it if you prefer: `python3 -m http.server` → `http://localhost:8000`.

## 🌍 What it is

You hover over a procedurally generated pixel world — continents, oceans,
mountains, deserts, jungles, tundra — and shape it with divine powers while
civilizations live their own lives underneath you:

- **Four sentient peoples** — Humans, Elves, Orcs, Dwarves — spawn, found
  villages, farm, build houses, temples and towers, level hamlets into
  metropolises, colonize new lands, wage war, and fall to ruin. All emergent.
- **A living ecology** — critters breed, wolves hunt, forests burn, fire
  spreads, rain douses, seasons turn (winter is lean), day fades to night.
- **The Undead** — raise them yourself or watch plague victims claw back out
  of the ground and snowball into an apocalypse.
- **Faith economy** — worshippers and temples generate ✦ Faith, the currency
  of every divine act. More believers → more power. Classic idle loop.
- **True offline progression** — the world is autosaved every 20 seconds and
  keeps turning while you're gone. Come back to a "While you were away…"
  report: faith gathered, populations shifted, settlements risen or fallen.
- **Infinite playtime** — nothing ends. Civilizations rise and fall in
  equilibrium, worlds are seedable and endless, and you can always burn it
  all down and start again.

## ⚡ Divine powers

| Category | Powers |
|---|---|
| **Divine** | Inspect creatures/towns/tiles · Move map |
| **Life** | Spawn Humans / Elves / Orcs / Dwarves / Critters / Wolves · Found instant Settlement |
| **Terraform** | Raise Land · Lower Land · Grow Forest · Grow Grass · Desertify · Raise Peaks |
| **Blessings** | Bless (heal + feed) · Rain |
| **Wrath** | Lightning · Ignite · Meteor · Plague · Earthquake · Freeze · Raise Dead |

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
| `Esc` | Deselect / back to Move tool |
| `M` | Menu (save, new world, custom seed) |
| Minimap click | Jump camera |

## 🏗 Architecture

Plain ES5-compatible scripts sharing a `window.PD` namespace — deliberately
buildless so the "built version" *is* the source:

```
index.html      shell + HUD/toolbar/modals
styles.css      retro UI theme
js/util.js      seeded RNG, fractal value noise, 8-bit WebAudio synth (SFX + generative chiptune)
js/world.js     procgen (elevation/moisture/temperature → 12 biomes), terraforming, fire sim
js/sim.js       units, villages, economy, war, plague, ecology — the living world
js/render.js    cached terrain layer, pixel sprites, particles, weather, day/night, minimap
js/powers.js    the god's toolbox (24 powers)
js/game.js      loop, faith economy, input, camera, save/load + offline progress
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
