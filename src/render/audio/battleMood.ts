import type { Battle } from '../../sim/Battle';
import { battleTension, type Mood } from './mix';

/** The most of her own crew each battle's ship has had standing, so losses read as a fraction. */
const mustered = new WeakMap<Battle, number>();

/**
 * How a battle stands, for the audio director: its tension (our hull and hers, crew lost, boarders aboard, fires,
 * flooding), whether it is a boss fight, how much of our ship is burning, and whether it is paused. No Phaser.
 */
export function battleMood(b: Battle, boss: boolean): Partial<Mood> {
  const p = b.player;
  const e = b.enemy;
  const crew = p.own().filter((c) => c.hp > 0).length;
  const most = Math.max(mustered.get(b) ?? 0, crew);
  mustered.set(b, most);
  let fires = 0;
  for (const r of p.rooms.values()) if (r.fire > 0) fires++;
  const tension = battleTension({
    hull: p.hull / Math.max(1, p.def.hull),
    enemyHull: e.hull / Math.max(1, e.def.hull),
    crew: most ? crew / most : 1,
    boarders: p.boarders().length,
    fires,
    flood: p.floodFraction(),
    grappled: b.grappled,
  });
  return { tension, boss, fire: Math.min(1, fires * 0.4), paused: b.paused && !b.outcome };
}
