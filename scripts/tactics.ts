import { ENEMY_LIST } from '../src/data/enemies';
import { playerShip } from '../src/data/ships';
import { Battle } from '../src/sim/Battle';
import { scaleEnemy } from '../src/sim/Run';
const N = Number(process.argv[2] ?? 60);
const shipId = process.argv[3] ?? 'gull';
const base = playerShip(shipId);
const withShot = (shot: any) => ({ ...base, guns: base.guns.map((g) => ({ ...g, shot })) });
const T: [string, any, any][] = [
  ['spread', base, {}],
  ['focGuns', base, { playerFocus: 'guns' }],
  ['focHelm', base, { playerFocus: 'helm' }],
  ['focSails', base, { playerFocus: 'sails' }],
  ['focBulw', base, { playerFocus: 'bulwarks' }],
  ['grapeGuns', withShot('grape'), { playerFocus: 'guns' }],
  ['hotGuns', withShot('hot'), { playerFocus: 'guns' }],
  ['chainGuns', withShot('chain'), { playerFocus: 'guns' }],
  ['chainSails', withShot('chain'), { playerFocus: 'sails' }],
  ['chainHelm', withShot('chain'), { playerFocus: 'helm' }],
  ['grapeHelm', withShot('grape'), { playerFocus: 'helm' }],
  ['board3', base, { playerFocus: 'guns', playerBoardWith: 3 }],
];
console.log('ship', shipId, 'tier = sector the enemy appears in; win% / avg hull left%');
console.log('enemy'.padEnd(12) + T.map((t) => t[0].padStart(11)).join(''));
for (const foe of ENEMY_LIST) {
  const tier = foe.id === 'frigate' ? 1 : ['merchant', 'smuggler'].includes(foe.id) ? 0 : ['sloop', 'rival'].includes(foe.id) ? 2 : 1;
  const es = scaleEnemy(foe.ship, tier);
  const cells: string[] = [];
  const scores: number[] = [];
  for (const [, def, o] of T) {
    let won = 0, hull = 0;
    for (let seed = 1; seed <= N; seed++) {
      const b = new Battle(def, es, { seed, autoPlayer: true, enemyAI: foe.ai, allowEscape: false, ...o });
      const r = b.runToEnd(900);
      if (r?.won) { won++; hull += Math.max(0, b.player.hull) / def.hull; }
    }
    scores.push(won + hull);
    cells.push(`${Math.round(100 * won / N)}/${won ? Math.round(100 * hull / won) : 0}`.padStart(11));
  }
  const best = scores.indexOf(Math.max(...scores));
  const near = scores.filter((s) => s >= 0.9 * scores[best]).length;
  console.log(`${foe.id}@${tier}`.padEnd(12) + cells.join('') + `   best=${T[best][0]} within10%=${near}`);
}
