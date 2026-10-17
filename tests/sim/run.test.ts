import { describe, expect, it } from 'vitest';
import { PLAYER_SHIPS } from '../../src/data/ships';
import { ENEMIES } from '../../src/data/enemies';
import { autoRun } from '../../src/sim/autoRun';
import { Rng } from '../../src/sim/rng';
import { CREW_PRICE, HULL_PRICE, MAX_GUNS, START_GOLD, NAVY_SPEED, PLATING, PORT_REST_DELAY, Run, scaleEnemy, SYSTEM_CAP } from '../../src/sim/Run';
import { WEAPONS } from '../../src/data/weapons';
import { CHART_COLUMNS, generateChart, type SeaChart } from '../../src/sim/SeaChart';

function chart(seed: number): SeaChart {
  return generateChart(new Rng(seed), { ports: ['A', 'B', 'C'], armoury: ['pdr6', 'pdr9'] });
}

/** A run parked at a node of the given kind, ready for its encounter. */
function runAt(kind: 'port' | 'event' | 'battle', seed = 1): Run {
  for (let s = seed; s < seed + 200; s++) {
    const run = new Run('gull', s);
    const target = run.reachable().find((n) => n.kind === kind && !run.willBeOverrun(n));
    if (target) {
      run.jump(target.id);
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
    const run = new Run('gull', 3);
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
    run.gold = HULL_PRICE * 2 + CREW_PRICE;
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
      if (run.status === 'battle') {
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
    const run = new Run('gull', 4);
    const food = run.provisions;
    run.navy = -10;
    run.jump(run.reachable()[0].id);
    expect(run.provisions).toBe(food - 1);

    const starving = new Run('gull', 4);
    starving.provisions = 0;
    starving.navy = -10;
    const hp = starving.condition.crew.map((c) => c.hp);
    starving.jump(starving.reachable()[0].id);
    expect(starving.hungerNote).toContain('hungry');
    // A hungry crew does not mend: the full 25 comes off, even with a surgeon's chest aboard.
    starving.condition.crew.forEach((c, i) => expect(c.hp).toBe(Math.max(1, hp[i] - 25)));

    const chest = new Run('gull', 4);
    chest.provisions = 0;
    chest.navy = -10;
    chest.fittings.push('chest');
    chest.condition.crew[0].hp = 60;
    chest.jump(chest.reachable()[0].id);
    expect(chest.condition.crew[0].hp).toBe(35);
  });

  it('deeper sectors field tougher ships; the blockade does not grow', () => {
    const base = ENEMIES.cutter.ship;
    const scaled = scaleEnemy(base, 2);
    expect(scaled.hull).toBeGreaterThan(base.hull);
    expect(scaled.hands).toBeGreaterThan(base.hands);
    expect(scaled.systems.guns).toBeGreaterThan(base.systems.guns!);
    expect(scaled.guns.some((g) => g.weapon === 'pdr12')).toBe(true);
    expect(scaleEnemy(base, 0)).toBe(base);
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
        expect(s.systems.bulwarks).toBe((base.systems.bulwarks ?? 0) + 1);
        // Every new hand goes on a heavier gun or the extra bulwark layer.
        expect(s.hands - base.hands).toBe(hands(s.guns) - hands(base.guns) + 1);
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
    expect(offers).toHaveLength(2);
    const id = offers[0].fitting.id;
    expect(run.buyFitting(id)).toBe(true);
    expect(run.has(id)).toBe(true);
    expect(run.fittingOffers().some((o) => o.fitting.id === id)).toBe(false);
    run.fittings.push('careened');
    expect(run.ship.speedBonus).toBe(run.def.speedBonus + 5);
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
