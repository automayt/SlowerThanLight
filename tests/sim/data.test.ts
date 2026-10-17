import { describe, expect, it } from 'vitest';
import { ENEMIES, ENEMY_LIST } from '../../src/data/enemies';
import { FITTING_IDS, FITTINGS } from '../../src/data/fittings';
import { PLAYER_SHIPS, SHIP_UNLOCKS } from '../../src/data/ships';
import { PORT_NAMES, PORT_TAGLINES, RECRUIT_NAMES, SEA_EVENTS, SECTORS } from '../../src/data/voyage';
import { WEAPONS } from '../../src/data/weapons';
import { MAX_GUNS, SYSTEM_CAP } from '../../src/sim/Run';
import type { EventEffect, ShipDef, SystemId } from '../../src/sim/types';

// File names under public/ (globs list them without loading anything) and the two manifests the game reads.
const artFiles = Object.keys(import.meta.glob('../../public/art/*.*')).map((p) => p.split('/').pop()!);
const audioFiles = Object.keys(import.meta.glob('../../public/audio/*.*')).map((p) => p.split('/').pop()!);
const manifests = import.meta.glob<{ files: string[] }>('../../public/*/manifest.json', { eager: true, import: 'default' });
const artManifest = manifests['../../public/art/manifest.json'].files;
const audioManifest = manifests['../../public/audio/manifest.json'].files;

const SYSTEM_IDS = Object.keys(SYSTEM_CAP) as SystemId[];
const effects = SEA_EVENTS.flatMap((e) => e.choices.flatMap((c) => c.outcomes.map((o) => o.effect)));

function checkShipDef(def: ShipDef): void {
  const ids = def.rooms.map((r) => r.id);
  expect(new Set(ids).size, 'room ids are unique').toBe(ids.length);
  for (const r of def.rooms) {
    expect(r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1, `${r.id} has a sensible size`).toBe(true);
    if (r.system) expect(def.systems[r.system], `${r.id} houses ${r.system}, which has no bars`).toBeGreaterThan(0);
  }
  for (const [id, bars] of Object.entries(def.systems) as [SystemId, number][]) {
    expect(SYSTEM_IDS, id).toContain(id);
    if (bars > 0) expect(def.rooms.filter((r) => r.system === id), `${id} needs exactly one room`).toHaveLength(1);
  }
  for (const id of ['helm', 'guns'] as SystemId[]) expect(def.systems[id], `${id} is needed to fight`).toBeGreaterThan(0);
  for (const g of def.guns) expect(WEAPONS[g.weapon], g.weapon).toBeDefined();
  expect(def.guns.length).toBeGreaterThan(0);
  expect(def.guns.length).toBeLessThanOrEqual(MAX_GUNS);
  expect(def.hull).toBeGreaterThan(0);
  expect(def.crew.length).toBeGreaterThan(0);
  expect(new Set(def.crew.map((c) => c.name)).size, 'crew names are unique').toBe(def.crew.length);
  for (const r of def.rooms) {
    const here = def.crew.filter((c) => c.room === r.id).length;
    expect(here, `${r.id} has bunks for its crew`).toBeLessThanOrEqual(r.w * r.h);
  }
  for (const c of def.crew) expect(ids, `${c.name}'s station`).toContain(c.room);
}

describe('ship definitions', () => {
  for (const def of [...PLAYER_SHIPS, ...ENEMY_LIST.map((e) => e.ship)]) {
    it(`${def.id}: rooms, systems, guns and crew fit together`, () => checkShipDef(def));
  }

  it('player ships have unique ids, start within the shipwright caps, and only unlock real ships', () => {
    expect(new Set(PLAYER_SHIPS.map((s) => s.id)).size).toBe(PLAYER_SHIPS.length);
    for (const def of PLAYER_SHIPS) {
      for (const [id, bars] of Object.entries(def.systems) as [SystemId, number][]) expect(bars, `${def.id} ${id}`).toBeLessThanOrEqual(SYSTEM_CAP[id]);
    }
    for (const id of Object.keys(SHIP_UNLOCKS)) expect(PLAYER_SHIPS.map((s) => s.id)).toContain(id);
  });
});

describe('enemy definitions', () => {
  for (const e of ENEMY_LIST) {
    it(`${e.id}: is filed under its own id and has a sane captain, hold and names`, () => {
      expect(ENEMIES[e.id]).toBe(e);
      expect(['navy', 'merchant', 'privateer', 'pirate']).toContain(e.faction);
      for (const k of ['fleeAt', 'surrenderChance', 'surrenderAt'] as const) {
        expect(e.ai[k], k).toBeGreaterThanOrEqual(0);
        expect(e.ai[k], k).toBeLessThanOrEqual(1);
      }
      if (e.ai.focus) expect(SYSTEM_IDS).toContain(e.ai.focus);
      expect(e.plunder[0]).toBeGreaterThanOrEqual(0);
      expect(e.plunder[1]).toBeGreaterThanOrEqual(e.plunder[0]);
      expect(e.names.length).toBeGreaterThan(0);
      expect(new Set(e.names).size).toBe(e.names.length);
      for (const line of [e.sighting, ...(e.sightings ?? [])]) expect(line.trim()).not.toBe('');
    });
  }

  it('every sector fields real enemies, with real weight, and a real vanguard', () => {
    for (const s of SECTORS) {
      expect(s.enemies.length, s.name).toBeGreaterThan(0);
      for (const [id, weight] of s.enemies) {
        expect(ENEMIES[id], `${s.name}: ${id}`).toBeDefined();
        expect(weight).toBeGreaterThan(0);
      }
      expect(ENEMIES[s.ambush], `${s.name} ambush`).toBeDefined();
    }
    // The blockade is always the frigate (SeaChart places it).
    expect(ENEMIES.frigate).toBeDefined();
  });
});

describe('weapons, fittings, ports and names', () => {
  it('weapons are filed under their ids, with positive stats and prices', () => {
    for (const [id, w] of Object.entries(WEAPONS)) {
      expect(w.id).toBe(id);
      for (const k of ['hands', 'loadTime', 'damage', 'shots', 'price'] as const) expect(w[k], `${id} ${k}`).toBeGreaterThan(0);
      expect(w.inaccuracy).toBeGreaterThanOrEqual(0);
    }
  });

  it('fittings are filed under their ids, priced, and described', () => {
    expect(FITTING_IDS.length).toBeGreaterThanOrEqual(2);
    for (const id of FITTING_IDS) {
      const f = FITTINGS[id];
      expect(f.id).toBe(id);
      expect(f.price).toBeGreaterThan(0);
      expect(f.name && f.blurb && f.short).toBeTruthy();
    }
  });

  it('every port has a tagline; recruit names are unique and never clash with a starting crew', () => {
    expect(new Set(PORT_NAMES).size).toBe(PORT_NAMES.length);
    for (const p of PORT_NAMES) expect(PORT_TAGLINES[p], p).toBeTruthy();
    expect(new Set(RECRUIT_NAMES).size).toBe(RECRUIT_NAMES.length);
    const starting = new Set(PLAYER_SHIPS.flatMap((s) => s.crew.map((c) => c.name)));
    for (const n of RECRUIT_NAMES) expect(starting.has(n), n).toBe(false);
  });
});

describe('event story flags', () => {
  const set = new Set(effects.map((x: EventEffect) => x.flag).filter(Boolean));
  it('every flag an event checks for, or clears, is one some event sets', () => {
    const used = SEA_EVENTS.flatMap((e) => [e.needs, ...e.choices.map((c) => c.needs)]).flatMap((n) => [n?.flag, n?.noFlag]);
    for (const f of [...used, ...effects.map((x) => x.clearFlag)].filter(Boolean)) expect(set.has(f), `${f} is never set`).toBe(true);
  });
});

describe('art and sound', () => {
  it('every file in a manifest exists, and nothing on disk is left out of one', () => {
    for (const f of artManifest) expect(artFiles, `art/${f}`).toContain(f);
    for (const f of audioManifest) expect(audioFiles, `audio/${f}`).toContain(f);
    for (const f of artFiles) if (f !== 'manifest.json') expect(artManifest, `art/${f} is not in the manifest`).toContain(f);
    for (const f of audioFiles) if (f !== 'manifest.json') expect(audioManifest, `audio/${f} is not in the manifest`).toContain(f);
  });

  it('every enemy and player ship has a picture, and the backdrops and textures the scenes use exist', () => {
    const art = new Set(artManifest.map((f) => f.replace(/\.\w+$/, '')));
    for (const e of ENEMY_LIST) if (e.id !== 'frigate') expect(art.has(`enemy-${e.id}`), `enemy-${e.id}`).toBe(true);
    for (const s of PLAYER_SHIPS) expect(art.has(`ship-${s.id}`), `ship-${s.id}`).toBe(true);
    for (const name of ['title', 'port', 'blockade', 'victory', 'defeat', 'tex-sea', 'tex-chart', 'tex-hull', 'tex-deck']) expect(art.has(name), name).toBe(true);
  });

  it('every event has its illustration (bar the few still to be painted), and every illustration belongs to an event', () => {
    // The event screen lays out text-only without a picture; this list should only ever shrink.
    const unpainted = ['starving', 'victualler', 'banks'];
    const art = new Set(artManifest.filter((f) => f.startsWith('event-')).map((f) => f.replace(/^event-|\.\w+$/g, '')));
    const ids = new Set(SEA_EVENTS.map((e) => e.id));
    expect(SEA_EVENTS.filter((e) => !art.has(e.id)).map((e) => e.id)).toEqual(unpainted);
    expect([...art].filter((id) => !ids.has(id))).toEqual([]);
  });
});
