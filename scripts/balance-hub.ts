/**
 * The hideout's alternate batteries against the ships' own, over whole voyages: `npx tsx scripts/balance-hub.ts [voyages]`.
 * A loadout is a side-grade if its win rate stays close to the ship's own across the AI captains.
 */
import { applyLoadout, LOADOUTS } from '../src/data/hideout';
import { autoRun, type AutoRunOptions } from '../src/sim/autoRun';
import { Run } from '../src/sim/Run';

const VOYAGES = Number(process.argv[2] ?? 60);
const STYLES: [string, AutoRunOptions][] = [
  ['spread', {}],
  ['focus guns', { focus: 'guns' }],
  ['focus helm', { focus: 'helm' }],
  ['boarder', { focus: 'guns', boardWith: 2 }],
  ['diplomat', { focus: 'guns', diplomacy: true }],
];

for (const l of LOADOUTS) {
  console.log(`\n== ${l.ship}: ${l.name} (${l.id}) ==`);
  let base = 0;
  let alt = 0;
  for (const [label, opts] of STYLES) {
    let a = 0;
    let b = 0;
    for (let seed = 1; seed <= VOYAGES; seed++) {
      if (autoRun(new Run(l.ship, seed), opts).run.status === 'won') a++;
      const run = new Run(l.ship, seed);
      applyLoadout(run, l.id);
      if (autoRun(run, opts).run.status === 'won') b++;
    }
    base += a;
    alt += b;
    console.log(`${label.padEnd(10)} own ${Math.round((100 * a) / VOYAGES)}%  ${l.name} ${Math.round((100 * b) / VOYAGES)}%`);
  }
  const n = VOYAGES * STYLES.length;
  console.log(`overall    own ${Math.round((100 * base) / n)}%  ${l.name} ${Math.round((100 * alt) / n)}%`);
}
