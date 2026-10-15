import type { BattleEvent } from './events';
import { GUNNERY_RELOAD, rank, train } from './Skills';
import type { Rng } from './rng';
import type { GunState, Ship } from './Ship';
import type { ShotType, Side, SystemId } from './types';

export interface ShotEffect {
  label: string;
  blurb: string;
  hull: (damage: number) => number;
  system: (damage: number, system: SystemId | undefined) => number;
  /** HP lost by each crew member in the room. */
  crew: number;
  fireChance: number;
  breachChance: number;
  /** Escape charge stripped from the target on any hit (shredded rigging). */
  rigging: number;
}

export const SHOT_EFFECTS: Record<ShotType, ShotEffect> = {
  round: {
    label: 'Round',
    blurb: 'Solid iron. Smashes hull and systems, may hole her below the waterline.',
    hull: (d) => d,
    system: (d) => d,
    crew: 15,
    fireChance: 0.1,
    breachChance: 0.3,
    rigging: 0,
  },
  chain: {
    label: 'Chain',
    blurb: 'Wrecks systems and shreds rigging. No hull damage.',
    hull: () => 0,
    system: (d, sys) => d + (sys === 'sails' ? 1 : 0),
    crew: 5,
    fireChance: 0,
    breachChance: 0,
    rigging: 12,
  },
  grape: {
    label: 'Grape',
    blurb: 'A hail of musket balls. Cuts down crew, barely scratches the ship.',
    hull: () => 0,
    system: () => 0,
    crew: 35,
    fireChance: 0,
    breachChance: 0,
    rigging: 0,
  },
  hot: {
    label: 'Hot',
    blurb: 'Heated shot. Light damage, but starts fires.',
    hull: (d) => Math.max(1, d - 1),
    system: () => 1,
    crew: 10,
    fireChance: 0.7,
    breachChance: 0,
    rigging: 0,
  },
};

/** Seconds a ball is in flight. */
export const TRAVEL_TIME = 1.1;
/** Gap between balls of the same volley. */
export const VOLLEY_GAP = 0.25;
/** Load lost when switching shot type. */
export const SWITCH_PENALTY = 2;

export interface Projectile {
  from: Side;
  gun: number;
  shot: ShotType;
  room: string;
  damage: number;
  inaccuracy: number;
  /** Seconds since the volley was fired. */
  t: number;
  /** Seconds before this ball leaves the muzzle. */
  delay: number;
}

export interface CombatStats {
  shotsFired: number;
  hits: number;
  hullDamage: number;
}

export function hitChance(target: Ship, inaccuracy: number): number {
  return Math.max(0.05, Math.min(1, (100 - target.evasion() - inaccuracy) / 100));
}

export function changeShot(gun: GunState, shot: ShotType): void {
  if (gun.shot === shot) return;
  gun.shot = shot;
  gun.charge = Math.max(0, gun.charge - SWITCH_PENALTY);
}

/** Load guns and fire any that are loaded and aimed. */
export function updateGuns(ship: Ship, target: Ship, dt: number, out: Projectile[], events: BattleEvent[], stats: CombatStats): void {
  const working = ship.level('guns') > 0;
  const gunner = ship.stationed('guns');
  const rate = gunner ? 1.15 + rank(gunner, 'gunnery') * GUNNERY_RELOAD : 1;
  ship.guns.forEach((g, i) => {
    if (!g.powered || !working) {
      g.charge = Math.max(0, g.charge - dt * 3);
      return;
    }
    g.charge = Math.min(g.def.loadTime, g.charge + dt * rate);
    if (g.charge < g.def.loadTime || !g.target || !target.rooms.has(g.target)) return;
    for (let s = 0; s < g.def.shots; s++) {
      out.push({
        from: ship.side,
        gun: i,
        shot: g.shot,
        room: g.target,
        damage: g.def.damage,
        inaccuracy: g.def.inaccuracy,
        t: 0,
        delay: s * VOLLEY_GAP,
      });
    }
    stats.shotsFired += g.def.shots;
    g.charge = 0;
    if (gunner) train(gunner, 'gunnery', 3, events);
    events.push({ t: 'shot', side: ship.side, gun: i, shot: g.shot });
  });
}

/** Advance balls in flight; resolve those that arrive. Returns the balls still flying. */
export function updateProjectiles(
  projectiles: Projectile[],
  ships: Record<Side, Ship>,
  dt: number,
  rng: Rng,
  events: BattleEvent[],
  stats: Record<Side, CombatStats>,
): Projectile[] {
  const flying: Projectile[] = [];
  for (const p of projectiles) {
    p.t += dt;
    if (p.t < p.delay + TRAVEL_TIME) {
      flying.push(p);
      continue;
    }
    const target = ships[p.from === 'player' ? 'enemy' : 'player'];
    if (rng.chance(hitChance(target, p.inaccuracy))) {
      const hull = applyHit(target, p.room, p.shot, p.damage, rng, events);
      stats[p.from].hits++;
      stats[p.from].hullDamage += hull;
    } else {
      events.push({ t: 'miss', side: target.side, room: p.room });
    }
  }
  return flying;
}

/** Apply one ball striking a room. Returns hull damage dealt. */
export function applyHit(target: Ship, roomId: string, shot: ShotType, damage: number, rng: Rng, events: BattleEvent[]): number {
  const fx = SHOT_EFFECTS[shot];
  const room = target.room(roomId);
  const sysId = room.def.system;

  const hull = Math.min(target.hull, fx.hull(damage));
  target.hull -= hull;
  if (sysId) target.damageSystem(sysId, fx.system(damage, sysId));
  for (const c of target.crew) if (c.room === roomId) c.hp -= fx.crew;
  target.escape = Math.max(0, target.escape - fx.rigging);

  events.push({ t: 'hit', side: target.side, room: roomId, hull, shot });
  if (fx.fireChance && rng.chance(fx.fireChance)) {
    room.fire = Math.max(room.fire, 40);
    events.push({ t: 'fire', side: target.side, room: roomId });
  }
  if (fx.breachChance && !room.breach && rng.chance(fx.breachChance)) {
    room.breach = true;
    room.breachProgress = 0;
    events.push({ t: 'breach', side: target.side, room: roomId });
  }
  return hull;
}
