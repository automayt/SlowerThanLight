import type { Battle, Outcome } from './Battle';
import type { CombatStats, Projectile } from './Combat';
import type { BattleEvent } from './events';
import type { Crew, Ship } from './Ship';
import type { ShotType, Side, SystemId } from './types';

/**
 * A battle's whole moving state as plain data, for a co-op server to send to its players. Applying it to a copy of
 * the same battle (built from the same ships) updates that copy in place, so views holding its ships and crew keep
 * working.
 */
export interface BattleSnapshot {
  time: number;
  paused: boolean;
  speed: number;
  rallied: boolean;
  holdingFire: boolean;
  outcome: Outcome | null;
  fleeing: boolean;
  rng: number;
  projectiles: Projectile[];
  transit: { crew: Crew; to: Side; room: string; t: number }[];
  stats: Record<Side, CombatStats>;
  player: ShipSnapshot;
  enemy: ShipSnapshot;
  /** Hull of each ship in company (prizes have one). */
  consorts?: (number | undefined)[];
}

interface ShipSnapshot {
  hull: number;
  reloadRate: number;
  layers: number;
  layerCharge: number;
  broadside: boolean;
  boardingNets: boolean;
  escape: number;
  rooms: { id: string; flames: number[]; burn: number; water: number; breach: boolean; breachProgress: number; sabotage: number }[];
  systems: { id: SystemId; max: number; damage: number; hands: number; wanted: number; repair: number }[];
  guns: { powered: boolean; wanted: boolean; charge: number; target: string | null; shot: ShotType }[];
  crew: Crew[];
}

const copyCrew = (c: Crew): Crew => ({ ...c, pos: { ...c.pos }, slot: { ...c.slot }, waypoints: c.waypoints.map((w) => ({ ...w })), xp: { ...c.xp } });

function shipSnapshot(s: Ship): ShipSnapshot {
  return {
    hull: s.hull,
    reloadRate: s.reloadRate,
    layers: s.layers,
    layerCharge: s.layerCharge,
    broadside: s.broadside,
    boardingNets: s.boardingNets,
    escape: s.escape,
    rooms: [...s.rooms.values()].map((r) => ({ id: r.def.id, flames: [...r.flames], burn: r.burn, water: r.water, breach: r.breach, breachProgress: r.breachProgress, sabotage: r.sabotage })),
    systems: [...s.systems.values()].map((x) => ({ id: x.id, max: x.max, damage: x.damage, hands: x.hands, wanted: x.wanted, repair: x.repair })),
    guns: s.guns.map((g) => ({ powered: g.powered, wanted: g.wanted, charge: g.charge, target: g.target, shot: g.shot })),
    crew: s.crew.map(copyCrew),
  };
}

export function battleSnapshot(b: Battle): BattleSnapshot {
  return {
    time: b.time,
    paused: b.paused,
    speed: b.speed,
    rallied: b.rallied,
    holdingFire: b.holdingFire,
    outcome: b.outcome ? { ...b.outcome } : null,
    fleeing: b.enemyFleeing,
    rng: b.rng.position,
    projectiles: b.projectiles.map((p) => ({ ...p })),
    transit: b.transit.map((t) => ({ crew: copyCrew(t.crew), to: t.to, room: t.room, t: t.t })),
    stats: { player: { ...b.stats.player }, enemy: { ...b.stats.enemy } },
    player: shipSnapshot(b.player),
    enemy: shipSnapshot(b.enemy),
    consorts: b.consorts.map((c) => c.hull),
  };
}

/** Bring a copy of a battle up to a snapshot, reusing crew objects by id so anything holding them stays valid. */
export function applySnapshot(b: Battle, s: BattleSnapshot, events: BattleEvent[] = []): void {
  const known = new Map<number, Crew>();
  for (const c of [...b.player.crew, ...b.enemy.crew, ...b.transit.map((t) => t.crew)]) known.set(c.id, c);
  const crew = (c: Crew): Crew => {
    const mine = known.get(c.id);
    const fresh = copyCrew(c);
    return mine ? Object.assign(mine, fresh) : fresh;
  };
  const ship = (ship: Ship, x: ShipSnapshot) => {
    ship.hull = x.hull;
    ship.reloadRate = x.reloadRate;
    ship.layers = x.layers;
    ship.layerCharge = x.layerCharge;
    ship.broadside = x.broadside;
    ship.boardingNets = x.boardingNets;
    ship.escape = x.escape;
    for (const r of x.rooms) {
      const room = ship.rooms.get(r.id);
      if (!room) continue;
      room.flames = [...r.flames];
      room.burn = r.burn;
      room.water = r.water;
      room.breach = r.breach;
      room.breachProgress = r.breachProgress;
      room.sabotage = r.sabotage;
    }
    for (const y of x.systems) {
      const sys = ship.systems.get(y.id);
      if (sys) Object.assign(sys, { max: y.max, damage: y.damage, hands: y.hands, wanted: y.wanted, repair: y.repair });
    }
    x.guns.forEach((g, i) => ship.guns[i] && Object.assign(ship.guns[i], g));
    ship.crew = x.crew.map(crew);
  };
  ship(b.player, s.player);
  ship(b.enemy, s.enemy);
  b.transit = s.transit.map((t) => ({ crew: crew(t.crew), to: t.to, room: t.room, t: t.t }));
  b.time = s.time;
  b.paused = s.paused;
  b.speed = s.speed;
  b.rallied = s.rallied;
  b.holdingFire = s.holdingFire;
  b.outcome = s.outcome ? { ...s.outcome } : null;
  b.rng.position = s.rng;
  b.projectiles = s.projectiles.map((p) => ({ ...p }));
  Object.assign(b.stats.player, s.stats.player);
  Object.assign(b.stats.enemy, s.stats.enemy);
  (b as unknown as { enemyAI: { fleeing: boolean } }).enemyAI.fleeing = s.fleeing;
  s.consorts?.forEach((h, i) => b.consorts[i] && (b.consorts[i].hull = h));
  b.pushEvents(events);
}
