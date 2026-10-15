/** Headless balance check: AI-captained player ships vs every enemy, fresh from the yard. Run with `npm run balance [runs]`. */
import { ENEMY_LIST } from '../src/data/enemies';
import { PLAYER_SHIPS } from '../src/data/ships';
import { Battle } from '../src/sim/Battle';
import type { EnemyDef, ShipDef, SystemId } from '../src/sim/types';

const RUNS = Number(process.argv[2] ?? 200);
const pct = (n: number, of = RUNS) => `${Math.round((100 * n) / of)}%`;

function fight(def: ShipDef, foe: EnemyDef, focus: SystemId | undefined) {
  const kinds: Record<string, number> = {};
  let won = 0;
  let time = 0;
  let hullLeft = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const b = new Battle(def, foe.ship, { seed, autoPlayer: true, playerFocus: focus, enemyAI: foe.ai, allowEscape: false });
    const o = b.runToEnd(900);
    const k = o?.kind ?? 'timeout';
    kinds[k] = (kinds[k] ?? 0) + 1;
    if (o?.won) won++;
    time += b.time;
    hullLeft += Math.max(0, b.player.hull) / def.hull;
  }
  return { won, time, hullLeft, kinds };
}

for (const foe of ENEMY_LIST) {
  console.log(`\n== vs ${foe.ship.name} (${foe.ship.className}) ==`);
  for (const [label, focus] of [['spread', undefined], ['focus guns', 'guns']] as const) {
    for (const def of PLAYER_SHIPS) {
      const r = fight(def, foe, focus);
      console.log(
        `${label.padEnd(10)} ${def.name.padEnd(16)} win ${pct(r.won).padStart(4)}  avg ${(r.time / RUNS).toFixed(0).padStart(3)}s  hull left ${pct(r.hullLeft).padStart(4)}  `,
        Object.entries(r.kinds)
          .map(([k, n]) => `${k}:${n}`)
          .join(' '),
      );
    }
  }
}
