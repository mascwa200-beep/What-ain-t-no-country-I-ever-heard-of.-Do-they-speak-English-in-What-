/* =========================================================================
   PIXEL DEITY — society.js
   The civilizational layer above raw survival: nations & politics, religion
   & prayers, technology eras (up to the internet age & PixelNet social
   media), recorded history, souls, and paragons (empowered heroes).
   State lives on sim.soc so it serializes with each planet.
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;

  const ERAS = ['Stone Age', 'Bronze Age', 'Iron Age', 'Medieval', 'Renaissance', 'Industrial', 'Modern', 'Space Age'];
  const GOVERNMENTS = ['Tribal Council', 'Monarchy', 'Theocracy', 'Republic', 'Empire', 'Technocracy'];
  const FAITH_NAMES = ['Way of the Flame', 'Church of the Sky Father', 'The Green Communion', 'Cult of the Deep', 'Order of the Silver Moon', 'The Last Dawn', 'Choir of Stars', 'The Quiet Path'];

  function ensure(sim) {
    if (!sim.soc) {
      sim.soc = {
        nations: [],        // {id,name,race,gov,leaderName,leaderTrait,villages:[],era:0,science:0,relations:{},faithId:-1,warWith:[],revolCd:0}
        nextNationId: 1,
        faiths: [],         // {id,name,followers,fervor,prophetName,commandments:0,godly:true}
        prayers: [],        // {id,text,unitId,village,kind,t,answered}
        nextPrayerId: 1,
        feed: [],           // PixelNet posts {t,author,race,text,likes}
        history: [],        // {t,era,text,kind}
        heroes: [],         // ids of paragon units (living)
        legends: [],        // fallen heroes / slain dragons {name,deed,t}
        internetOn: false
      };
    }
    return sim.soc;
  }

  function hist(sim, text, kind) {
    const soc = ensure(sim);
    soc.history.unshift({ t: sim.tick, text, kind: kind || 'event' });
    if (soc.history.length > 200) soc.history.pop();
  }

  // ---- Unit hooks ------------------------------------------------------
  function initUnit(sim, u, opts) { /* identity set in spawnUnit */ }

  function onDeath(sim, u, byRace, killer) {
    const soc = ensure(sim);
    const R = PD.Sim.RACES[u.race];
    // heroes fall into legend
    if (u.paragon > 0) {
      soc.legends.unshift({ name: u.name, deed: `${u.name} the Paragon fell after a life of ${(u.age / 120).toFixed(0)} years.`, t: sim.tick });
      if (soc.legends.length > 40) soc.legends.pop();
      hist(sim, `The paragon ${u.name} has fallen.`, 'legend');
      const hi = soc.heroes.indexOf(u.id); if (hi >= 0) soc.heroes.splice(hi, 1);
    }
    // dragonslaying is legend too
    if (u.race === 'dragon' && killer && killer.name) {
      soc.legends.unshift({ name: killer.name, deed: `${killer.name} slew the dragon!`, t: sim.tick });
      hist(sim, `${killer.name} slew a DRAGON. Songs will be sung.`, 'legend');
      killer.karma += 20;
    }
    // the soul departs to the Beyond (routed by karma)
    if (PD.Afterlife && (R.sentient || u.paragon)) {
      PD.Afterlife.receiveSoul({
        name: u.name, race: u.race, karma: Math.round(u.karma),
        trait: u.trait, age: Math.round(u.age / 120),
        from: sim.planetName || 'the world', died: sim.tick
      });
    }
  }

  // ---- Nations ---------------------------------------------------------
  function nationOf(sim, villageId) {
    const soc = ensure(sim);
    for (const n of soc.nations) if (n.villages.indexOf(villageId) >= 0) return n;
    return null;
  }

  function nationName(race, rng) {
    const base = PD.Sim.villageName(race, rng);
    const forms = [`Kingdom of ${base}`, `${base} Dominion`, `Free ${base}`, `${base} Confederacy`, `Empire of ${base}`, `${base} Clans`];
    return forms[(rng() * forms.length) | 0];
  }

  function updateNations(sim) {
    const soc = ensure(sim);
    // adopt orphan villages into a nation of their race, or found new nations
    for (const v of sim.villages) {
      if (nationOf(sim, v.id)) continue;
      // join nearest same-race nation within reach
      let best = null, bd = 45;
      for (const n of soc.nations) {
        if (n.race !== v.race || !n.villages.length) continue;
        const cap = PD.Sim.villageById(sim, n.villages[0]);
        if (!cap) continue;
        const d = W.wdist(sim.world, v.x, v.y, cap.x, cap.y);
        if (d < bd) { bd = d; best = n; }
      }
      if (best) { best.villages.push(v.id); }
      else {
        const n = {
          id: soc.nextNationId++, name: nationName(v.race, sim.rng), race: v.race,
          gov: 0, leaderName: PD.Sim.personName(v.race, sim.rng),
          leaderTrait: PD.Sim.TRAITS[(sim.rng() * PD.Sim.TRAITS.length) | 0],
          villages: [v.id], era: 0, science: 0, relations: {}, warWith: [], revolCd: 0,
          faithId: -1
        };
        soc.nations.push(n);
        hist(sim, `${n.name} is born under ${n.leaderName} the ${n.leaderTrait}.`, 'nation');
      }
    }
    // prune dead villages & dead nations
    for (let i = soc.nations.length - 1; i >= 0; i--) {
      const n = soc.nations[i];
      n.villages = n.villages.filter(id => PD.Sim.villageById(sim, id));
      if (!n.villages.length) {
        hist(sim, `${n.name} has passed into history.`, 'fall');
        soc.nations.splice(i, 1);
      }
    }

    // politics per nation
    for (const n of soc.nations) {
      let pop = 0, prosperity = 0;
      for (const id of n.villages) { const v = PD.Sim.villageById(sim, id); if (v) { pop += v.pop; prosperity += v.prosperity; } }
      prosperity /= Math.max(1, n.villages.length);
      n.pop = pop;

      // ---- science & eras: bigger, more prosperous nations advance ----
      // paced so a healthy nation reaches the Modern era in about an hour
      // of watched time, not weeks
      const tinker = PD.Sim.RACES[n.race] && PD.Sim.RACES[n.race].tinker ? 1.6 : 1;
      n.science += (pop * 0.045 + prosperity * 0.8) * tinker;
      const need = 40 * Math.pow(1.9, n.era);
      if (n.science >= need && n.era < ERAS.length - 1) {
        n.era++; n.science = 0;
        hist(sim, `${n.name} enters the ${ERAS[n.era]}!`, 'era');
        PD.Sim.logEvent(sim, `${n.name} enters the ${ERAS[n.era]}!`, 'grow');
        if (n.era >= 6 && !soc.internetOn) {
          soc.internetOn = true;
          hist(sim, `The internet flickers on. PixelNet is live.`, 'era');
          post(sim, null, n.race, 'FIRST POST!!! hello world??? is this thing on');
        }
        // government evolves with era
        if (n.era === 3 && n.gov === 0) { n.gov = 1; hist(sim, `${n.name} crowns its first monarch: ${n.leaderName}.`, 'politics'); }
        if (n.era === 4 && sim.rng() < 0.5) { n.gov = 3; hist(sim, `${n.name} declares a republic!`, 'politics'); }
        if (n.era === 6 && sim.rng() < 0.3) { n.gov = 5; hist(sim, `${n.name} is now run by engineers.`, 'politics'); }
      }

      // ---- succession / revolution ----
      n.revolCd--;
      if (n.revolCd <= 0) {
        n.revolCd = 600 + (sim.rng() * 600 | 0);
        if (sim.rng() < 0.25) {
          const old = n.leaderName;
          n.leaderName = PD.Sim.personName(n.race, sim.rng);
          n.leaderTrait = PD.Sim.TRAITS[(sim.rng() * PD.Sim.TRAITS.length) | 0];
          const how = prosperity < 0.3 ? 'is overthrown by' : 'peacefully yields to';
          hist(sim, `${old} of ${n.name} ${how} ${n.leaderName} the ${n.leaderTrait}.`, 'politics');
          if (soc.internetOn && sim.rng() < 0.6) post(sim, null, n.race, `BREAKING: ${n.leaderName} now leads ${n.name}. thoughts??`);
        }
      }

      // ---- diplomacy: relations drift; cruel leaders start wars ----
      for (const m of soc.nations) {
        if (m.id === n.id) continue;
        const key = m.id;
        if (n.relations[key] == null) n.relations[key] = 0;
        n.relations[key] += (sim.rng() - 0.5) * 4;
        if (n.leaderTrait === 'cruel' || n.leaderTrait === 'greedy') n.relations[key] -= 0.5;
        if (n.leaderTrait === 'kind' || n.leaderTrait === 'wise') n.relations[key] += 0.4;
        n.relations[key] = PD.clamp(n.relations[key], -100, 100);
        const atWar = n.warWith.indexOf(m.id) >= 0;
        if (!atWar && n.relations[key] < -70 && sim.rng() < 0.1) {
          n.warWith.push(m.id); m.warWith.push(n.id);
          hist(sim, `WAR! ${n.name} declares war on ${m.name}.`, 'war');
          PD.Sim.logEvent(sim, `${n.name} declares war on ${m.name}!`, 'war');
          if (soc.internetOn) post(sim, null, n.race, `we are SO at war with ${m.name} right now #pray`);
        } else if (atWar && n.relations[key] > -20 && sim.rng() < 0.15) {
          n.warWith = n.warWith.filter(id => id !== m.id);
          m.warWith = m.warWith.filter(id => id !== n.id);
          hist(sim, `Peace between ${n.name} and ${m.name}.`, 'politics');
        }
      }
      // national wars drive village rivalry (fuels the unit-level fighting)
      if (n.warWith.length) {
        const foe = soc.nations.find(x => x.id === n.warWith[0]);
        if (foe && foe.villages.length) {
          for (const vid of n.villages) {
            const v = PD.Sim.villageById(sim, vid);
            if (v && v.rival < 0) {
              // pick foe village nearest this one
              let bf = null, bfd = 1e9;
              for (const fid of foe.villages) {
                const fv = PD.Sim.villageById(sim, fid);
                if (fv) { const d = W.wdist(sim.world, v.x, v.y, fv.x, fv.y); if (d < bfd) { bfd = d; bf = fv; } }
              }
              if (bf && bfd < 50) v.rival = bf.id;
            }
          }
        }
      }
    }
  }

  // ---- Religion --------------------------------------------------------
  function updateFaiths(sim) {
    const soc = ensure(sim);
    // nations found faiths (theocratic urge grows with era & temples)
    for (const n of soc.nations) {
      if (n.faithId >= 0 || sim.rng() > 0.02) continue;
      let temples = 0;
      for (const id of n.villages) { const v = PD.Sim.villageById(sim, id); if (v) temples += v.temples; }
      if (temples >= 1) {
        // join an existing faith of the same race sometimes, else found one
        let f = soc.faiths.find(x => x.race === n.race && sim.rng() < 0.5);
        if (!f) {
          f = {
            id: soc.faiths.length + 1,
            name: FAITH_NAMES[(sim.rng() * FAITH_NAMES.length) | 0],
            race: n.race, followers: 0, fervor: 0.5,
            prophetName: PD.Sim.personName(n.race, sim.rng),
            commandments: 0
          };
          soc.faiths.push(f);
          hist(sim, `${f.prophetName} founds the ${f.name}. They preach of YOU.`, 'faith');
          PD.Sim.logEvent(sim, `A new faith arises: the ${f.name}.`, 'found');
        }
        n.faithId = f.id;
        if (n.gov !== 2 && sim.rng() < 0.3) { n.gov = 2; hist(sim, `${n.name} becomes a theocracy of the ${f.name}.`, 'politics'); }
      }
    }
    // follower counts & fervor
    for (const f of soc.faiths) {
      f.followers = 0;
      for (const n of soc.nations) if (n.faithId === f.id) f.followers += (n.pop || 0);
      f.fervor = PD.clamp(f.fervor + (sim.rng() - 0.5) * 0.02, 0.1, 1);
    }
  }

  // ---- Prayers ---------------------------------------------------------
  const PRAYER_KINDS = {
    sick:    { text: (u, v) => `${u.name} the ${PD.Sim.TRAITS[u.trait]} prays: "Lord, cure my sickness…"` },
    war:     { text: (u, v) => `${u.name} of ${v ? v.name : 'the wilds'} prays: "Deliver us from our enemies!"` },
    famine:  { text: (u, v) => `${u.name} prays: "Our stores are empty. Send us food, we beg you."` },
    child:   { text: (u, v) => `${u.name} prays: "Bless our village with a child."` },
    monster: { text: (u, v) => `${u.name} prays: "A beast stalks us! Send a hero!"` },
    thanks:  { text: (u, v) => `${u.name} simply prays their thanks. It warms you.` }
  };

  function makePrayer(sim, u, kind) {
    const soc = ensure(sim);
    if (soc.prayers.length >= 12) return; // don't flood the divine inbox
    if (soc.prayers.some(p => p.unitId === u.id)) return;
    const v = u.village >= 0 ? PD.Sim.villageById(sim, u.village) : null;
    soc.prayers.push({
      id: soc.nextPrayerId++, unitId: u.id, village: u.village,
      kind, text: PRAYER_KINDS[kind].text(u, v), t: sim.tick,
      x: u.x, y: u.y
    });
    if (PD.Game && PD.Game.onPrayer) PD.Game.onPrayer(sim);
  }

  function generatePrayers(sim) {
    const soc = ensure(sim);
    // scan a sample of units for prayer-worthy situations
    const units = sim.units;
    for (let k = 0; k < 12; k++) {
      const u = units[(sim.rng() * units.length) | 0];
      if (!u || u.dead) continue;
      const R = PD.Sim.RACES[u.race];
      if (!R.sentient || sim.rng() > 0.3) continue;
      if (u.sick > 0) { makePrayer(sim, u, 'sick'); continue; }
      if (u.food < 0.25) { makePrayer(sim, u, 'famine'); continue; }
      const v = u.village >= 0 ? PD.Sim.villageById(sim, u.village) : null;
      if (v && v.rival >= 0) { makePrayer(sim, u, 'war'); continue; }
      if ((sim.counts.dragon > 0 || sim.counts.troll > 0) && sim.rng() < 0.3) { makePrayer(sim, u, 'monster'); continue; }
      if (v && v.pop < 5 && sim.rng() < 0.4) { makePrayer(sim, u, 'child'); continue; }
      if (u.karma > 3 && sim.rng() < 0.1) makePrayer(sim, u, 'thanks');
    }
    // stale prayers fade (unanswered prayers cost a little faith income)
    // abs(): under reversed time sim.tick < p.t, which would make every
    // prayer immortal and the divine inbox grow without bound
    soc.prayers = soc.prayers.filter(p => Math.abs(sim.tick - p.t) < 1600);
  }

  // Answer a prayer (invoked from the UI). Returns faith delta (negative =
  // cost). Answering builds karma-credit with mortals: faith income rises.
  function answerPrayer(sim, prayerId, refuse) {
    const soc = ensure(sim);
    const pi = soc.prayers.findIndex(p => p.id === prayerId);
    if (pi < 0) return 0;
    const p = soc.prayers[pi];
    soc.prayers.splice(pi, 1);
    const u = sim.units.find(x => x.id === p.unitId && !x.dead);
    if (refuse) {
      if (u) { u.karma -= 1; }
      hist(sim, `You turned away a prayer. The silence was heard.`, 'faith');
      return 0;
    }
    if (!u) return 0;
    const v = u.village >= 0 ? PD.Sim.villageById(sim, u.village) : null;
    switch (p.kind) {
      case 'sick': u.sick = 0; u.hp = u.maxHp; break;
      case 'famine': if (v) v.food += 60; u.food = 1; break;
      case 'war': if (v) { v.rival = -1; PD.Sim.forNeighbors(sim, u.x, u.y, 8, (o) => { o.hp = o.maxHp; }); } break;
      case 'child': if (v) PD.Sim.spawnUnit(sim, u.race, u.x, u.y, { village: v.id }); break;
      case 'monster': empower(sim, u, 1); break;
      case 'thanks': break;
    }
    u.karma += 3;
    hist(sim, `You answered ${u.name}'s prayer (${p.kind}).`, 'faith');
    if (soc.internetOn && sim.rng() < 0.5) post(sim, u.name, u.race, `guys my prayer literally just got ANSWERED. faith restored fr #blessed`);
    if (PD.FX) { PD.FX.shock(u.x, u.y, 3, '#fff2a0'); PD.FX.spark(u.x, u.y, '#ffe680'); }
    return 8; // answered prayers refund faith through gratitude
  }

  // ---- Paragons (superheroes) -----------------------------------------
  function empower(sim, u, level) {
    const soc = ensure(sim);
    u.paragon = Math.min(3, (u.paragon || 0) + level);
    u.maxHp = PD.Sim.RACES[u.race].hp * (1 + u.paragon * 2);
    u.hp = u.maxHp;
    u.lifespan = Math.max(u.lifespan, u.age + 2400);
    if (soc.heroes.indexOf(u.id) < 0) soc.heroes.push(u.id);
    hist(sim, `${u.name} is EMPOWERED (paragon ${u.paragon}). A hero walks among mortals.`, 'legend');
    PD.Sim.logEvent(sim, `${u.name} rises as a paragon!`, 'grow');
    if (soc.internetOn) post(sim, null, u.race, `VIDEO: local ${PD.Sim.RACES[u.race].one.toLowerCase()} just deflected a boulder?? #paragon #notclickbait`);
    if (PD.FX) { PD.FX.shock(u.x, u.y, 5, '#ffe066'); PD.FX.lightning(u.x, u.y); }
  }

  // Paragon behavior boost: heroes seek monsters. Called from step.
  function updateHeroes(sim) {
    const soc = ensure(sim);
    for (let i = soc.heroes.length - 1; i >= 0; i--) {
      const u = sim.units.find(x => x.id === soc.heroes[i] && !x.dead);
      if (!u) { soc.heroes.splice(i, 1); continue; }
      // heroes hunt the biggest nearby threat
      if (sim.tick % 12 === 0 && u.raidT <= 0) {
        let target = null, td = 60;
        for (const o of sim.units) {
          if (o.dead) continue;
          const RO = PD.Sim.RACES[o.race];
          if (!RO.monster && !RO.predator) continue;
          const d = W.wdist(sim.world, u.x, u.y, o.x, o.y);
          if (d < td) { td = d; target = o; }
        }
        if (target) { u.raidT = 90; u.raidX = target.x; u.raidY = target.y; }
      }
    }
  }

  // ---- PixelNet (social media) ----------------------------------------
  const POST_FLAVOR = [
    (sim) => `weather today: ${sim.isNight ? 'dark. very dark' : ['sunny','rainy','apocalyptic','fine ig'][(sim.rng()*4)|0]}. rate my crops`,
    (sim) => `hot take: temples are just tall houses`,
    (sim) => `did the stars just MOVE? asking for a friend`,
    (sim) => `day ${((sim.tick/120)|0)}: still not smited. winning`,
    (sim) => `petition to rename winter to "the bad one"`,
    (sim) => `my ${['goat','turnip','sword','cart'][(sim.rng()*4)|0]} broke. thoughts and prayers pls`
  ];
  function post(sim, author, race, text) {
    const soc = ensure(sim);
    if (!soc.internetOn) return;
    const R = PD.Sim.RACES[race] || PD.Sim.RACES.human;
    soc.feed.unshift({
      t: sim.tick,
      author: (author || PD.Sim.personName(race, sim.rng)) + ' ' + R.emoji,
      text, likes: (sim.rng() * 400) | 0
    });
    if (soc.feed.length > 40) soc.feed.pop();
  }
  // gods trend hard: divine acts hit the feed
  function reactToMiracle(sim, kind) {
    const soc = ensure(sim);
    if (!soc.internetOn || sim.rng() > 0.7) return;
    const reactions = {
      meteor: ['THE SKY IS FALLING. THIS IS NOT A DRILL', 'meteor??? in THIS economy', 'who angered the Big One this time. own up'],
      lightning: ['anyone else see that bolt from literally nowhere', 'smite compilation video when'],
      bless: ['the light touched our village and grandma can WALK again #miracle', 'blessed fr fr'],
      plague: ['do NOT go outside. do not.', 'coughing tag urself'],
      quake: ['ground did a wiggle. house did a collapse', 'earthquake selfie #shaken'],
      flood: ['SO much water. arks are trending', 'should have listened to that guy with the boat']
    };
    const rs = reactions[kind];
    if (rs) post(sim, null, SENTIENT_RACE(sim), rs[(sim.rng() * rs.length) | 0]);
  }
  function SENTIENT_RACE(sim) {
    const alive = PD.Sim.SENTIENT.filter(r => (sim.counts[r] || 0) > 0);
    return alive.length ? alive[(sim.rng() * alive.length) | 0] : 'human';
  }

  // ---- Wonders: great works of golden stone ---------------------------
  const WONDER_NAMES = ['Great Pyramid', 'Colossus', 'Sky Spire', 'Hanging Gardens', 'Sun Gate', 'Eternal Flame', 'World Tree Shrine', 'Grand Lighthouse'];
  function buildWonders(sim) {
    const world = sim.world;
    for (const v of sim.villages) {
      if (v.level < 4 || v.wonders >= 2 || sim.rng() > 0.06) continue;
      const n = nationOf(sim, v.id);
      if (!n || n.era < 3 || v.food < 60) continue;
      // find an owned empty tile
      for (let tries = 0; tries < 12; tries++) {
        const ang = sim.rng() * 6.283, dr = 1 + sim.rng() * v.radius;
        const x = Math.round(v.x + Math.cos(ang) * dr), y = Math.round(v.y + Math.sin(ang) * dr);
        if (!W.inBounds(world, x, y)) continue;
        const i = W.idx(world, x, y);
        if (world.owner[i] === v.id && world.struct[i] === 0 && W.isLand(world.biome[i])) {
          world.struct[i] = W.S.WONDER; world.structHp[i] = 200;
          W.markTile(world, i);
          v.wonders = (v.wonders || 0) + 1;
          v.food -= 50;
          const wname = WONDER_NAMES[(sim.rng() * WONDER_NAMES.length) | 0] + ' of ' + v.name;
          hist(sim, `${v.name} completes the ${wname}! Faith pours from its gates.`, 'era');
          PD.Sim.logEvent(sim, `${v.name} raises a WONDER: the ${wname}.`, 'grow');
          if (sim.soc.internetOn) post(sim, null, v.race, `the new ${wname} is INSANE. tourism era begins now`);
          break;
        }
      }
    }
  }

  // ---- trade: nations share food among their villages ------------------
  function tradeStep(sim) {
    const soc = ensure(sim);
    for (const n of soc.nations) {
      if (n.villages.length < 2) continue;
      let total = 0, vs = [];
      for (const id of n.villages) { const v = PD.Sim.villageById(sim, id); if (v) { total += v.food; vs.push(v); } }
      if (vs.length < 2) continue;
      const mean = total / vs.length;
      for (const v of vs) v.food += (mean - v.food) * 0.1; // caravans move 10% toward the mean
    }
  }

  // ---- cosmic omens: rare events that keep eternity interesting --------
  function rollOmen(sim) {
    const soc = ensure(sim);
    const roll = sim.rng();
    const world = sim.world;
    if (roll < 0.14) {
      sim.bloodMoonT = 480;
      hist(sim, 'A BLOOD MOON rises. Monsters howl with borrowed strength.', 'war');
      PD.Sim.logEvent(sim, 'A blood moon rises…', 'war');
      if (soc.internetOn) post(sim, null, SENTIENT_RACE(sim), 'moon looking VERY red tonight. locking my door');
    } else if (roll < 0.28) {
      hist(sim, 'An aurora crowns the sky. The faithful weep; faith surges.', 'faith');
      if (PD.Game) PD.Game.faith = Math.min(9999999, PD.Game.faith + 60);
      PD.Sim.logEvent(sim, 'An aurora blesses the night. +60 ✦', 'found');
    } else if (roll < 0.4) {
      hist(sim, 'An eclipse swallows the sun. The world holds its breath.', 'event');
      for (const f of soc.faiths) f.fervor = PD.clamp(f.fervor + 0.1, 0, 1);
    } else if (roll < 0.52) {
      hist(sim, 'A GOLDEN AGE dawns — harvests overflow and songs are long.', 'era');
      for (const v of sim.villages) { v.food += 30; v.prosperity = PD.clamp(v.prosperity + 0.2, 0, 1); }
      PD.Sim.logEvent(sim, 'A golden age dawns!', 'grow');
    } else if (roll < 0.64) {
      // meteorite: a small strike somewhere no one asked for
      const x = (sim.rng() * world.W) | 0, y = (sim.rng() * world.H) | 0;
      W.ignite(world, x, y, 2);
      PD.Sim.damageArea(sim, x, y, 3, 60, null);
      if (PD.FX) PD.FX.explosion(x, y, false);
      hist(sim, 'A meteorite falls from the void, unbidden.', 'war');
    } else if (roll < 0.78) {
      // monster horde at a random shore
      const s = W.nearestLand(world, (sim.rng() * world.W) | 0, (sim.rng() * world.H) | 0, 12);
      if (s) {
        const kind = sim.rng() < 0.5 ? 'goblin' : 'troll';
        const nmax = kind === 'goblin' ? 8 : 3;
        for (let k = 0; k < nmax; k++) PD.Sim.spawnUnit(sim, kind, s.x + sim.rng() * 3, s.y + sim.rng() * 3);
        hist(sim, `A ${kind} horde pours out of the wilds!`, 'war');
        PD.Sim.logEvent(sim, `A ${kind} horde appears!`, 'war');
      }
    } else if (roll < 0.86 && sim.counts.merfolk > 0 && (sim.counts.kraken || 0) < 1) {
      const sx = (sim.rng() * world.W) | 0, sy = (sim.rng() * world.H) | 0;
      const u = PD.Sim.spawnUnit(sim, 'kraken', sx, sy);
      if (u) { hist(sim, 'Something vast stirs beneath the waves. THE KRAKEN WAKES.', 'war'); PD.Sim.logEvent(sim, 'The Kraken wakes!', 'war'); }
    } else {
      // a wandering prophet strengthens the largest faith
      if (soc.faiths.length) {
        const f = soc.faiths[0];
        f.fervor = PD.clamp(f.fervor + 0.2, 0, 1);
        hist(sim, `A wandering preacher revives the ${f.name}.`, 'faith');
      }
    }
  }

  // ---- main step -------------------------------------------------------
  function step(sim) {
    ensure(sim);
    if (sim.tick % 60 === 0) updateNations(sim);
    if (sim.tick % 90 === 0) updateFaiths(sim);
    if (sim.tick % 45 === 0) generatePrayers(sim);
    if (sim.tick % 80 === 0) tradeStep(sim);
    if (sim.tick % 150 === 0) buildWonders(sim);
    const lifeless = sim.world.mode === 'deep' || sim.world.mode === 'nothing';
    if (sim.tick % 400 === 0 && sim.tick > 400 && sim.rng() < 0.30 && !sim.isPlane && !lifeless) rollOmen(sim);
    updateHeroes(sim);
    if (sim.soc.internetOn && sim.tick % 240 === 0 && sim.rng() < 0.6) {
      post(sim, null, SENTIENT_RACE(sim), POST_FLAVOR[(sim.rng() * POST_FLAVOR.length) | 0](sim));
    }
  }

  // extra faith from organized religion (called by the game's economy)
  function faithBonus(sim) {
    const soc = ensure(sim);
    let b = 0;
    for (const f of soc.faiths) b += f.followers * f.fervor * 0.004 + f.commandments * 0.1;
    return b;
  }

  global.PD.Society = {
    ERAS, GOVERNMENTS, ensure, step, initUnit, onDeath,
    nationOf, updateNations, empower, answerPrayer, post, reactToMiracle,
    faithBonus, hist
  };
})(window);
