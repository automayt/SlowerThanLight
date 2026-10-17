import { describe, expect, it } from 'vitest';
import { ENEMY_LIST } from '../../src/data/enemies';
import { POWER_IDS, POWERS, PORT_POWER, relation } from '../../src/data/powers';
import { PORT_NAMES, SEA_EVENTS } from '../../src/data/voyage';
import { autoRun } from '../../src/sim/autoRun';
import { CONSORT_EVERY, CONSORT_DAMAGE, DIFFICULTY, GIFT_STANDING, Run, type Encounter, type Intent } from '../../src/sim/Run';
import { AGGRESSION, BETRAYAL, describeShift, freshStanding, OUTCOME_STANDING, PORT_PRICE, RIPPLE, shiftStanding, tierOf } from '../../src/sim/Diplomacy';
import type { PowerId } from '../../src/sim/types';

/** A run with a ship in sight, hailed with the given greeting. */
function hailing(enemy: string, intent: Intent, seed = 1): Run {
  const run = new Run('gull', seed);
  run.encounter = { kind: 'battle', enemy, name: 'The Test', boss: false, ambush: false, text: '', intent };
  run.status = 'hail';
  return run;
}

function inPort(name: string): Run {
  const run = new Run('gull', 1);
  run.encounter = { kind: 'port', name, rested: false, stock: [] };
  run.status = 'port';
  return run;
}

/** Win the current battle outright (her hull shot away). */
function winBattle(run: Run) {
  const b = run.startBattle();
  b.enemy.hull = 0;
  b.step(0.05);
  return run.finishBattle(b);
}

const rig = (run: Run, chance: boolean) => (run.rng.chance = () => chance);

describe('standing', () => {
  it('every power starts where its data says, and every enemy and port answers to a power', () => {
    const s = freshStanding();
    for (const id of POWER_IDS) expect(s[id]).toBe(POWERS[id].start);
    for (const e of ENEMY_LIST) expect(POWER_IDS).toContain(e.power);
    for (const name of PORT_NAMES) expect(PORT_POWER[name], name).toBeDefined();
  });

  it('opinion falls into bands', () => {
    expect(tierOf(-100)).toBe('feud');
    expect(tierOf(-60)).toBe('hostile');
    expect(tierOf(-21)).toBe('hostile');
    expect(tierOf(0)).toBe('wary');
    expect(tierOf(20)).toBe('friendly');
    expect(tierOf(100)).toBe('allied');
  });

  it("hurting a power pleases its enemies and annoys its friends, within bounds", () => {
    const s = freshStanding();
    const d = shiftStanding(s, 'crown', -20, true);
    expect(d.crown).toBe(-20);
    expect(d.spain).toBe(Math.round(20 * RIPPLE));
    expect(d.brethren).toBeGreaterThan(0);
    expect(d.trade).toBeLessThan(0);
    s.crown = -95;
    expect(shiftStanding(s, 'crown', -20, false).crown).toBe(-5);
    expect(s.crown).toBe(-100);
  });

  it('reports the changes, biggest first, and any power that crossed into a new band', () => {
    const s = freshStanding();
    const before = { ...s };
    const lines = describeShift(before, shiftStanding(s, 'france', 25, false));
    expect(lines[0]).toBe('Standing: France +25');
    expect(lines[1]).toMatch(/France is now friendly/);
    expect(describeShift(s, {})).toEqual([]);
  });

  it('powers that hate each other are listed both ways round', () => {
    expect(relation('crown', 'spain')).toBe(-1);
    expect(relation('spain', 'crown')).toBe(-1);
    expect(relation('france', 'trade')).toBe(0);
  });
});

describe('hailing', () => {
  it('a sighted ship is hailed before any fight; merchants never start one', () => {
    for (let seed = 1; seed < 60; seed++) {
      const run = new Run('gull', seed);
      const node = run.reachable().find((n) => n.kind === 'battle' && !run.willBeOverrun(n));
      if (!node) continue;
      run.jump(node.id);
      expect(run.status).toBe('hail');
      const enc = run.encounter as Extract<Encounter, { kind: 'battle' }>;
      if (enc.enemy === 'merchant' || enc.enemy === 'smuggler') expect(enc.intent).toBe('wary');
      if (enc.enemy === 'cutter') expect(enc.intent).toBe('hostile');
      expect(run.hailText()).toBeTruthy();
      expect(run.hailOptions().some((o) => o.id === 'attack' && o.available)).toBe(true);
    }
  });

  it('fighting a ship that would have let you be costs extra standing; a friend, far more', () => {
    for (const [intent, extra] of [['hostile', 0], ['wary', AGGRESSION], ['friendly', BETRAYAL]] as const) {
      const run = hailing('privateer', intent);
      const before = run.standing.crown;
      expect(run.hail('attack').fight).toBe(true);
      expect(run.status).toBe('battle');
      winBattle(run);
      expect(run.standing.crown).toBe(before + OUTCOME_STANDING.victory! - extra);
    }
  });

  it('a hostile ship can be talked round, bought off or fooled, and a failed trick is remembered', () => {
    const talk = hailing('cutter', 'hostile');
    rig(talk, true);
    expect(talk.hail('parley').fight).toBe(false);
    expect(talk.status).toBe('chart');

    const pay = hailing('cutter', 'hostile');
    pay.gold = 200;
    const cost = pay.bribePrice();
    pay.hail('bribe');
    expect(pay.gold).toBe(200 - cost);
    expect(pay.status).toBe('chart');

    const trick = hailing('cutter', 'hostile');
    rig(trick, false);
    const before = trick.standing.crown;
    expect(trick.hail('colours').fight).toBe(true);
    expect(trick.standing.crown).toBeLessThan(before);
    // She meant to fight anyway: no extra penalty for "starting" it.
    expect((trick.encounter as Extract<Encounter, { kind: 'battle' }>).aggressor).toBe(false);
  });

  it('a blood feud cannot be parleyed with or bought off', () => {
    const run = hailing('cutter', 'hostile');
    run.standing.crown = -90;
    run.gold = 500;
    const opts = run.hailOptions();
    expect(opts.find((o) => o.id === 'parley')!.available).toBe(false);
    expect(opts.find((o) => o.id === 'bribe')!.available).toBe(false);
    expect(() => run.hail('bribe')).toThrow();
  });

  it('toll is paid without a fight, or refused with one', () => {
    const paid = hailing('merchant', 'wary');
    rig(paid, true);
    const gold = paid.gold;
    expect(paid.hail('tribute').fight).toBe(false);
    expect(paid.gold).toBeGreaterThan(gold);

    const refused = hailing('merchant', 'wary');
    rig(refused, false);
    expect(refused.hail('tribute').fight).toBe(true);
    expect((refused.encounter as Extract<Encounter, { kind: 'battle' }>).aggressor).toBe(true);
  });

  it('a friend trades, gives news of the fleet, and an ally sails in company', () => {
    const news = hailing('corsair', 'friendly');
    const navy = news.navy;
    news.hail('news');
    expect(news.navy).toBeLessThan(navy);

    const stores = hailing('corsair', 'friendly');
    stores.gold = 50;
    stores.provisions = 0;
    stores.hail('trade');
    expect(stores.provisions).toBeGreaterThan(0);

    const friend = hailing('corsair', 'friendly');
    friend.standing.france = 30;
    expect(friend.hailOptions().find((o) => o.id === 'escort')!.available).toBe(false);
    const ally = hailing('corsair', 'friendly');
    ally.standing.france = 70;
    ally.hail('escort');
    expect(ally.escort).toEqual({ name: 'The Test', power: 'france' });
  });

  it('an escort fires into the next enemy, then parts company', () => {
    const run = hailing('cutter', 'hostile');
    run.escort = { name: 'La Mouette', power: 'france' };
    run.hail('attack');
    const b = run.startBattle();
    expect(b.consort?.name).toBe('La Mouette');
    const hull = b.enemy.hull;
    let fired = false;
    for (let t = 0; t < CONSORT_EVERY + 0.2; t += 0.05) {
      b.step(0.05);
      if (b.drainEvents().some((e) => e.t === 'consort')) fired = true;
    }
    expect(fired).toBe(true);
    expect(b.enemy.hull).toBeLessThanOrEqual(hull);
    expect(CONSORT_DAMAGE).toBeGreaterThan(0);
    b.enemy.hull = 0;
    b.step(0.05);
    const report = run.finishBattle(b);
    expect(run.escort).toBeNull();
    expect(report.lines.some((l) => l.includes('parts company'))).toBe(true);
  });

  it('a friend of the Crown is offered a pardon at the blockade; an ally of the Brethren finds the frigate already holed', () => {
    const find = (prep: (r: Run) => void) => {
      const run = new Run('gull', 3);
      prep(run);
      (run as unknown as { sector: number }).sector = 2;
      (run as unknown as { chart: Run['chart'] }).chart = (run as unknown as { makeChart(s: number): Run['chart'] }).makeChart(2);
      const boss = run.chart.nodes.find((n) => n.kind === 'boss')!;
      run.nodeId = run.chart.nodes.find((n) => n.next.includes(boss.id))!.id;
      run.jump(boss.id);
      return run;
    };
    const plain = find(() => {});
    expect(plain.status).toBe('battle');

    const pardoned = find((r) => (r.standing.crown = 30));
    expect(pardoned.status).toBe('hail');
    pardoned.hail('pardon');
    expect(pardoned.status).toBe('won');
    expect(pardoned.endingTitle).toMatch(/Pardon/);

    const aided = find((r) => (r.standing.brethren = 80));
    const full = plain.startBattle().enemy.hull;
    expect(aided.startBattle().enemy.hull).toBeLessThan(full);
  });

  it('allies slow the fleet, and so does a friendly Crown', () => {
    const run = new Run('gull', 1);
    const base = DIFFICULTY.normal.navySpeed;
    expect(run.navySpeed).toBe(base);
    run.standing.crown = 25;
    run.standing.france = 70;
    expect(run.navySpeed).toBeCloseTo(base - 0.2);
  });
});

describe('battles and standing', () => {
  it('sinking is remembered longer than taking a surrender, and her enemies cheer', () => {
    const run = hailing('guarda', 'hostile');
    run.hail('attack');
    const spain = run.standing.spain;
    const crown = run.standing.crown;
    const report = winBattle(run);
    expect(run.standing.spain).toBe(spain + OUTCOME_STANDING.victory!);
    expect(run.standing.crown).toBeGreaterThan(crown);
    expect(report.lines.some((l) => l.startsWith('Standing:'))).toBe(true);
  });

  it('the blockade fight leaves standing alone', () => {
    const run = new Run('gull', 1);
    run.encounter = { kind: 'battle', enemy: 'frigate', name: 'HMS Relentless', boss: true, ambush: false, text: '' };
    run.status = 'battle';
    const before = { ...run.standing };
    winBattle(run);
    expect(run.standing).toEqual(before);
  });
});

describe('ports', () => {
  it('prices follow how the harbour regards you, and a feud closes the hiring hall', () => {
    const royal = inPort('Port Royal');
    royal.gold = 1000;
    const base = Math.round(100 * PORT_PRICE[royal.tier('crown')]);
    expect(royal.price(100)).toBe(base);
    royal.standing.crown = 70;
    expect(royal.price(100)).toBe(Math.round(100 * PORT_PRICE.allied));
    expect(royal.canHire()).toBe(true);
    royal.standing.crown = -80;
    expect(royal.price(100)).toBe(Math.round(100 * PORT_PRICE.feud));
    expect(royal.canHire()).toBe(false);
  });

  it('a gift buys goodwill once a visit', () => {
    const run = inPort('Saint-Pierre');
    run.gold = 200;
    const before = run.standing.france;
    expect(run.gift().length).toBeGreaterThan(0);
    expect(run.standing.france).toBe(before + GIFT_STANDING);
    expect(run.canGift()).toBe(false);
    expect(run.gift()).toEqual([]);
  });

  it('a hunting commission pays on taking a ship of the right flag', () => {
    const run = new Run('gull', 1);
    run.commission = { patron: 'crown', kind: 'hunt', target: 'spain', port: 'Port Royal', gold: 50, standing: 15 };
    run.encounter = { kind: 'battle', enemy: 'cutter', name: 'HMS X', boss: false, ambush: false, text: '' };
    run.status = 'battle';
    winBattle(run);
    expect(run.commission).not.toBeNull();
    run.encounter = { kind: 'battle', enemy: 'guarda', name: 'San X', boss: false, ambush: false, text: '' };
    run.status = 'battle';
    const gold = run.gold;
    const report = winBattle(run);
    expect(run.commission).toBeNull();
    expect(run.gold - gold).toBeGreaterThanOrEqual(50);
    expect(report.lines.some((l) => l.startsWith('Commission fulfilled'))).toBe(true);
  });

  it('letters are delivered at the next port, and ports offer work unless they want you dead', () => {
    const run = new Run('gull', 1);
    const enter = (name: string) => (run as unknown as { enterPort(n: string, s: string[]): Encounter }).enterPort(name, []);
    run.commission = { patron: 'trade', kind: 'dispatch', port: 'Bridgetown', gold: 25, standing: 10 };
    const same = enter('Bridgetown');
    expect(run.commission).not.toBeNull();
    expect(same.kind === 'port' && same.welcome).toEqual([]);
    const gold = run.gold;
    const other = enter('Nassau');
    expect(run.commission).toBeNull();
    expect(run.gold).toBe(gold + 25);
    expect(other.kind === 'port' && other.welcome?.[0]).toMatch(/Letters delivered/);
    expect(other.kind === 'port' && other.commission).toBeTruthy();
    expect(run.takeCommission()).toBe(true);
    expect(run.takeCommission()).toBe(false);

    run.standing.crown = -90;
    const hostile = enter('Port Royal');
    expect(hostile.kind === 'port' && hostile.commission).toBeNull();
  });

  it('commissions only ask you to hunt a power the patron is at odds with', () => {
    for (let seed = 1; seed < 40; seed++) {
      const run = new Run('gull', seed);
      for (const name of PORT_NAMES) {
        const enc = (run as unknown as { enterPort(n: string, s: string[]): Encounter }).enterPort(name, []);
        const c = enc.kind === 'port' ? enc.commission : null;
        if (c?.kind === 'hunt') expect(relation(c.patron, c.target!)).toBeLessThan(0);
      }
    }
  });
});

describe('events and saves', () => {
  it('events can move standing, and can need it', () => {
    const run = new Run('gull', 1);
    const lines = run.applyEffect({ text: '', standing: { spain: 15 } });
    expect(run.standing.spain).toBe(POWERS.spain.start + 15);
    expect(lines[0]).toMatch(/Spain \+15/);
    expect(run.unmet({ standing: { brethren: 50 } })).toMatch(/Brethren/);
    expect(run.unmet({ standing: { crown: { max: -60 } } })).toMatch(/Crown/);
    run.standing.crown = -70;
    expect(run.unmet({ standing: { crown: { max: -60 } } })).toBeNull();
  });

  it('every standing an event names is a real power', () => {
    for (const ev of SEA_EVENTS) {
      const ids = [ev.needs, ...ev.choices.map((c) => c.needs)].flatMap((n) => Object.keys(n?.standing ?? {}));
      for (const c of ev.choices) for (const o of c.outcomes) ids.push(...Object.keys(o.effect.standing ?? {}));
      for (const id of ids) expect(POWER_IDS, ev.id).toContain(id as PowerId);
    }
  });

  it('standing, escort and commission survive a save; older saves start fresh', () => {
    const run = new Run('gull', 1);
    run.standing.france = 55;
    run.escort = { name: 'La Mouette', power: 'france' };
    run.commission = { patron: 'france', kind: 'dispatch', port: 'Saint-Pierre', gold: 25, standing: 10 };
    const back = Run.fromSave(JSON.parse(JSON.stringify(run.toSave())));
    expect(back.standing).toEqual(run.standing);
    expect(back.escort).toEqual(run.escort);
    expect(back.commission).toEqual(run.commission);
    const old = run.toSave();
    delete old.standing;
    delete old.escort;
    delete old.commission;
    const legacy = Run.fromSave(old);
    expect(legacy.standing).toEqual(freshStanding());
    expect(legacy.escort).toBeNull();
  });

  it('a diplomatic captain finishes voyages and ends them on better terms with someone', () => {
    let warmer = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { run } = autoRun(new Run('gull', seed), { diplomacy: true });
      expect(run.over).toBe(true);
      if (POWER_IDS.some((p) => run.standing[p] > POWERS[p].start)) warmer++;
    }
    expect(warmer).toBeGreaterThan(0);
  });
});
