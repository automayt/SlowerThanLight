import type { BattleEvent } from './events';
import { ignite } from './Hazards';
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
    blurb: 'Wrecks systems and shreds rigging, and ignores stout sides. Heavy chain splinters a little hull.',
    hull: (d) => (d >= 2 ? 1 : 0),
    system: (d, sys) => d + (sys === 'sails' ? 1 : 0),
    crew: 5,
    fireChance: 0,
    breachChance: 0,
    rigging: 12,
  },
  grape: {
    label: 'Grape',
    blurb: 'A hail of musket balls. Cuts down crew — kill her gun crews and her guns load at a crawl.',
    hull: () => 0,
    system: () => 0,
    crew: 35,
    fireChance: 0,
    breachChance: 0,
    rigging: 0,
  },
  hot: {
    label: 'Hot',
    blurb: 'Heated shot. Full hull damage and likely fire, but light on systems.',
    hull: (d) => d,
    system: () => 1,
    crew: 10,
    fireChance: 0.7,
    breachChance: 0,
    rigging: 0,
  },
};

/** Reload speed with nobody serving the guns: hands alone load slowly. */
export const UNCREWED_RELOAD = 0.4;
/** Chance a ball no heavier than the target's armour glances off her sides. */
export const DEFLECT_CHANCE = 0.4;

/** Reload speed when the helm is wrecked or unmanned: she can't bring her guns to bear. */
export const NO_HELM_RELOAD = 0.5;

/** Chance a round or hot ball striking the gun deck actually disables guns. */
export const GUN_DECK_HIT_CHANCE = 0.5;

/** Seconds to restore one bulwark layer (a manned station works faster). */
export const BULWARK_RECHARGE = 4;

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

/** Restore spent bulwark layers, one at a time, up to the station's working level. */
export function updateBulwarks(ship: Ship, dt: number): void {
  const max = ship.level('bulwarks');
  if (ship.layers > max) ship.layers = max;
  if (ship.layers >= max) {
    ship.layerCharge = 0;
    return;
  }
  ship.layerCharge += (dt / BULWARK_RECHARGE) * (ship.isManned('bulwarks') ? 1.25 : 1);
  if (ship.layerCharge >= 1) {
    ship.layers++;
    ship.layerCharge = 0;
  }
}

/** Whether a broadside is still waiting on a gun that is aimed and crewed but not yet loaded. */
function broadsideHolding(ship: Ship, target: Ship): boolean {
  if (!ship.broadside) return false;
  return ship.guns.some((g) => g.powered && g.target && target.rooms.has(g.target) && g.charge < g.def.loadTime);
}

/** Load guns and fire any that are loaded and aimed. */
export function updateGuns(ship: Ship, target: Ship, dt: number, out: Projectile[], events: BattleEvent[], stats: CombatStats): void {
  const working = ship.level('guns') > 0;
  // Guns need people at them: a gun captain lays them, more hands run them out faster.
  const crew = ship.gunCrew();
  const gunner = crew.reduce<(typeof crew)[number] | undefined>((best, c) => (!best || rank(c, 'gunnery') > rank(best, 'gunnery') ? c : best), undefined);
  const crewed = crew.length === 0 ? UNCREWED_RELOAD : crew.length === 1 ? 1.15 : 1.3;
  // Without steerage she can't turn to bring her broadside to bear.
  const bearing = ship.level('helm') > 0 && ship.isManned('helm') ? 1 : NO_HELM_RELOAD;
  const rate = (crewed + (gunner ? rank(gunner, 'gunnery') * GUNNERY_RELOAD : 0)) * bearing * ship.reloadRate;
  const hold = broadsideHolding(ship, target);
  ship.guns.forEach((g, i) => {
    if (!g.powered || !working) {
      g.charge = Math.max(0, g.charge - dt * 3);
      return;
    }
    g.charge = Math.min(g.def.loadTime, g.charge + dt * rate);
    if (g.charge < g.def.loadTime || !g.target || !target.rooms.has(g.target) || hold) return;
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
      // Bulwarks soak a ball each; chain shot flies high over them, into the rigging.
      if (p.shot !== 'chain' && target.layers > 0) {
        target.layers--;
        target.layerCharge = 0;
        events.push({ t: 'block', side: target.side, room: p.room });
        continue;
      }
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

  // Light round and hot shot often glance off a heavy ship's sides; chain and grape fly above them.
  if ((shot === 'round' || shot === 'hot') && damage <= target.armour && rng.chance(DEFLECT_CHANCE)) {
    events.push({ t: 'hit', side: target.side, room: roomId, hull: 0, shot, deflected: true });
    return 0;
  }

  const hull = Math.min(target.hull, fx.hull(damage));
  target.hull -= hull;
  // Guns are spread along the deck: round and hot shot often strike planking between them. Chain is aimed to wreck.
  const glancesGuns = sysId === 'guns' && shot !== 'chain' && !rng.chance(GUN_DECK_HIT_CHANCE);
  if (sysId && !glancesGuns) target.damageSystem(sysId, fx.system(damage, sysId));
  for (const c of target.crew) if (c.room === roomId) c.hp -= fx.crew;
  target.escape = Math.max(0, target.escape - fx.rigging);

  events.push({ t: 'hit', side: target.side, room: roomId, hull, shot });
  if (fx.fireChance && rng.chance(fx.fireChance)) {
    ignite(target, room, rng, 40, events);
  }
  if (fx.breachChance && !room.breach && rng.chance(fx.breachChance)) {
    room.breach = true;
    room.breachProgress = 0;
    events.push({ t: 'breach', side: target.side, room: roomId });
  }
  return hull;
}
