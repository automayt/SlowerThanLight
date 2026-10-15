import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/data/enemies';
import { SEA_EVENTS, seaEvent } from '../../src/data/voyage';
import { WEAPONS } from '../../src/data/weapons';
import { RARITY_WEIGHT, Run } from '../../src/sim/Run';
import type { EventEffect, EventNeeds, SeaEventDef } from '../../src/sim/types';

const effects = (e: SeaEventDef): EventEffect[] => e.choices.flatMap((c) => c.outcomes.map((o) => o.effect));
const texts = (e: SeaEventDef): string[] => [e.text, ...(e.variants ?? []), ...e.choices.map((c) => c.label), ...effects(e).map((x) => x.text)];
const SYSTEMS = ['helm', 'sails', 'guns', 'pumps', 'surgeon'];
const flagsSet = new Set(SEA_EVENTS.flatMap((e) => effects(e).map((x) => x.flag).filter(Boolean)));

/** A run in the middle of the voyage, rich, crewed, and with whatever an event or choice needs. */
function richRun(seed: number, needs: (EventNeeds | undefined)[] = []): Run {
  const run = new Run('maw', seed);
  run.navy = -99;
  // Sail to column 4 so depth-gated events are allowed.
  while (run.node.col < 4) {
    run.status = 'chart';
    run.jump(run.reachable()[0].id);
  }
  run.status = 'chart';
  run.gold = 500;
  run.condition.crew[0].hp = 40;
  run.condition.damage = { sails: 1 };
  run.condition.hull = 10;
  run.fit.guns = run.fit.guns.slice(0, 3);
  for (const n of needs) if (n?.flag) run.flags.add(n.flag);
  return run;
}

describe('event data', () => {
  it('has plenty of both kinds of event, spread across rarities', () => {
    const pool = (p: string) => SEA_EVENTS.filter((e) => (e.pool ?? 'encounter') === p);
    expect(pool('encounter').length).toBeGreaterThanOrEqual(25);
    expect(pool('incident').length).toBeGreaterThanOrEqual(25);
    for (const r of ['uncommon', 'rare', 'legendary']) expect(SEA_EVENTS.some((e) => e.rarity === r), r).toBe(true);
  });

  it('has unique ids', () => {
    expect(new Set(SEA_EVENTS.map((e) => e.id)).size).toBe(SEA_EVENTS.length);
  });

  for (const ev of SEA_EVENTS) {
    it(`${ev.id}: is well formed`, () => {
      expect(ev.choices.length, 'choices').toBeGreaterThan(0);
      for (const c of ev.choices) {
        expect(c.outcomes.length, c.label).toBeGreaterThan(0);
        for (const o of c.outcomes) expect(o.weight).toBeGreaterThan(0);
      }
      for (const t of texts(ev)) {
        for (const [, name] of t.matchAll(/\{(\w+)\}/g)) expect(['crew', 'crew2', 'ship'], `{${name}} in "${t}"`).toContain(name);
      }
      const usesSecond = texts(ev).some((t) => t.includes('{crew2}')) || effects(ev).some((x) => x.actor2Hp || x.loseActor2);
      if (usesSecond) expect(ev.needs?.crew ?? 0, 'events about two crew need two crew').toBeGreaterThanOrEqual(2);
      for (const x of effects(ev)) {
        if (x.battle) expect(ENEMIES[x.battle], x.battle).toBeDefined();
        if (x.gun) expect(WEAPONS[x.gun], x.gun).toBeDefined();
        if (x.next) expect(seaEvent(x.next).pool, `${x.next} should be a chain page`).toBe('chain');
        if (x.upgrade) expect([...SYSTEMS, 'hands', 'hull']).toContain(x.upgrade);
        for (const id of Object.keys(x.damage ?? {})) expect(SYSTEMS).toContain(id);
        expect([x.battle, x.next, x.ending].filter(Boolean).length, 'one way out').toBeLessThanOrEqual(1);
      }
      for (const n of [ev.needs, ...ev.choices.map((c) => c.needs)]) {
        if (n?.flag) expect(flagsSet.has(n.flag), `flag ${n.flag} is never set`).toBe(true);
      }
    });
  }

  it('every chain page is reached from some event', () => {
    const targets = new Set(SEA_EVENTS.flatMap((e) => effects(e).map((x) => x.next)));
    for (const ev of SEA_EVENTS.filter((e) => e.pool === 'chain')) expect(targets.has(ev.id), ev.id).toBe(true);
  });
});

describe('every choice of every event', () => {
  for (const ev of SEA_EVENTS) {
    it(`${ev.id}: each choice resolves cleanly`, () => {
      ev.choices.forEach((choice, i) => {
        for (let seed = 1; seed <= 6; seed++) {
          const run = richRun(seed, [ev.needs, choice.needs]);
          run.startEvent(ev);
          if (!run.canChoose(i)) continue;
          const crewBefore = run.condition.crew.length;
          const result = run.chooseEvent(i);
          expect(result.effect.text).not.toMatch(/\{\w+\}/);
          expect(['chart', 'battle', 'event', 'won']).toContain(run.status);
          if (run.status === 'event') expect(run.currentEvent().pool).toBe('chain');
          if (run.status === 'battle') run.startBattle();
          expect(run.condition.hull).toBeGreaterThanOrEqual(1);
          expect(run.condition.crew.length).toBeGreaterThanOrEqual(Math.min(1, crewBefore));
          expect(run.gold).toBeGreaterThanOrEqual(0);
        }
      });
    });
  }
});

describe('drawing events', () => {
  it('only draws events whose conditions hold, from the right pool, never chain pages', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const run = richRun(seed);
      for (const pool of ['encounter', 'incident'] as const) {
        const ev = run.drawEvent(pool)!;
        expect(ev.pool ?? 'encounter').toBe(pool);
        expect(run.unmet(ev.needs)).toBeNull();
      }
    }
  });

  it('does not repeat an event within a voyage while fresh ones remain, and never repeats a unique one', () => {
    const run = richRun(3);
    const seen: string[] = [];
    for (let i = 0; i < 25; i++) {
      const ev = run.drawEvent('incident')!;
      seen.push(ev.id);
      run.startEvent(ev);
      run.status = 'chart';
    }
    expect(new Set(seen).size).toBe(seen.length);
    for (let i = 0; i < 200; i++) {
      const ev = run.drawEvent('incident');
      if (!ev) break;
      if (ev.unique) expect(seen).not.toContain(ev.id);
      seen.push(ev.id);
      run.startEvent(ev);
      run.status = 'chart';
    }
  });

  it('legendary events are rare but do turn up', () => {
    const counts: Record<string, number> = {};
    let draws = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const run = richRun(seed);
      run.flags.clear();
      for (let i = 0; i < 4; i++) {
        const ev = run.drawEvent('encounter')!;
        const r = ev.rarity ?? 'common';
        counts[r] = (counts[r] ?? 0) + 1;
        draws++;
        run.startEvent(ev);
        run.status = 'chart';
      }
    }
    expect(counts.legendary ?? 0).toBeGreaterThan(0);
    expect((counts.legendary ?? 0) / draws).toBeLessThan(0.1);
    expect(counts.common).toBeGreaterThan(counts.rare ?? 0);
    expect(RARITY_WEIGHT.legendary).toBeLessThan(RARITY_WEIGHT.rare);
  });

  it('open sea sometimes brings an incident aboard', () => {
    let incidents = 0;
    let quiet = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const run = new Run('gull', seed);
      run.navy = -99;
      const node = run.reachable()[0];
      node.kind = 'empty';
      const enc = run.jump(node.id);
      if (enc.kind === 'event') {
        incidents++;
        expect(run.currentEvent().pool).toBe('incident');
      } else quiet++;
    }
    expect(incidents).toBeGreaterThan(0);
    expect(quiet).toBeGreaterThan(0);
  });
});

describe('event mechanics', () => {
  it('names two different crew members and fills them into the text', () => {
    const run = richRun(1);
    run.startEvent(seaEvent('brawl'));
    const enc = run.encounter as { actor: string; actor2: string };
    expect(enc.actor).not.toBe(enc.actor2);
    expect(run.fill('{crew} and {crew2} aboard {ship}')).toBe(`${enc.actor} and ${enc.actor2} aboard ${run.def.name}`);
  });

  it('tells a common event in different ways across voyages', () => {
    const ev = seaEvent('becalmed');
    const tellings = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const run = richRun(seed);
      run.startEvent(ev);
      tellings.add(run.eventText());
    }
    expect(tellings.size).toBe(1 + ev.variants!.length);
  });

  it('losing {crew} removes exactly that crew member, but never the last', () => {
    const run = richRun(1);
    run.startEvent(seaEvent('fall'));
    const name = (run.encounter as { actor: string }).actor;
    run.applyEffect({ text: '', loseActor: true });
    expect(run.condition.crew.map((c) => c.name)).not.toContain(name);

    run.condition.crew = run.condition.crew.slice(0, 1);
    run.startEvent(seaEvent('fall'));
    run.applyEffect({ text: '', loseActor: true });
    expect(run.condition.crew).toHaveLength(1);
  });

  it('a chained page keeps the same crew', () => {
    const run = richRun(2);
    run.startEvent(seaEvent('blackbeard'));
    const actor = (run.encounter as { actor: string }).actor;
    run.chooseEvent(0);
    expect(run.currentEvent().id).toBe('blackbeard-supper');
    expect((run.encounter as { actor: string }).actor).toBe(actor);
  });

  it('the pardon ends the voyage happily', () => {
    const run = richRun(2);
    run.gold = 150;
    run.startEvent(seaEvent('pardon'));
    run.chooseEvent(0);
    expect(run.status).toBe('won');
    expect(run.endingTitle).toBe('The King’s Pardon');
    expect(run.over).toBe(true);
  });

  it('a choice needing something you lack says why', () => {
    const run = richRun(2);
    run.flags.delete('cat');
    run.startEvent(seaEvent('rats'));
    expect(run.choiceBlocker(0)).toBeTruthy();
    expect(run.canChoose(0)).toBe(false);
    run.flags.add('cat');
    expect(run.canChoose(0)).toBe(true);
  });

  it('the treasure map chain leads to treasure', () => {
    const run = richRun(5);
    run.flags.clear();
    expect(run.unmet(seaEvent('cartographer').needs)).not.toBeNull();
    run.startEvent(seaEvent('torn-map'));
    run.chooseEvent(0);
    expect(run.unmet(seaEvent('cartographer').needs)).toBeNull();
    run.startEvent(seaEvent('cartographer'));
    run.chooseEvent(0);
    expect(run.flags.has('map-whole')).toBe(true);
    run.startEvent(seaEvent('treasure-island'));
    run.chooseEvent(0);
    const gold = run.gold;
    run.chooseEvent(0);
    expect(run.gold).toBeGreaterThan(gold);
    expect(run.flags.has('treasure')).toBe(true);
  });

  it('flags and seen events survive a save', () => {
    const run = richRun(2);
    run.flags.add('cursed');
    run.startEvent(seaEvent('omens'));
    const back = Run.fromSave(JSON.parse(JSON.stringify(run.toSave())));
    expect(back.flags.has('cursed')).toBe(true);
    expect(back.seenEvents).toContain('omens');
    expect(back.fill('{crew}')).toBe(run.fill('{crew}'));
  });
});
