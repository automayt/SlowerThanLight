/**
 * Headless balance check, run with `npm run balance [runs] [battles|voyages|<enemy id>]`:
 * AI-captained player ships vs every enemy fresh from the yard, then whole voyages from Tortuga to the blockade.
 */
import { ENEMY_LIST } from '../src/data/enemies';
import { PLAYER_SHIPS } from '../src/data/ships';
import { autoRun } from '../src/sim/autoRun';
import { Battle } from '../src/sim/Battle';
import { Run } from '../src/sim/Run';
import type { EnemyDef, ShipDef, SystemId } from '../src/sim/types';

const RUNS = Number(process.argv[2] ?? 200);
const ONLY = process.argv[3];
const pct = (n: number, of = RUNS) => `${Math.round((100 * n) / of)}%`;

/** How the AI captains the player's ship: where its guns aim, and whether it boards. */
interface Captain {
  label: string;
  focus?: SystemId;
  board?: number;
}

const CAPTAINS: Captain[] = [
  { label: 'spread' },
  { label: 'focus guns', focus: 'guns' },
  { label: 'boarder', focus: 'sails', board: 2 },
];

function fight(def: ShipDef, foe: EnemyDef, cap: Captain) {
  const kinds: Record<string, number> = {};
  let won = 0;
  let time = 0;
  let hullLeft = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const b = new Battle(def, foe.ship, { seed, autoPlayer: true, playerFocus: cap.focus, playerBoardWith: cap.board, enemyAI: foe.ai, allowEscape: false });
    const o = b.runToEnd(900);
    const k = o?.kind ?? 'timeout';
    kinds[k] = (kinds[k] ?? 0) + 1;
    if (o?.won) won++;
    time += b.time;
    hullLeft += Math.max(0, b.player.hull) / def.hull;
  }
  return { won, time, hullLeft, kinds };
}

for (const foe of ONLY === 'voyages' ? [] : ENEMY_LIST.filter((e) => !ONLY || ONLY === 'battles' || e.id === ONLY)) {
  console.log(`\n== vs ${foe.ship.name} (${foe.ship.className}) ==`);
  for (const cap of CAPTAINS) {
    const label = cap.label;
    for (const def of PLAYER_SHIPS) {
      const r = fight(def, foe, cap);
      console.log(
        `${label.padEnd(10)} ${def.name.padEnd(16)} win ${pct(r.won).padStart(4)}  avg ${(r.time / RUNS).toFixed(0).padStart(3)}s  hull left ${pct(r.hullLeft).padStart(4)}  `,
        Object.entries(r.kinds)
          .map(([k, n]) => `${k}:${n}`)
          .join(' '),
      );
    }
  }
}

const VOYAGES = Math.max(10, Math.round(RUNS / 4));
if (!ONLY || ONLY === 'voyages') {
  console.log(`\n== Whole voyages (${VOYAGES} per ship) ==`);
  for (const [label, focus] of [['spread', undefined], ['focus guns', 'guns']] as const) {
    for (const def of PLAYER_SHIPS) {
      let won = 0;
      let cols = 0;
      let gold = 0;
      let ambushes = 0;
      let fights = 0;
      const killers: Record<string, number> = {};
      for (let seed = 1; seed <= VOYAGES; seed++) {
        const { run, battles } = autoRun(new Run(def.id, seed), { focus });
        if (run.status === 'won') won++;
        cols += run.node.col;
        gold += run.plunderTaken;
        fights += battles.length;
        ambushes += battles.filter((b) => b.enemy === 'cutter').length;
        if (run.status === 'lost') {
          const last = battles.at(-1)?.enemy ?? run.ending;
          killers[last] = (killers[last] ?? 0) + 1;
        }
      }
      console.log(
        `${label.padEnd(10)} ${def.name.padEnd(16)} win ${pct(won, VOYAGES).padStart(4)}  reached col ${(cols / VOYAGES).toFixed(1)}  fights ${(fights / VOYAGES).toFixed(1)} (cutters ${(ambushes / VOYAGES).toFixed(1)})  plunder ${(gold / VOYAGES).toFixed(0)}  lost to`,
        Object.entries(killers)
          .map(([k, n]) => `${k}:${n}`)
          .join(' '),
      );
    }
  }
}
