/** Headless balance check: AI-captained player ships vs the Navy cutter. Run with `npm run balance`. */
import { NAVY_CUTTER } from '../src/data/enemies';
import { PLAYER_SHIPS } from '../src/data/ships';
import { Battle } from '../src/sim/Battle';

const RUNS = Number(process.argv[2] ?? 200);

for (const def of PLAYER_SHIPS) {
  const kinds: Record<string, number> = {};
  let won = 0;
  let time = 0;
  let hullLeft = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const b = new Battle(def, NAVY_CUTTER, { seed, autoPlayer: true });
    const o = b.runToEnd(900);
    const k = o?.kind ?? 'timeout';
    kinds[k] = (kinds[k] ?? 0) + 1;
    if (o?.won) won++;
    time += b.time;
    hullLeft += b.player.hull / def.hull;
  }
  const pct = (n: number) => `${Math.round((100 * n) / RUNS)}%`;
  console.log(
    `${def.name.padEnd(16)} win ${pct(won).padStart(4)}  avg ${(time / RUNS).toFixed(0)}s  hull left ${pct(hullLeft)}  `,
    Object.entries(kinds)
      .map(([k, n]) => `${k}:${n}`)
      .join(' '),
  );
}
