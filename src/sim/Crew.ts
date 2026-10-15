import { findRoute } from './pathfinding';
import type { Crew, CrewTask, Ship, Waypoint } from './Ship';
import { rank, REPAIR_BONUS, train } from './Skills';

/** Tiles per second. */
export const CREW_SPEED = 2.2;
/** Fire intensity removed per second per firefighter. */
export const FIREFIGHT_RATE = 18;
/** Breach patch progress per second per crew member (100 = patched). */
export const PATCH_RATE = 25;
/** Repair progress per second per crew member (100 = one damage point fixed). */
export const REPAIR_RATE = 20;

const MANNABLE = new Set(['helm', 'sails', 'guns']);

/** Send a crew member to a room. Returns false if the room is full or unreachable. */
export function orderMove(ship: Ship, crew: Crew, roomId: string): boolean {
  if (!ship.rooms.has(roomId)) return false;
  // Re-ordering to the room you're already heading to is a no-op.
  const dest = crew.waypoints.length ? crew.waypoints[crew.waypoints.length - 1].room : crew.room;
  if (dest === roomId) return true;

  const route = findRoute(ship.doors, crew.room, roomId);
  if (!route) return false;
  const slot = ship.freeSlot(roomId, crew);
  if (!slot) return false;

  const waypoints: Waypoint[] = [];
  for (const d of route) {
    waypoints.push({ x: d.ta.x + 0.5, y: d.ta.y + 0.5, room: d.a });
    waypoints.push({ x: d.tb.x + 0.5, y: d.tb.y + 0.5, room: d.b });
  }
  waypoints.push({ x: slot.x + 0.5, y: slot.y + 0.5, room: roomId });
  crew.slot = slot;
  crew.waypoints = waypoints;
  crew.task = 'moving';
  return true;
}

/** Where a crew member is going (their current room if standing still). */
export function destination(crew: Crew): string {
  return crew.waypoints.length ? crew.waypoints[crew.waypoints.length - 1].room : crew.room;
}

/** Move crew along their paths, then let everyone standing in a room work on its most urgent problem. */
export function updateCrew(ship: Ship, dt: number): void {
  for (const c of ship.crew) move(ship, c, dt);

  for (const room of ship.rooms.values()) {
    const workers = ship.crewInRoom(room.def.id);
    if (!workers.length) continue;
    // Nobody repairs or fights fires with boarders in the room: that is a fight (see Boarding).
    if (ship.crew.some((c) => c.side !== ship.side && c.room === room.def.id && !c.waypoints.length)) continue;
    const sys = ship.systemInRoom(room.def.id);
    let task: CrewTask;
    if (room.fire > 0) {
      task = 'fire';
      room.fire = Math.max(0, room.fire - FIREFIGHT_RATE * workers.length * dt);
    } else if (room.breach) {
      task = 'breach';
      room.breachProgress += PATCH_RATE * workers.reduce((n, w) => n + 1 + rank(w, 'repair') * REPAIR_BONUS, 0) * dt;
      for (const w of workers) train(w, 'repair', dt);
      if (room.breachProgress >= 100) {
        room.breach = false;
        room.breachProgress = 0;
      }
    } else if (sys && sys.damage > 0) {
      task = 'repair';
      sys.repair += REPAIR_RATE * workers.reduce((n, w) => n + 1 + rank(w, 'repair') * REPAIR_BONUS, 0) * dt;
      for (const w of workers) train(w, 'repair', dt * 2);
      if (sys.repair >= 100) {
        sys.damage -= 1;
        sys.repair = 0;
        ship.restoreWanted();
      }
    } else if (sys && MANNABLE.has(sys.id)) {
      task = 'man';
    } else {
      task = 'idle';
    }
    // Only one person mans a station; the rest stand by.
    workers.forEach((w, i) => (w.task = task === 'man' && i > 0 ? 'idle' : task));
  }
}

function move(ship: Ship, c: Crew, dt: number): void {
  if (!c.waypoints.length) return;
  const speed = CREW_SPEED * (ship.room(c.room).water >= 40 ? 0.5 : 1);
  let budget = speed * dt;
  while (budget > 0 && c.waypoints.length) {
    const wp = c.waypoints[0];
    const dx = wp.x - c.pos.x;
    const dy = wp.y - c.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget) {
      c.pos.x = wp.x;
      c.pos.y = wp.y;
      c.room = wp.room;
      c.waypoints.shift();
      budget -= dist;
    } else {
      c.pos.x += (dx / dist) * budget;
      c.pos.y += (dy / dist) * budget;
      budget = 0;
    }
  }
  c.task = c.waypoints.length ? 'moving' : 'idle';
}
