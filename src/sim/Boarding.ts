import type { BattleEvent } from './events';
import type { Crew, Ship } from './Ship';
import type { Side } from './types';

/** Seconds to swing or row across to the other ship. */
export const BOARD_TIME = 4;
/** HP per second one fighter deals in hand-to-hand fighting. */
export const MELEE_DPS = 9;
/** Defenders fight harder on their own deck: they know every ladder and have the cover. */
export const DEFENDER_BONUS = 1.5;
/** Sabotage progress per second per unopposed boarder (100 = one point of system damage). */
export const SABOTAGE_RATE = 10;

/** A crew member crossing between the ships. */
export interface Transit {
  crew: Crew;
  /** Ship they are heading for. */
  to: Side;
  /** Room they will land in. */
  room: string;
  /** Seconds until they arrive. */
  t: number;
}

/** How fast a ship can manoeuvre for grappling: working sails plus her hull's turn of speed. */
export function grappleSpeed(ship: Ship): number {
  return ship.level('sails') + ship.def.speedBonus / 5;
}

/**
 * Whether `from` can lay alongside `to` and grapple: she must be no faster than you,
 * or nobody must be at her helm to steer away.
 */
export function canGrapple(from: Ship, to: Ship): boolean {
  return grappleSpeed(to) <= grappleSpeed(from) || !to.isManned('helm');
}

/** Crew standing (not walking) in a room, split into the ship's own people and boarders. */
export function roomParties(ship: Ship, roomId: string): { own: Crew[]; boarders: Crew[] } {
  const here = ship.crew.filter((c) => c.room === roomId && c.waypoints.length === 0);
  return { own: here.filter((c) => c.side === ship.side), boarders: here.filter((c) => c.side !== ship.side) };
}

/** Hand-to-hand fighting in every contested room, and sabotage by unopposed boarders. */
export function updateBoarding(ship: Ship, dt: number, events: BattleEvent[]): void {
  if (!ship.crew.some((c) => c.side !== ship.side)) return;
  for (const room of ship.rooms.values()) {
    const { own, boarders } = roomParties(ship, room.def.id);
    if (!boarders.length) continue;
    if (own.length) {
      // Everyone attacks the weakest opponent in the room; blows land simultaneously.
      const hits = new Map<Crew, number>();
      for (const [attackers, foes, bonus] of [
        [own, boarders, DEFENDER_BONUS],
        [boarders, own, 1],
      ] as const) {
        const target = foes.reduce((a, b) => (b.hp < a.hp ? b : a));
        hits.set(target, (hits.get(target) ?? 0) + attackers.length * MELEE_DPS * bonus * dt);
      }
      for (const [c, dmg] of hits) c.hp -= dmg;
      for (const c of [...own, ...boarders]) c.task = 'fight';
      room.sabotage = 0;
      continue;
    }
    const sys = ship.systemInRoom(room.def.id);
    if (!sys || sys.damage >= sys.max) {
      for (const c of boarders) c.task = 'idle';
      continue;
    }
    for (const c of boarders) c.task = 'sabotage';
    room.sabotage += SABOTAGE_RATE * boarders.length * dt;
    if (room.sabotage >= 100) {
      room.sabotage = 0;
      ship.damageSystem(sys.id, 1);
      events.push({ t: 'log', side: ship.side, text: `Boarders wreck the ${room.def.name}!` });
    }
  }
}

/** Put an arriving crew member into a room of a ship (the nearest free tile if that room is full). */
export function land(ship: Ship, crew: Crew, roomId: string): void {
  const room = ship.rooms.has(roomId) && ship.freeSlot(roomId) ? roomId : [...ship.rooms.keys()].find((id) => ship.freeSlot(id)) ?? roomId;
  const slot = ship.freeSlot(room) ?? { x: ship.room(room).def.x, y: ship.room(room).def.y };
  crew.room = room;
  crew.slot = slot;
  crew.pos = { x: slot.x + 0.5, y: slot.y + 0.5 };
  crew.waypoints = [];
  crew.task = 'idle';
  ship.crew.push(crew);
}
