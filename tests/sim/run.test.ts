import { describe, expect, it } from 'vitest';
import { PLAYER_SHIPS } from '../../src/data/ships';
import { ENEMIES } from '../../src/data/enemies';
import { autoRun } from '../../src/sim/autoRun';
import { Rng } from '../../src/sim/rng';
import { BOSS_TIER, CREW_PRICE, HULL_PRICE, NAVY_START, PROVISION_PRICE, SECTOR_CARRY, MAX_GUNS, START_GOLD, NAVY_SPEED, PLATING, PORT_REST_DELAY, Run, scaleEnemy, SYSTEM_CAP } from '../../src/sim/Run';
import { WEAPONS, weapon } from '../../src/data/weapons';
import { FITTINGS } from '../../src/data/fittings';
import { grappleSpeed } from '../../src/sim/Boarding';
import { Ship } from '../../src/sim/Ship';
import { CHART_COLUMNS, generateChart, type SeaChart } from '../../src/sim/SeaChart';

function chart(seed: number): SeaChart {
  return generateChart(new Rng(seed), { ports: ['A', 'B', 'C'], armoury: ['pdr6', 'pdr9'] });
}

/** A run parked at a node of the given kind, ready for its encounter. */
/** A sighted ship is hailed first: answer with the guns. */
function engage(run: Run): void {
  if (run.status === 'hail') run.hail('attack');
}

function runAt(kind: 'port' | 'event' | 'battle', seed = 1): Run {
  for (let s = seed; s < seed + 200; s++) {
    const run = new Run('gull', s);
    const target = run.reachable().find((n) => n.kind === kind && !run.willBeOverrun(n));
    if (target) {
      run.jump(target.id);
      engage(run);
      return run;
    }
    // Look one column further: sail through an empty-ish first node.
    for (const first of run.reachable()) {
      const probe = new Run('gull', s);
      probe.jump(first.id);
      if (probe.status !== 'chart') continue;
      const t = probe.reachable().find((n) => n.kind === kind && !probe.willBeOverrun(n));
      if (t) {
        probe.jump(t.id);
        engage(probe);
        return probe;
      }
    }
  }
  throw new Error(`No ${kind} node found`);
}

describe('sea chart', () => {
  for (const seed of [1, 2, 3, 42, 99]) {
    it(`seed ${seed}: runs from one start to one boss, every node reachable and with a way on`, () => {
      const c = chart(seed);
      expect(c.nodes[0].kind).toBe('start');
      const bosses = c.nodes.filter((n) => n.kind === 'boss');
      expect(bosses).toHaveLength(1);
      expect(bosses[0].col).toBe(CHART_COLUMNS - 1);

      const reached = new Set([0]);
      for (const n of c.nodes) if (reached.has(n.id)) n.next.forEach((id) => reached.add(id));
      expect(reached.size).toBe(c.nodes.length);
      for (const n of c.nodes) {
        if (n.kind !== 'boss') expect(n.next.length, `node ${n.id}`).toBeGreaterThan(0);
        for (const id of n.next) expect(c.nodes[id].col).toBe(n.col + 1);
      }
    });

    it(`seed ${seed}: edges never cross`, () => {
      const c = chart(seed);
      for (let col = 0; col < c.columns - 1; col++) {
        const edges = c.nodes.filter((n) => n.col === col).flatMap((n) => n.next.map((to) => [n.y, c.nodes[to].y]));
        for (const [a1, b1] of edges) for (const [a2, b2] of edges) expect((a1 - a2) * (b1 - b2) >= 0).toBe(true);
      }
    });

    it(`seed ${seed}: has a port before the blockade and content on every node`, () => {
      const c = chart(seed);
      expect(c.nodes.some((n) => n.kind === 'port' && n.col === c.columns - 2)).toBe(true);
      for (const n of c.nodes) {
        if (n.kind === 'battle' || n.kind === 'boss') expect(ENEMIES[n.enemy!]).toBeDefined();
        if (n.kind === 'port') expect(n.name).toBeTruthy();
        if (n.kind === 'port') expect(n.stock?.length).toBe(2);
      }
    });
  }

  it('is the same chart for the same seed', () => {
    expect(chart(7)).toEqual(chart(7));
  });
});

describe('run', () => {
  it('starts in Tortuga with a fresh ship and only next-column nodes reachable', () => {
    const run = new Run('wren', 5);
    expect(run.node.kind).toBe('start');
    expect(run.condition.hull).toBe(run.def.hull);
    expect(run.reachable().every((n) => n.col === 1)).toBe(true);
    expect(() => run.jump(run.chart.nodes.at(-1)!.id)).toThrow();
  });

  it('the fleet advances every jump', () => {
    const run = calm(new Run('gull', 3));
    const before = run.navy;
    run.jump(run.reachable()[0].id);
    expect(run.navy).toBeCloseTo(before + NAVY_SPEED);
  });

  it('a node the fleet has overrun becomes a Navy ambush', () => {
    const run = new Run('gull', 3);
    run.navy = 5;
    const target = run.reachable()[0];
    expect(run.willBeOverrun(target)).toBe(true);
    const enc = run.jump(target.id);
    expect(enc).toMatchObject({ kind: 'battle', enemy: 'cutter', ambush: true });
  });

  it('carries battle damage, pays plunder for a win and pushes the fleet back after an ambush', () => {
    const run = new Run('maw', 3);
    run.navy = 5;
    run.jump(run.reachable()[0].id);
    const navy = run.navy;
    const gold = run.gold;
    const battle = run.startBattle();
    battle.enemy.hull = 0;
    battle.player.hull = 17;
    battle.player.crew[0].hp = 33;
    battle.step(0.05);
    const report = run.finishBattle(battle);
    expect(report.won).toBe(true);
    expect(report.plunder).toBeGreaterThan(0);
    expect(run.gold).toBe(gold + report.plunder);
    expect(run.navy).toBeLessThan(navy);
    expect(run.condition.hull).toBe(17);
    expect(run.condition.crew[0].hp).toBeLessThan(100);
    expect(run.status).toBe('chart');
  });

  it('losing a battle ends the run', () => {
    const run = runAt('battle');
    const battle = run.startBattle();
    battle.player.hull = 0;
    battle.step(0.05);
    run.finishBattle(battle);
    expect(run.status).toBe('lost');
    expect(run.over).toBe(true);
  });

  it('the boss cannot be fled and beating her wins the run', () => {
    const run = new Run('gull', 8);
    run.navy = -99;
    while (run.status === 'chart' && run.node.kind !== 'boss') {
      run.jump(run.reachable()[0].id);
      run.status = 'chart'; // skip whatever was there
    }
    expect(run.encounter).toMatchObject({ kind: 'battle', boss: true });
    run.status = 'battle';
    const battle = run.startBattle();
    expect(battle.allowEscape).toBe(false);
    battle.enemy.hull = 0;
    battle.step(0.05);
    run.finishBattle(battle);
    expect(run.status).toBe('won');
  });

  it('running repairs mend one point of system damage and heal crew between nodes', () => {
    const run = new Run('gull', 2);
    run.condition.damage = { guns: 2, sails: 1 };
    run.condition.crew[0].hp = 50;
    run.jump(run.reachable()[0].id);
    expect(run.condition.damage).toEqual({ guns: 1, sails: 1 });
    expect(run.condition.crew[0].hp).toBeGreaterThan(50);
  });
});

describe('events', () => {
  it('apply gold, hull, wounds, recruits and fleet changes without ever ending the run', () => {
    const run = new Run('wren', 1);
    const crew = run.condition.crew.length;
    run.applyEffect({ text: '', gold: 10, hull: -99, crewHp: -500, recruit: 1, navy: 1 });
    expect(run.gold).toBe(START_GOLD + 10);
    expect(run.condition.hull).toBe(1);
    expect(run.condition.crew.every((c) => c.hp >= 1)).toBe(true);
    expect(run.condition.crew).toHaveLength(crew + 1);
    run.applyEffect({ text: '', loseCrew: 99, gold: -999 });
    expect(run.condition.crew).toHaveLength(1);
    expect(run.gold).toBe(0);
  });

  it('a salvaged gun goes in a free gun port, or is sold when there is none', () => {
    const run = new Run('wren', 1);
    const guns = run.fit.guns.length;
    run.applyEffect({ text: '', gun: 'pdr12' });
    expect(run.fit.guns).toHaveLength(guns + 1);
    while (run.fit.guns.length < MAX_GUNS) run.fit.guns.push({ weapon: 'pdr6' });
    const gold = run.gold;
    run.applyEffect({ text: '', gun: 'pdr12' });
    expect(run.fit.guns).toHaveLength(MAX_GUNS);
    expect(run.gold).toBeGreaterThan(gold);
  });

  it('a choice you cannot afford is refused', () => {
    const run = runAt('event');
    const ev = run.currentEvent();
    run.gold = 0;
    ev.choices.forEach((c, i) => c.cost && expect(run.canChoose(i)).toBe(false));
  });

  it('a fight from an event can be started', () => {
    const run = new Run('gull', 4);
    run.encounter = { kind: 'event', event: 'picket' };
    run.status = 'event';
    run.chooseEvent(0);
    expect(run.startBattle().enemy.def.id).toBe('cutter');
  });
});

describe('port', () => {
  it('sells hull repairs and crew for gold', () => {
    const run = runAt('port');
    run.condition.hull = 10;
    // The hiring hall's cheapest hand.
    const hands = run.encounter.kind === 'port' ? run.encounter.hands! : [];
    run.gold = HULL_PRICE * 2 + Math.min(...hands.map((c) => run.handPrice(c)));
    run.condition.crew.pop();
    expect(run.repairHull(2)).toBe(true);
    expect(run.condition.hull).toBe(12);
    expect(run.hireCrew()).toBeTruthy();
    expect(run.gold).toBe(0);
    expect(run.repairHull(1)).toBe(false);
    expect(run.hireCrew()).toBeNull();
  });

  it('will not hire beyond the bunks', () => {
    const run = runAt('port');
    run.gold = 1000;
    while (run.hireCrew());
    expect(run.condition.crew).toHaveLength(run.maxCrew);
  });

  it('resting heals and repairs everything once, at the cost of time', () => {
    const run = runAt('port');
    run.condition.damage = { guns: 2 };
    run.condition.crew[0].hp = 20;
    const navy = run.navy;
    expect(run.rest()).toBe(true);
    expect(run.condition.damage).toEqual({});
    expect(run.condition.crew[0].hp).toBe(100);
    expect(run.navy).toBeCloseTo(navy + PORT_REST_DELAY);
    expect(run.rest()).toBe(false);
    run.leavePort();
    expect(run.status).toBe('chart');
  });
});

describe('auto runs', () => {
  for (const def of PLAYER_SHIPS) {
    it(`${def.id}: a whole voyage plays through to an ending`, () => {
      const { run, battles } = autoRun(new Run(def.id, 21), { focus: 'guns' });
      expect(run.over).toBe(true);
      expect(run.jumps).toBeGreaterThan(0);
      if (run.status === 'won') expect(run.node.kind).toBe('boss');
      expect(battles.length).toBeGreaterThan(0);
    });
  }

  it('is reproducible from a seed', () => {
    const a = autoRun(new Run('gull', 77)).run;
    const b = autoRun(new Run('gull', 77)).run;
    expect([a.status, a.gold, a.visited]).toEqual([b.status, b.gold, b.visited]);
  });

  it('sometimes buys fittings, so balance runs exercise them', () => {
    const bought = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) for (const f of autoRun(new Run('gull', seed), { focus: 'guns' }).run.fittings) bought.add(f);
    expect(bought.size).toBeGreaterThanOrEqual(2);
  });
});

describe('enemy names', () => {
  it('ships you meet sail under their own names, and you do not meet the same one twice early on', () => {
    const run = new Run('gull', 5);
    run.navy = -99;
    const names: string[] = [];
    for (let i = 0; i < 5; i++) {
      run.encounter = { kind: 'event', event: 'picket' };
      run.status = 'event';
      run.chooseEvent(0);
      const battle = run.startBattle();
      names.push(battle.enemy.def.name);
      run.status = 'chart';
    }
    expect(new Set(names).size).toBe(5);
    for (const n of names) expect(ENEMIES.cutter.names).toContain(n);
  });
});

describe('shipwright and armoury', () => {
  it('upgrades raise the fitted ship and cost gold', () => {
    const run = runAt('port');
    run.gold = 1000;
    const before = run.ship;
    expect(run.buyUpgrade('hull')).toBe(true);
    expect(run.buyUpgrade('hands')).toBe(true);
    expect(run.buyUpgrade('sails')).toBe(true);
    const after = run.ship;
    expect(after.hull).toBe(before.hull + PLATING);
    expect(run.condition.hull).toBe(before.hull + PLATING);
    expect(after.hands).toBe(before.hands + 1);
    expect(after.systems.sails).toBe(before.systems.sails! + 1);
    expect(run.gold).toBeLessThan(1000);
    expect(run.def.hull).toBe(before.hull);
  });

  it('upgrades stop at their caps and need gold and a port', () => {
    const run = runAt('port');
    run.gold = 100000;
    while (run.buyUpgrade('sails'));
    expect(run.fit.systems.sails).toBe(SYSTEM_CAP.sails);
    run.gold = 0;
    expect(run.buyUpgrade('hull')).toBe(false);
    run.gold = 1000;
    run.leavePort();
    expect(run.buyUpgrade('hull')).toBe(false);
  });

  it('sells guns from the port stock into free gun ports, and buys yours back at half price', () => {
    const run = runAt('port');
    run.gold = 1000;
    const stock = run.gunOffers();
    expect(stock.length).toBeGreaterThan(0);
    while (run.fit.guns.length < MAX_GUNS - 1) run.fit.guns.push({ weapon: 'pdr6' });
    expect(run.buyGun(stock[0].weapon.id)).toBe(true);
    expect(run.fit.guns).toHaveLength(MAX_GUNS);
    expect(run.gunOffers().every((o) => !o.available)).toBe(true);
    const gold = run.gold;
    const price = run.sellPrice(0);
    expect(run.sellGun(0)).toBe(true);
    expect(run.gold).toBe(gold + price);
    while (run.fit.guns.length > 1) run.sellGun(0);
    expect(run.sellGun(0)).toBe(false);
  });

  it('a battle uses the fitted ship', () => {
    const run = runAt('battle');
    run.fit.guns.push({ weapon: 'pdr18' });
    run.fit.hands += 2;
    const battle = run.startBattle();
    expect(battle.player.guns.map((g) => g.def.id)).toContain('pdr18');
    expect(battle.player.def.hands).toBe(run.def.hands + 2);
  });
});

describe('saving', () => {
  it('a restored voyage carries on exactly as the original would', () => {
    const a = new Run('wren', 31);
    a.jump(a.reachable()[0].id);
    if (a.status === 'event') a.chooseEvent(a.currentEvent().choices.findIndex((_, i) => a.canChoose(i)));
    const save = JSON.parse(JSON.stringify(a.toSave()));
    const b = Run.fromSave(save);
    expect(b.toSave()).toEqual(a.toSave());
    const rest = (r: Run) => autoRun(r).run.toSave();
    expect(rest(b)).toEqual(rest(a));
  });

  it('rejects an unknown save', () => {
    expect(() => Run.fromSave({ version: 9 } as never)).toThrow();
  });
});

describe('prizes', () => {
  const win = (kind: 'captured' | 'surrender' | 'victory') => {
    const run = runAt('battle');
    const battle = run.startBattle();
    if (kind === 'captured') for (const c of battle.enemy.crew) c.hp = 0;
    if (kind === 'captured') battle.step(0.05);
    else (battle as unknown as { finish(k: string): void }).finish(kind);
    run.finishBattle(battle);
    return run;
  };

  it('spoils are the guns she fought with, heavier in deeper sectors', () => {
    const run = runAt('battle');
    run.sector = 2;
    run.encounter = { kind: 'battle', enemy: 'cutter', name: 'HMS Test', boss: false, ambush: false, text: '' };
    const battle = run.startBattle();
    for (const c of battle.enemy.crew) c.hp = 0;
    battle.step(0.05);
    run.finishBattle(battle);
    expect(run.prize?.guns).toContain('pdr12');
    expect(new Set(run.prize!.guns)).toEqual(new Set(battle.enemy.def.guns.map((g) => g.weapon)));
  });

  it('a captured ship offers her guns; one pick only', () => {
    const run = win('captured');
    expect(run.prize?.guns.length).toBeGreaterThan(0);
    expect(run.prize?.recruits).toBe(0);
    const guns = run.fit.guns.length;
    expect(run.takePrizeGun(run.prize!.guns[0])).toBeTruthy();
    expect(run.fit.guns.length + run.gold).toBeGreaterThan(guns);
    expect(run.takePrizeGun(run.prize!.guns[0])).toBeNull();
  });

  it('a ship that struck her colours offers a survivor too', () => {
    const run = win('surrender');
    expect(run.prize?.recruits).toBe(1);
    const crew = run.condition.crew.length;
    run.condition.crew.pop();
    expect(run.pressPrizeCrew()).toBeTruthy();
    expect(run.condition.crew.length).toBe(crew);
  });

  it('a sunk ship offers nothing, and spoils expire when you sail on', () => {
    expect(win('victory').prize).toBeNull();
    const run = win('captured');
    run.jump(run.reachable()[0].id);
    expect(run.prize).toBeNull();
  });
});

describe('difficulty', () => {
  it('changes the fleet speed, starting gold and enemy hulls, and survives a save', () => {
    const easy = new Run('gull', 3, 'easy');
    const hard = new Run('gull', 3, 'hard');
    expect(easy.gold).toBeGreaterThan(hard.gold);
    expect(easy.navySpeed).toBeLessThan(hard.navySpeed);
    for (const run of [easy, hard]) {
      run.navy = 5;
      run.jump(run.reachable()[0].id);
    }
    const hulls = [easy, hard].map((r) => r.startBattle().enemy.hull);
    expect(hulls[0]).toBeLessThan(hulls[1]);
    expect(Run.fromSave(JSON.parse(JSON.stringify(hard.toSave()))).difficulty).toBe('hard');
  });

  it('defaults to normal', () => {
    expect(new Run('gull', 1).difficulty).toBe('normal');
  });
});

describe('sectors, provisions and the chandler', () => {
  /** Sail straight across a sector: always the first onward node, settling whatever turns up. */
  function crossSector(run: Run): void {
    const start = run.sector;
    for (let guard = 0; guard < 40 && run.sector === start && !run.over; guard++) {
      if (run.status === 'hail') run.hail('attack');
      else if (run.status === 'battle') {
        const b = run.startBattle({ autoPlayer: true });
        b.enemy.hull = 0;
        b.step(0.05);
        run.finishBattle(b);
      } else if (run.status === 'event') run.chooseEvent(run.currentEvent().choices.findIndex((_, j) => run.canChoose(j)));
      else if (run.status === 'port') run.leavePort();
      else {
        run.navy = -10;
        run.jump(run.reachable().find((n) => !run.isLateral(n))!.id);
      }
    }
  }

  it('a voyage has three sectors; only the last ends at the blockade', () => {
    const run = new Run('gull', 11);
    expect(run.sector).toBe(0);
    expect(run.chart.nodes.some((n) => n.kind === 'exit')).toBe(true);
    expect(run.chart.nodes.some((n) => n.kind === 'boss')).toBe(false);
    crossSector(run);
    expect(run.sector).toBe(1);
    expect(run.node.kind).toBe('start');
    expect(run.navy).toBeLessThan(0);
    crossSector(run);
    expect(run.sector).toBe(2);
    expect(run.chart.nodes.some((n) => n.kind === 'boss')).toBe(true);
    expect(run.chart.nodes.some((n) => n.kind === 'exit')).toBe(false);
  });

  it('a straight run shakes off the fleet in the passage; ground lost to detours follows you into the next sector', () => {
    const straight = calm(new Run('gull', 11));
    crossSector(straight);
    // crossSector holds the fleet far back: the passage forgives a straight run entirely.
    expect(straight.navy).toBe(NAVY_START);

    const dawdler = new Run('gull', 11);
    const enter = (dawdler as unknown as { enterSector(s: number): void }).enterSector.bind(dawdler);
    // At the passage (column 5) with the fleet 2.25 columns closer than a straight run would have let it come.
    dawdler.nodeId = dawdler.chart.nodes.find((n) => n.kind === 'exit')!.id;
    dawdler.navy = 5 - (-NAVY_START - 1.25 - 2.25);
    enter(1);
    expect(dawdler.navy).toBeCloseTo(NAVY_START + SECTOR_CARRY * 2.25);
    expect(dawdler.encounter).toMatchObject({ kind: 'empty' });
    expect((dawdler.encounter as { text: string }).text).toContain('hard on your heels');

    // A straight run on Normal (every jump onward, no rests, no foul winds) never meets an ambush in any sector.
    for (let seed = 1; seed <= 10; seed++) {
      const run = calm(new Run('maw', seed));
      for (let guard = 0; guard < 60 && !run.over && !(run.encounter.kind === 'battle' && run.encounter.boss); guard++) {
        if (run.status === 'hail') run.hail('attack');
        else if (run.status === 'battle') {
          expect(run.encounter.kind === 'battle' && run.encounter.ambush, `seed ${seed}`).toBe(false);
          const b = run.startBattle({ autoPlayer: true });
          b.enemy.hull = 0;
          b.step(0.05);
          run.finishBattle(b);
        } else if (run.status === 'event') {
          const ev = run.currentEvent();
          // Take the choice that costs no time, as a captain in a hurry would.
          const i = ev.choices.findIndex((c, j) => run.canChoose(j) && c.outcomes.every((o) => !o.effect.navy || o.effect.navy < 0));
          run.chooseEvent(i >= 0 ? i : ev.choices.findIndex((_, j) => run.canChoose(j)));
        } else if (run.status === 'port') run.leavePort();
        else run.jump(run.reachable().find((n) => !run.isLateral(n))!.id);
      }
    }
  });

  it('you can explore across a column to an unvisited neighbour', () => {
    for (let seed = 1; seed < 50; seed++) {
      const run = new Run('wren', seed);
      run.jump(run.reachable()[0].id);
      if (run.status !== 'chart') continue;
      const across = run.reachable().filter((n) => run.isLateral(n));
      if (!across.length) continue;
      const col = run.node.col;
      const food = run.provisions;
      run.jump(across[0].id);
      expect(run.node.col).toBe(col);
      expect(run.provisions).toBeLessThanOrEqual(food);
      return;
    }
    throw new Error('no chart with a sideways channel found');
  });

  it('every jump eats a provision; on empty stores the crew go hungry', () => {
    const run = calm(new Run('gull', 4));
    const food = run.provisions;
    run.navy = -10;
    run.jump(run.reachable()[0].id);
    expect(run.provisions).toBe(food - 1);

    const starving = calm(new Run('gull', 4));
    starving.provisions = 0;
    starving.navy = -10;
    const hp = starving.condition.crew.map((c) => c.hp);
    starving.jump(starving.reachable()[0].id);
    expect(starving.hungerNote).toContain('hungry');
    // A hungry crew does not mend: the full 25 comes off, even with a surgeon's chest aboard.
    starving.condition.crew.forEach((c, i) => expect(c.hp).toBe(Math.max(1, hp[i] - 25)));

    const chest = calm(new Run('gull', 4));
    chest.provisions = 0;
    chest.navy = -10;
    chest.fittings.push('chest');
    chest.condition.crew[0].hp = 60;
    chest.jump(chest.reachable()[0].id);
    expect(chest.condition.crew[0].hp).toBe(35);
  });

  it('deeper sectors field tougher ships', () => {
    const base = ENEMIES.cutter.ship;
    const scaled = scaleEnemy(base, 2);
    expect(scaled.hull).toBeGreaterThan(base.hull);
    expect(scaled.hands).toBeGreaterThan(base.hands);
    expect(scaled.systems.guns).toBeGreaterThan(base.systems.guns!);
    expect(scaled.guns.some((g) => g.weapon === 'pdr12')).toBe(true);
    expect(scaleEnemy(base, 0)).toBe(base);
  });

  it('the blockade frigate is better found than the frigate fresh from the yard', () => {
    const run = new Run('gull', 8);
    run.sector = 2;
    run.status = 'battle';
    run.encounter = { kind: 'battle', enemy: 'frigate', name: 'HMS Relentless', boss: true, ambush: false, text: '' };
    const b = run.startBattle();
    expect(b.enemy.def.hull).toBeGreaterThan(ENEMIES.frigate.ship.hull);
    expect(b.enemy.def.guns).toEqual(scaleEnemy(ENEMIES.frigate.ship, BOSS_TIER).guns);
    expect(b.enemy.def.guns.some((g) => g.weapon === 'pdr9')).toBe(false);
  });

  it('prices rise and finds grow richer deeper into the voyage', () => {
    const run = runAt('port');
    run.gold = 1000;
    const before = { up: run.upgradeOffers()[0].price, fit: run.fittingOffers()[0].price, gun: run.gunOffers()[0].price };
    run.sector = 2;
    expect(run.upgradeOffers()[0].price).toBeGreaterThan(before.up);
    expect(run.fittingOffers()[0].price).toBeGreaterThan(before.fit);
    expect(run.gunOffers()[0].price).toBeGreaterThan(before.gun);
    // Necessities stay at the same price.
    const gold = run.gold;
    run.buyProvisions(1);
    expect(run.gold).toBe(gold - run.provisionPrice);
    // And what you pay is what was offered.
    const offer = run.upgradeOffers().find((o) => o.available)!;
    const g = run.gold;
    run.buyUpgrade(offer.id);
    expect(run.gold).toBe(g - offer.price);

    const finds = run.applyEffect({ text: '', gold: 20 });
    expect(finds[0]).toMatch(/^\+2[1-9] gold$/);
  });

  it('later sectors stock heavier guns in their armouries', () => {
    const avg = (sector: number) => {
      let total = 0;
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const run = new Run('gull', seed);
        (run as unknown as { sector: number }).sector = sector;
        const chart = (run as unknown as { makeChart(s: number): SeaChart }).makeChart(sector);
        for (const node of chart.nodes) for (const id of node.stock ?? []) (total += WEAPONS[id].price), n++;
      }
      return total / n;
    };
    expect(avg(2)).toBeGreaterThan(avg(0) + 10);
  });

  it('a scaled enemy upgrades different guns one step each, and has a use for every extra hand', () => {
    const step: Record<string, string> = { pdr6: 'pdr9', pdr9: 'pdr12' };
    const hands = (guns: { weapon: string }[]) => guns.reduce((n, g) => n + WEAPONS[g.weapon].hands, 0);
    for (const e of Object.values(ENEMIES)) {
      for (const tier of [1, 2]) {
        const base = e.ship;
        const s = scaleEnemy(base, tier);
        const changed = s.guns.map((g, i) => [base.guns[i].weapon, g.weapon]).filter(([a, b]) => a !== b);
        for (const [from, to] of changed) expect(to, `${e.id} tier ${tier}`).toBe(step[from]);
        expect(changed.length).toBeLessThanOrEqual(tier);
        const sails = tier >= 2 ? 1 : 0;
        expect(s.systems.sails).toBe((base.systems.sails ?? 0) + sails);
        // Every new hand goes on a heavier gun or the extra sail.
        expect(s.hands - base.hands).toBe(hands(s.guns) - hands(base.guns) + sails);
        expect(s.systems.guns).toBeGreaterThanOrEqual(hands(s.guns));
      }
    }
  });

  it('the chandler sells provisions and fittings, and fittings change the ship', () => {
    const run = runAt('port');
    run.gold = 500;
    const food = run.provisions;
    expect(run.buyProvisions(3)).toBe(true);
    expect(run.provisions).toBe(food + 3);
    const offers = run.fittingOffers();
    expect(offers.length).toBeGreaterThanOrEqual(3);
    const id = offers[0].fitting.id;
    expect(run.buyFitting(id)).toBe(true);
    expect(run.has(id)).toBe(true);
    expect(run.fittingOffers().some((o) => o.fitting.id === id)).toBe(false);
    run.fittings.push('careened');
    expect(run.ship.speedBonus).toBe(run.def.speedBonus + 5);
    // A careened hull also lays alongside faster ships, and says so.
    const plain = new Ship(run.def, 'player');
    expect(grappleSpeed(new Ship(run.ship, 'player'))).toBe(grappleSpeed(plain) + 1);
    expect(FITTINGS.careened.blurb).toContain('grapple');
    run.fittings.push('casks');
    expect(run.maxProvisions).toBe(30);
  });

  it('sector, provisions and fittings survive a save; an old single-chart save is treated as the last sector', () => {
    const run = new Run('maw', 21);
    run.provisions = 7;
    run.fittings = ['drill'];
    const back = Run.fromSave(run.toSave());
    expect(back.sector).toBe(0);
    expect(back.provisions).toBe(7);
    expect(back.fittings).toEqual(['drill']);

    const old = run.toSave();
    delete old.sector;
    delete old.provisions;
    delete old.fittings;
    old.chart = generateChart(new Rng(3), { ports: ['A'], armoury: ['pdr6'] });
    const legacy = Run.fromSave(old);
    expect(legacy.sector).toBe(2);
    expect(legacy.provisions).toBeGreaterThan(0);
  });

  it('a save from before bulwarks gets her bulwark station back, so the refit is offered', () => {
    const run = new Run('gull', 21);
    const old = run.toSave();
    delete old.fit.systems.bulwarks;
    const back = Run.fromSave(old);
    expect(back.fit.systems.bulwarks).toBe(run.def.systems.bulwarks);
    back.status = 'port';
    back.encounter = { kind: 'port', name: 'Nassau', rested: false, stock: [] };
    expect(back.upgradeOffers().some((o) => o.id === 'bulwarks')).toBe(true);
  });
});

describe('auto runs that stall', () => {
  it('a fight that runs past the time limit is called a stalemate and ends the voyage', () => {
    const { run, battles } = autoRun(new Run('gull', 21), { battleLimit: 1 });
    expect(run.status).toBe('lost');
    expect(run.ending).toContain('stalemate');
    expect(battles).toHaveLength(0);
  });
});

describe('weighted picks', () => {
  it('never pick a weightless item, and fall back to the last when nothing has weight', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 200; i++) expect(rng.weighted(['a', 'b', 'c'], (x) => (x === 'b' ? 0 : 1))).not.toBe('b');
    expect(rng.weighted(['a', 'b'], () => 0)).toBe('b');
  });
});

describe('leads and fresh tales', () => {
  it('a story flag puts its follow-up on the chart ahead, and sailing there tells it', () => {
    const run = new Run('gull', 4);
    run.applyEffect({ text: '', flag: 'map-half' });
    const lead = run.chart.nodes.find((n) => n.story === 'cartographer');
    expect(lead).toBeTruthy();
    expect(lead!.col).toBeGreaterThan(run.node.col);
    expect(lead!.kind).toBe('event');
    // Sail straight for it.
    run.navy = -99;
    for (let guard = 0; guard < 20 && run.node.id !== lead!.id; guard++) {
      run.status = 'chart';
      const options = run.reachable();
      const path = options.find((n) => n.id === lead!.id) ?? options.find((n) => !run.isLateral(n) && reaches(run, n.id, lead!.id)) ?? options[0];
      run.jump(path.id);
    }
    expect(run.node.id).toBe(lead!.id);
    expect(run.encounter.kind === 'event' && run.encounter.event).toBe('cartographer');
  });

  it('a lead that needs more depth than this chart reaches waits for a later sector', () => {
    const run = new Run('gull', 4);
    run.applyEffect({ text: '', flag: 'marque' });
    // The French frigate needs the voyage half done: not in the first sector's opening columns.
    for (const n of run.chart.nodes.filter((x) => x.story === 'marque-frigate')) expect(n.col).toBeGreaterThan(0);
  });

  it('events from recent voyages come round less often', () => {
    const counts = (recent: string[]) => {
      let hits = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const run = new Run('gull', seed);
        run.recent = recent;
        if (run.drawEvent('incident')?.id === 'storm') hits++;
      }
      return hits;
    };
    expect(counts(['storm'])).toBeLessThan(counts([]));
  });
});

/** Whether `to` can be reached from `from` by sailing onward. */
function reaches(run: Run, from: number, to: number): boolean {
  if (from === to) return true;
  const node = run.chart.nodes.find((n) => n.id === from)!;
  return node.next.some((id) => reaches(run, id, to));
}

describe('fittings that change the fight, and ports known for something', () => {
  it('each new fitting does what its blurb says', () => {
    const run = new Run('gull', 2);
    const base = run.ship;
    run.fittings.push('copper', 'marines', 'lockers', 'pumps', 'flags');
    expect(run.ship.speedBonus).toBe(base.speedBonus + 5);
    expect(run.ship.melee).toBeCloseTo((base.melee ?? 1) * 1.25);
    run.encounter = { kind: 'battle', enemy: 'cutter', name: 'HMS X', boss: false, ambush: false, text: '' };
    run.status = 'battle';
    const b = run.startBattle();
    expect(b.player.shotRate.chain).toBe(1.3);
    expect(b.player.pumpRate).toBe(1.5);
    expect(run.coloursChance()).toBe(0.7);
  });

  it('a figurehead makes ships strike and pay sooner', () => {
    const plain = new Run('gull', 2);
    plain.encounter = { kind: 'battle', enemy: 'merchant', name: 'X', boss: false, ambush: false, text: '', intent: 'wary' };
    plain.status = 'hail';
    const fierce = new Run('gull', 2);
    fierce.encounter = { ...plain.encounter };
    fierce.status = 'hail';
    fierce.fittings.push('figurehead');
    expect(fierce.tributeChance()).toBeGreaterThan(plain.tributeChance());
    fierce.status = 'battle';
    expect(fierce.battleSetup().options.enemyAI!.surrenderChance).toBeGreaterThan(enemyAI('merchant').surrenderChance);
  });

  it('ports have specialities', () => {
    const at = (name: string) => {
      const run = new Run('gull', 2);
      run.gold = 999;
      // Even standing everywhere, so only the speciality moves the price.
      for (const p of Object.keys(run.standing) as (keyof Run['standing'])[]) run.standing[p] = 0;
      (run as unknown as { enterPort(n: string, s: string[]): void }).enterPort(name, ['pdr6']);
      return run;
    };
    expect(at('Nassau').crewPrice).toBeLessThan(CREW_PRICE);
    expect(at('Bridgetown').provisionPrice).toBeLessThan(PROVISION_PRICE);
    expect(at('Bridgetown').fittingOffers().length).toBe(4);
    const willem = at('Willemstad');
    expect(willem.sellPrice(0)).toBe(Math.floor(weapon(willem.fit.guns[0].weapon).price * 0.75));
    const dockyard = at('Port Royal').upgradeOffers().find((o) => o.id === 'sails')!.price;
    expect(dockyard).toBeLessThan(at('Nassau').upgradeOffers().find((o) => o.id === 'sails')!.price);
    const havana = at('Havana');
    expect(havana.encounter.kind === 'port' && havana.encounter.stock.some((id) => id === 'pdr18' || id === 'carronade')).toBe(true);
  });
});

function enemyAI(id: string) {
  return ENEMIES[id].ai;
}

describe('the hiring hall', () => {
  it('offers three sailors with different backgrounds, each at their own price', () => {
    const run = runAt('port');
    run.gold = 500;
    run.condition.crew.pop();
    const hands = run.encounter.kind === 'port' ? run.encounter.hands! : [];
    expect(hands).toHaveLength(3);
    expect(new Set(hands.map((c) => c.trait)).size).toBe(3);
    const pick = hands.findIndex((c) => c.trait !== 'landsman');
    const chosen = hands[pick];
    const price = run.handPrice(chosen);
    const gold = run.gold;
    expect(run.hireCrew(pick)).toBe(chosen.name);
    expect(run.gold).toBe(gold - price);
    const aboard = run.condition.crew.find((c) => c.name === chosen.name)!;
    expect(aboard.trait).toBe(chosen.trait);
    expect(run.hasTrait(chosen.trait)).toBe(true);
    // They are gone from the hall once signed.
    expect(run.encounter.kind === 'port' && run.encounter.hands!.some((c) => c.name === chosen.name)).toBe(false);
  });

  it('a skilled hand comes aboard with the skill, and keeps background and skill through a battle', () => {
    const run = new Run('gull', 3);
    run.applyEffect({ text: '', recruit: 0 });
    run.condition.crew.pop();
    (run as unknown as { recruit(n: string, t: string): string }).recruit('Bess Gunn', 'gunner');
    run.encounter = { kind: 'battle', enemy: 'cutter', name: 'HMS X', boss: false, ambush: false, text: '' };
    run.status = 'battle';
    const b = run.startBattle();
    b.enemy.hull = 0;
    b.step(0.05);
    run.finishBattle(b);
    const bess = run.condition.crew.find((c) => c.name === 'Bess Gunn')!;
    expect(bess.trait).toBe('gunner');
    expect(bess.xp?.gunnery).toBeGreaterThanOrEqual(50);
  });

  it('a barber-surgeon heals the crew more each jump, and events can ask for a background', () => {
    const run = new Run('gull', 3);
    expect(run.unmet({ trait: 'navigator' })).toMatch(/navigator/);
    run.condition.crew[0].trait = 'navigator';
    expect(run.unmet({ trait: 'navigator' })).toBeNull();
    const plain = new Run('gull', 3);
    const doc = new Run('gull', 3);
    doc.condition.crew[0].trait = 'surgeon';
    for (const r of [plain, doc]) {
      for (const c of r.condition.crew) c.hp = 40;
      r.navy = -99;
      r.jump(r.reachable()[0].id);
    }
    expect(doc.condition.crew[1].hp).toBeGreaterThan(plain.condition.crew[1].hp);
  });
});

describe('a fork in the route', () => {
  it('the first stage ends at two passages, and the one you take decides the next sector', () => {
    const run = new Run('gull', 8);
    const exits = run.chart.nodes.filter((n) => n.kind === 'exit');
    expect(exits.map((n) => n.to).sort()).toEqual(['coast', 'main']);
    // Sail for the Brethren's Coast.
    run.navy = -99;
    const coast = exits.find((n) => n.to === 'coast')!;
    for (let guard = 0; guard < 30 && run.sector === 0; guard++) {
      if (run.status !== 'chart') run.status = 'chart';
      const options = run.reachable().filter((n) => !run.isLateral(n));
      const pick = options.find((n) => n.id === coast.id) ?? options.find((n) => reaches(run, n.id, coast.id)) ?? options[0];
      run.jump(pick.id);
    }
    expect(run.sector).toBe(1);
    expect(run.sectorId).toBe('coast');
    expect(run.sectorDef.name).toMatch(/Brethren/);
    const enemies = new Set(run.chart.nodes.filter((n) => n.enemy).map((n) => n.enemy));
    for (const e of enemies) expect(['rival', 'smuggler', 'merchant', 'corsair', 'privateer', 'cutter']).toContain(e);
    expect(Run.fromSave(JSON.parse(JSON.stringify(run.toSave()))).sectorId).toBe('coast');
    // The last stage has no fork: one passage leads on to the blockade's waters.
    expect(run.chart.nodes.filter((n) => n.kind === 'exit').map((n) => n.to)).toEqual(['kings']);
  });
});

/** Hold the wind abeam, for tests about what a plain jump costs. */
function calm(run: Run): Run {
  run.pointOfSail = () => 'beam';
  return run;
}

describe('the wind', () => {
  it('a leg into the wind is foul, one before it is fair, across it is beam', () => {
    const run = new Run('gull', 1);
    const from = { id: 0, col: 1, y: 0.5, kind: 'empty' as const, next: [] };
    const east = { ...from, id: 1, col: 2 };
    run.wind = 0; // from the east
    expect(run.pointOfSail(from, east)).toBe('foul');
    run.wind = Math.PI; // from the west
    expect(run.pointOfSail(from, east)).toBe('fair');
    run.wind = -Math.PI / 2; // from the north
    expect(run.pointOfSail(from, east)).toBe('beam');
    expect(run.windName).toBe('from the north');
  });

  it('a foul leg costs an extra day and lets the fleet close; a fair one gains on it', () => {
    const go = (sail: 'foul' | 'fair' | 'beam') => {
      const run = new Run('gull', 4);
      run.navy = -10;
      run.pointOfSail = () => sail;
      const food = run.provisions;
      const navy = run.navy;
      run.jump(run.reachable()[0].id);
      return { food: food - run.provisions, fleet: run.navy - navy, note: run.hungerNote };
    };
    const beam = go('beam');
    const foul = go('foul');
    const fair = go('fair');
    expect(foul.food).toBe(beam.food + 1);
    expect(foul.fleet).toBeGreaterThan(beam.fleet);
    expect(foul.note).toMatch(/foul wind/);
    expect(fair.fleet).toBeLessThan(beam.fleet);
  });

  it('shifts as you sail, and is kept in a save', () => {
    const run = new Run('gull', 4);
    const before = run.wind;
    run.navy = -10;
    run.jump(run.reachable()[0].id);
    expect(run.wind).not.toBe(before);
    expect(Run.fromSave(JSON.parse(JSON.stringify(run.toSave()))).wind).toBe(run.wind);
  });
});

describe('prize ships', () => {
  /** Win a fight by her striking her colours, with her ship on offer. */
  const struck = (seed = 6) => {
    const run = new Run('gull', seed);
    run.encounter = { kind: 'battle', enemy: 'merchant', name: 'The Good Intent', boss: false, ambush: false, text: '' };
    run.status = 'battle';
    const b = run.startBattle();
    (b as unknown as { finish(k: string): void }).finish('surrender');
    run.finishBattle(b);
    return run;
  };

  it('a ship that strikes can sail in company, with one of your hands as prize master', () => {
    const run = struck();
    expect(run.prize?.ship?.name).toBe('The Good Intent');
    const crew = run.condition.crew.length;
    expect(run.takePrizeShip()).toMatch(/prize master/);
    expect(run.consort?.name).toBe('The Good Intent');
    expect(run.condition.crew.length).toBe(crew - 1);
    // The captain stays aboard his own ship.
    expect(run.consort?.crew?.name).not.toBe(run.def.crew[0].name);
    expect(run.takePrizeShip()).toBeNull();
  });

  it('she fights beside you, and the enemy may sink her', () => {
    const run = struck();
    run.takePrizeShip();
    run.encounter = { kind: 'battle', enemy: 'cutter', name: 'HMS X', boss: false, ambush: false, text: '' };
    run.status = 'battle';
    const b = run.startBattle();
    const prize = b.consorts.find((c) => c.name === 'The Good Intent')!;
    expect(prize.hull).toBeGreaterThan(0);
    let fired = 0;
    let hit = false;
    for (let t = 0; t < 60 && !b.outcome; t += 0.05) {
      b.step(0.05);
      for (const e of b.drainEvents()) {
        if (e.t === 'consort' && e.name === 'The Good Intent') fired++;
        if (e.t === 'consortHit') hit = true;
      }
    }
    expect(fired).toBeGreaterThan(0);
    expect(hit).toBe(true);
    // Whatever the fight did to her goes with her.
    prize.hull = 0;
    (b as unknown as { finish(k: string): void }).finish('victory');
    const report = run.finishBattle(b);
    expect(run.consort).toBeNull();
    expect(report.lines.some((l) => l.includes('sunk under you'))).toBe(true);
  });

  it('a prize court buys her, and her prize crew comes home', () => {
    const run = struck();
    run.takePrizeShip();
    const crew = run.condition.crew.length;
    run.encounter = { kind: 'port', name: 'Bridgetown', rested: false, stock: [] };
    run.status = 'port';
    const gold = run.gold;
    const price = run.consortValue();
    expect(price).toBeGreaterThan(0);
    expect(run.sellConsort()).toBe(price);
    expect(run.gold).toBe(gold + price);
    expect(run.consort).toBeNull();
    expect(run.condition.crew.length).toBe(crew + 1);
  });

  it('a skeleton crew cannot spare a prize crew, and the consort survives a save', () => {
    const thin = struck();
    thin.condition.crew = thin.condition.crew.slice(0, 2);
    expect(thin.prizeShipBlocker()).toMatch(/crew/);
    const run = struck();
    run.takePrizeShip();
    expect(Run.fromSave(JSON.parse(JSON.stringify(run.toSave()))).consort).toEqual(run.consort);
  });
});

describe('captains', () => {
  it('each brings a gift: the gunner loads faster, the navigator slows the fleet, the gentleman is liked, the privateer has a letter of marque', () => {
    const plain = new Run('gull', 3);
    const gunner = new Run('gull', 3, 'normal', 'gunner');
    for (const r of [plain, gunner]) {
      r.encounter = { kind: 'battle', enemy: 'cutter', name: 'X', boss: false, ambush: false, text: '' };
      r.status = 'battle';
    }
    expect(gunner.startBattle().player.reloadRate).toBeGreaterThan(plain.startBattle().player.reloadRate);
    expect(new Run('gull', 3, 'normal', 'navigator').navySpeed).toBeLessThan(plain.navySpeed);
    expect(new Run('gull', 3, 'normal', 'gentleman').standing.crown).toBe(plain.standing.crown + 10);
    const priv = new Run('gull', 3, 'normal', 'privateer');
    expect(priv.flags.has('marque')).toBe(true);
    expect(priv.gold).toBe(plain.gold + 40);
    expect(new Run('gull', 3, 'normal', 'smuggler').provisions).toBe(plain.provisions + 6);
  });

  it('the captain is kept in a save, and a navigator does not lose a day to a foul wind', () => {
    const run = new Run('gull', 3, 'normal', 'navigator');
    const back = Run.fromSave(JSON.parse(JSON.stringify(run.toSave())));
    expect(back.captain.id).toBe('navigator');
    expect(back.gold).toBe(run.gold);
    run.pointOfSail = () => 'foul';
    run.navy = -10;
    const food = run.provisions;
    run.jump(run.reachable()[0].id);
    expect(food - run.provisions).toBe(1);
  });
});
