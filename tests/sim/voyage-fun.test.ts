import { describe, expect, it } from 'vitest';
import { NEMESIS } from '../../src/data/nemesis';
import { autoRun } from '../../src/sim/autoRun';
import type { Outcome } from '../../src/sim/Battle';
import { applyVoyage, voyageAllowed, voyageCheck, type VoyageCommand } from '../../src/sim/commands';
import { Rng } from '../../src/sim/rng';
import { DICE_HANDS, DICE_TARGET, diceTotal, REEF_AGROUND, Run } from '../../src/sim/Run';
import { generateChart, type SeaNode } from '../../src/sim/SeaChart';

/** Put the run on a node in the column before `target`, with a way on to it, and the fleet far astern. */
function parkBefore(run: Run, target: SeaNode): void {
  const from = run.chart.nodes.find((n) => n.next.includes(target.id))!;
  run.nodeId = from.id;
  run.visited.push(from.id);
  run.navy = -10;
  run.status = 'chart';
}

/** A run tied up in port, rich enough to gamble and talk. */
function inPort(seed = 1): Run {
  const run = new Run('gull', seed);
  const port = run.chart.nodes.find((n) => n.kind === 'port')!;
  parkBefore(run, port);
  run.jump(port.id);
  run.gold = 500;
  expect(run.status).toBe('port');
  return run;
}

/** Finish the current battle the way given, without fighting it. */
function settle(run: Run, kind: Outcome['kind'], won: boolean) {
  const battle = run.startBattle();
  battle.outcome = { kind, won, title: '', text: '', time: 1 };
  return run.finishBattle(battle);
}

/** Sail to the Black Dog and run out the guns. */
function meetCrane(run: Run): void {
  const lair = run.chart.nodes.find((n) => n.nemesis)!;
  parkBefore(run, lair);
  run.jump(lair.id);
  expect(run.status).toBe('hail');
  expect(run.encounter.kind === 'battle' && run.encounter.nemesis).toBe(true);
}

describe('reef shortcuts', () => {
  it('skip exactly one column, never into the last, and some charts have them', () => {
    let reefs = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const c = generateChart(new Rng(seed), { columns: 6, ports: ['A', 'B'], final: false, exits: [{ name: 'X', to: 'x' }] });
      for (const n of c.nodes) {
        for (const id of n.reef ?? []) {
          reefs++;
          expect(c.nodes[id].col).toBe(n.col + 2);
          expect(c.nodes[id].col).toBeLessThan(c.columns - 1);
        }
      }
    }
    expect(reefs).toBeGreaterThan(20);
  });

  it('take you two columns in one jump, at some risk to the hull', () => {
    let scraped = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const run = new Run('gull', seed);
      const from = run.chart.nodes.find((n) => n.reef?.length);
      if (!from) continue;
      run.nodeId = from.id;
      run.visited.push(from.id);
      run.navy = -10;
      const target = run.reachable().find((n) => run.isReef(n))!;
      expect(target.col).toBe(from.col + 2);
      const hull = run.condition.hull;
      run.jump(target.id);
      expect(run.node.col).toBe(from.col + 2);
      expect(run.condition.hull).toBeGreaterThanOrEqual(Math.max(1, hull - REEF_AGROUND));
      if (run.condition.hull < hull) scraped++;
    }
    expect(scraped).toBeGreaterThan(0);
  });

  it('a navigator or a seasoned helmsman improves the odds', () => {
    const run = new Run('gull', 1);
    for (const c of run.condition.crew) c.xp = {};
    const base = run.reefOdds();
    run.condition.crew[1].trait = 'navigator';
    expect(run.reefOdds()).toBeGreaterThan(base);
  });
});

describe('Silas Crane', () => {
  it('waits on the first chart, mid-way, as a battle mark', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const run = new Run('gull', seed);
      const lair = run.chart.nodes.filter((n) => n.nemesis);
      expect(lair).toHaveLength(1);
      expect(lair[0].kind).toBe('battle');
      expect(lair[0].col).toBeGreaterThanOrEqual(2);
      expect(lair[0].col).toBeLessThan(run.chart.columns - 1);
    }
  });

  it('can be bought off, and comes back tougher in the next sector', () => {
    const run = new Run('gull', 2);
    run.gold = 200;
    meetCrane(run);
    expect(run.hailOptions().map((o) => o.id)).toEqual(['attack', 'bribe']);
    const bounty = run.nemesisBounty();
    run.hail('bribe');
    expect(run.status).toBe('chart');
    expect(run.nemesis).toMatchObject({ grudge: 1, last: 'paid', met: 1 });
    expect(run.chart.nodes.some((n) => n.nemesis)).toBe(false);
    // Into the next sector: he is waiting again.
    const exit = run.chart.nodes.find((n) => n.kind === 'exit')!;
    parkBefore(run, exit);
    run.jump(exit.id);
    expect(run.chart.nodes.filter((n) => n.nemesis)).toHaveLength(1);
    expect(run.nemesisBounty()).toBeGreaterThan(bounty);
  });

  it('gets away to fight another day, harder to sink each time', () => {
    const run = new Run('gull', 3);
    meetCrane(run);
    run.hail('attack');
    const hull = run.battleSetup().enemy.hull;
    expect(run.battleSetup().enemy.crew[0].name).toBe(`Captain ${NEMESIS.captain}`);
    expect(run.battleSetup().options.enemyAI?.fleeAt).toBe(NEMESIS.fleeAt);
    const report = settle(run, 'enemyEscaped', false);
    expect(report.lines.join(' ')).toMatch(/isn’t over/);
    expect(run.nemesis.grudge).toBe(1);
    expect(run.flags.has('crane-fled')).toBe(true);
    // Meet him again on the same footing: more timber.
    run.chart.nodes.find((n) => n.kind === 'battle' && !n.nemesis)!.nemesis = true;
    meetCrane(run);
    expect(run.encounter.kind === 'battle' && run.encounter.text).toMatch(/finished it/);
    run.hail('attack');
    expect(run.battleSetup().enemy.hull).toBeGreaterThan(hull);
  });

  it('beaten, pays his bounty and troubles you no more', () => {
    const run = new Run('gull', 4);
    meetCrane(run);
    run.hail('attack');
    const gold = run.gold;
    const bounty = run.nemesisBounty();
    const report = settle(run, 'victory', true);
    expect(run.gold).toBeGreaterThanOrEqual(gold + bounty);
    expect(report.lines.join(' ')).toMatch(/price on his head/);
    expect(run.nemesis.done).toBe(true);
    expect(run.flags.has('crane-dead')).toBe(true);
    const exit = run.chart.nodes.find((n) => n.kind === 'exit')!;
    parkBefore(run, exit);
    run.jump(exit.id);
    expect(run.chart.nodes.some((n) => n.nemesis)).toBe(false);
  });

  it('in the last sector he neither runs nor strikes', () => {
    const run = new Run('gull', 5);
    run.sector = 2;
    meetCrane(run);
    run.hail('attack');
    const ai = run.battleSetup().options.enemyAI!;
    expect(ai.fleeAt).toBe(0);
    expect(ai.surrenderChance).toBe(0);
  });

  it('survives a save', () => {
    const run = new Run('gull', 6);
    run.nemesis.grudge = 2;
    run.nemesis.last = 'fled';
    const back = Run.fromSave(JSON.parse(JSON.stringify(run.toSave())));
    expect(back.nemesis).toEqual(run.nemesis);
    expect(back.chart.nodes.some((n) => n.nemesis)).toBe(true);
    // A save from before Crane starts him fresh.
    const old = { ...run.toSave(), nemesis: undefined };
    expect(Run.fromSave(old).nemesis).toMatchObject({ grudge: 0, done: false });
  });
});

describe('tavern rumours', () => {
  it('name the sails ahead and the tales waiting in unknown waters, once a visit', () => {
    const run = inPort(1);
    const gold = run.gold;
    const lines = run.buyRumour();
    expect(lines.length).toBeGreaterThan(1);
    expect(run.gold).toBe(gold - run.rumourPrice());
    const ahead = run.chart.nodes.filter((n) => n.col > run.node.col && n.col <= run.node.col + 3);
    for (const n of ahead) {
      if (n.kind === 'battle' && !n.nemesis) expect(n.scouted, `node ${n.id}`).toBe(true);
      if (n.kind === 'event' && !n.story) expect(n.rumour, `node ${n.id}`).toBeTruthy();
    }
    expect(run.canBuyRumour()).toBe(false);
    expect(run.buyRumour()).toEqual([]);
  });

  it('what the tavern told you is what you find', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const run = inPort(seed);
      run.buyRumour();
      run.leavePort();
      const told = run.reachable().find((n) => n.rumour && !n.story && !run.isLateral(n));
      if (!told) continue;
      run.navy = -10;
      run.jump(told.id);
      expect(run.encounter.kind === 'event' && run.encounter.event).toBe(told.rumour);
      return;
    }
    throw new Error('no rumoured mark within reach');
  });
});

describe('Bones', () => {
  it('a hand: stake, roll on or stand, and the purse settles', () => {
    let seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const run = inPort(seed);
      const gold = run.gold;
      expect(run.dice('stake', 25)).toBeTruthy();
      expect(run.gold).toBe(gold - 25);
      expect(run.canDice('stake', 10)).toBe(false);
      while (run.canDice('roll') && diceTotal(run.diceTable!.hand!.you) < 13) run.dice('roll');
      run.dice('stand');
      const hand = run.diceTable!.hand!;
      expect(hand.result).toBeTruthy();
      seen.add(hand.result!);
      const you = diceTotal(hand.you);
      const his = diceTotal(hand.rival);
      const back = { win: 50, perfect: 75, push: 25, lose: 0, bust: 0 }[hand.result!];
      expect(run.gold, `${hand.result} ${you} v ${his}`).toBe(gold - 25 + back);
      if (hand.result === 'bust') expect(you).toBeGreaterThan(DICE_TARGET);
      if (hand.result === 'win') expect(his).toBeGreaterThan(DICE_TARGET);
      if (hand.result === 'lose') expect(his).toBeGreaterThan(you);
    }
    expect(seen.has('win') && seen.has('lose')).toBe(true);
  });

  it('closes after a few hands, and needs the stake in your purse', () => {
    const run = inPort(2);
    for (let i = 0; i < DICE_HANDS; i++) {
      run.dice('stake', 10);
      if (run.canDice('stand')) run.dice('stand');
    }
    expect(run.canDice('stake', 10)).toBe(false);
    const poor = inPort(3);
    poor.gold = 5;
    expect(poor.canDice('stake', 10)).toBe(false);
    expect(poor.canDice('stake', 7)).toBe(false);
  });

  it('a perfect fifteen against a broke captain wins half a map', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const run = inPort(seed);
      run.dice('stake', 10);
      while (run.canDice('roll') && diceTotal(run.diceTable!.hand!.you) < DICE_TARGET) run.dice('roll');
      if (run.canDice('stand')) run.dice('stand');
      if (run.diceTable!.hand!.result === 'perfect') {
        expect(run.flags.has('map-half')).toBe(true);
        return;
      }
    }
    throw new Error('never rolled a perfect fifteen');
  });

  it('can be left mid-hand and picked up from a save', () => {
    const run = inPort(4);
    run.dice('stake', 10);
    const back = Run.fromSave(JSON.parse(JSON.stringify(run.toSave())));
    expect(back.canDice('stand')).toBe(true);
    expect(back.dice('stand')).toBe(run.dice('stand'));
    expect(back.gold).toBe(run.gold);
  });
});

describe('co-op tavern', () => {
  it('rumours and dice replay the same on every copy of the voyage', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const server = inPort(seed);
      const client = Run.fromSave(JSON.parse(JSON.stringify(server.toSave())));
      const cmds: VoyageCommand[] = [{ t: 'rumour' }, { t: 'dice', act: 'stake', stake: 25 }, { t: 'dice', act: 'roll' }, { t: 'dice', act: 'stand' }, { t: 'dice', act: 'stake', stake: 10 }, { t: 'dice', act: 'stand' }];
      for (const cmd of cmds) {
        if (!voyageAllowed(server, cmd)) continue;
        const a = applyVoyage(server, cmd);
        const b = applyVoyage(client, JSON.parse(JSON.stringify(cmd)));
        expect(b).toEqual(a);
        expect(voyageCheck(client)).toBe(voyageCheck(server));
      }
      expect(client.toSave()).toEqual(server.toSave());
      expect(voyageAllowed(server, { t: 'rumour' })).toBe(false);
    }
  });
});

describe('auto runs', () => {
  it('play the tavern, the shoals and Crane without breaking a voyage', () => {
    let met = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { run } = autoRun(new Run('maw', seed), { focus: 'guns' });
      expect(run.over).toBe(true);
      met += run.nemesis.met;
    }
    expect(met).toBeGreaterThan(0);
  });
});
