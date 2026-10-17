import { describe, expect, it } from 'vitest';
import { enemy } from '../../src/data/enemies';
import { PLAYER_SHIPS, playerShip } from '../../src/data/ships';
import { Battle } from '../../src/sim/Battle';
import { autoStep, MAX_DECISIONS, type AutoRunOptions, type AutoRunResult } from '../../src/sim/autoRun';
import { DIFFICULTY, Run, type Difficulty } from '../../src/sim/Run';
import { badNumber, battleProblems, runProblems } from './invariants';

/**
 * Whole voyages played headless across every ship, difficulty and style of captain, checking the invariants
 * after every decision and every battle step. `npm run test:fuzz` (or FUZZ_SEEDS=n) plays many more seeds.
 */
const env = import.meta.env as Record<string, string | undefined>;
const SEEDS = Number(env.FUZZ_SEEDS ?? (env.npm_lifecycle_event === 'test:fuzz' ? 12 : 1));

const CAPTAINS: [string, AutoRunOptions][] = [
  ['spread fire', {}],
  ['guns focus', { focus: 'guns' }],
  ['boarder', { boardWith: 2, focus: 'helm' }],
];

/** Play a voyage decision by decision, collecting the first broken invariant it meets. */
function fuzzVoyage(shipId: string, seed: number, difficulty: Difficulty, captain: AutoRunOptions) {
  const run = new Run(shipId, seed, difficulty);
  const battles: AutoRunResult['battles'] = [];
  const problems: string[] = [];
  let decisions = 0;
  let ticks = 0;
  const onTick = (b: Battle) => {
    ticks++;
    if (problems.length) return;
    const found = battleProblems(b);
    // Deep scans are slower: every second of battle time is plenty to catch a NaN before it spreads.
    if (ticks % 20 === 0) {
      const bad = badNumber({ player: b.player, enemy: b.enemy, transit: b.transit, projectiles: b.projectiles });
      if (bad) found.push(`bad number at ${bad}`);
    }
    if (found.length) problems.push(`decision ${decisions}, battle t=${b.time.toFixed(2)}: ${found.join('; ')}`);
  };
  for (; decisions < MAX_DECISIONS && !run.over && !problems.length; decisions++) {
    autoStep(run, { ...captain, onTick }, battles);
    const found = runProblems(run);
    if (found.length) problems.push(`after decision ${decisions} (${run.status}): ${found.join('; ')}`);
  }
  return { run, battles, problems, decisions, ticks };
}

describe('fuzzed voyages', () => {
  for (const ship of PLAYER_SHIPS) {
    for (const difficulty of Object.keys(DIFFICULTY) as Difficulty[]) {
      it(`${ship.id} on ${difficulty}: every voyage ends and nothing ever goes out of bounds`, () => {
        for (let s = 0; s < SEEDS; s++) {
          // Rotate captains across seeds so each combination still meets all three over a fuzz run.
          const [style, captain] = CAPTAINS[(s + ship.id.length + difficulty.length) % CAPTAINS.length];
          const seed = 1000 + s * 7919 + ship.id.charCodeAt(0);
          const { run, battles, problems, decisions, ticks } = fuzzVoyage(ship.id, seed, difficulty, captain);
          const label = `${ship.id} seed ${seed} ${difficulty} (${style})`;
          expect(problems, label).toEqual([]);
          expect(run.over, `${label} still sailing after ${decisions} decisions`).toBe(true);
          expect(run.ending, label).not.toBe('');
          // Every voyage meets at least one fight, and the checks really did watch it.
          expect(battles.length, label).toBeGreaterThan(0);
          expect(ticks, label).toBeGreaterThan(battles.length * 20);
        }
      });
    }
  }
});

describe('the invariant checks', () => {
  it('catch a broken voyage, so a quiet fuzz run means something', () => {
    const run = new Run('gull', 5);
    expect(runProblems(run)).toEqual([]);
    run.gold = -3;
    run.provisions = 0.5;
    run.condition.crew.push({ ...run.condition.crew[0] });
    run.condition.damage.sails = 99;
    expect(runProblems(run)).toHaveLength(4);
    run.gold = NaN;
    expect(runProblems(run).join()).toContain('bad number at .gold');
  });

  it('catch a broken fight', () => {
    const battle = new Battle(playerShip('gull'), enemy('cutter').ship, { seed: 1 });
    expect(battleProblems(battle)).toEqual([]);
    battle.player.systems.get('pumps')!.hands = 1;
    battle.player.systems.get('pumps')!.damage = 2; // no bars left for the hand on them
    battle.enemy.crew.push(battle.player.crew[0]);
    battle.enemy.rooms.get('fore')!.water = 140;
    expect(battleProblems(battle).join('\n')).toMatch(/pumps has \d hands for 0 bars[^]*water 140[^]*shares a tile[^]*two places/);
  });
});
