import type { BattleEvent } from './events';
import type { Rng } from './rng';
import { tileAt, type RoomState, type Ship } from './Ship';

export const FIRE_GROWTH = 5; // intensity per second on each burning tile
/** Chance per second that a tile burning at full intensity sets a neighbouring tile alight: in the same room, through a doorway, through a bulkhead. */
export const FIRE_TILE_SPREAD = 0.3;
export const FIRE_DOOR_SPREAD = 0.06;
export const FIRE_WALL_SPREAD = 0.012;
/** A tile has to burn this hot before it can light its neighbours, and a tile it lights starts this hot. */
export const FIRE_SPREAD_MIN = 30;
export const FIRE_CATCH = 15;
export const FIRE_BURN_RATE = 0.15; // burn per second per point of the room's mean intensity (100 burn = 1 system damage)
export const FIRE_CREW_DAMAGE = 0.08; // HP per second per point of intensity (mostly the tile underfoot, partly the room's smoke)
export const WATER_DOUSE = 25; // fire removed per second from each tile in a room with water >= 30

export const BREACH_INFLOW = 8; // water level per second in the breached room
export const WATER_FLOW = 0.6; // volume exchanged per second per level of difference through a door
export const PUMP_RATE = 12; // volume drained per second per pump level
export const BILGE_DRAIN = 1.5; // volume drained per second with no pumps at all
export const DROWN_LEVEL = 70;
export const DROWN_DAMAGE = 3; // HP per second
export const SINK_FRACTION = 0.6;

export const SURGEON_HEAL = 6; // HP per second per surgeon level

export function updateHazards(ship: Ship, dt: number, rng: Rng, events: BattleEvent[]): void {
  updateFire(ship, dt, rng, events);
  updateWater(ship, dt);
  updateCrewHealth(ship, dt);
}

/** A tile next to another, in the same room, through a doorway, or across a bulkhead. */
interface Neighbour {
  room: RoomState;
  tile: number;
  chance: number;
}

const neighbourCache = new WeakMap<Ship, Map<RoomState, Neighbour[][]>>();

/** For every tile of every room, the tiles fire can reach from it, and how readily. Worked out once per ship. */
function neighbours(ship: Ship): Map<RoomState, Neighbour[][]> {
  const cached = neighbourCache.get(ship);
  if (cached) return cached;
  const at = new Map<string, { room: RoomState; tile: number }>();
  for (const room of ship.rooms.values()) {
    const d = room.def;
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) at.set(`${d.x + x},${d.y + y}`, { room, tile: y * d.w + x });
  }
  const doorway = (ax: number, ay: number, bx: number, by: number) =>
    ship.doors.some((dr) => (dr.ta.x === ax && dr.ta.y === ay && dr.tb.x === bx && dr.tb.y === by) || (dr.tb.x === ax && dr.tb.y === ay && dr.ta.x === bx && dr.ta.y === by));
  const out = new Map<RoomState, Neighbour[][]>();
  for (const room of ship.rooms.values()) {
    const d = room.def;
    const lists: Neighbour[][] = [];
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const ax = d.x + x;
        const ay = d.y + y;
        const list: Neighbour[] = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = at.get(`${ax + dx},${ay + dy}`);
          if (!n) continue;
          const chance = n.room === room ? FIRE_TILE_SPREAD : doorway(ax, ay, ax + dx, ay + dy) ? FIRE_DOOR_SPREAD : FIRE_WALL_SPREAD;
          list.push({ ...n, chance });
        }
        lists.push(list);
      }
    }
    out.set(room, lists);
  }
  neighbourCache.set(ship, out);
  return out;
}

/** Set one tile of a room alight (a random one unless given), at least this hot. Reports a room that was not burning. */
export function ignite(ship: Ship, room: RoomState, rng: Rng, intensity: number, events: BattleEvent[], tile?: number): void {
  const was = room.flames.some((f) => f > 0);
  const i = tile ?? rng.int(room.flames.length);
  room.flames[i] = Math.max(room.flames[i], Math.min(100, intensity));
  if (!was) events.push({ t: 'fire', side: ship.side, room: room.def.id });
}

/**
 * Fire lives on tiles: each burning tile grows hotter, and once hot enough may light the tiles around it,
 * readily within its room, less through a doorway, and only now and then through a bulkhead. A room's system
 * scorches in proportion to how much of the room is ablaze. Water in a room puts its tiles out.
 */
function updateFire(ship: Ship, dt: number, rng: Rng, events: BattleEvent[]): void {
  const map = neighbours(ship);
  const catching: { room: RoomState; tile: number }[] = [];
  for (const room of ship.rooms.values()) {
    const flames = room.flames;
    let any = false;
    const wet = room.water >= 30;
    for (let i = 0; i < flames.length; i++) {
      if (flames[i] <= 0) continue;
      flames[i] = Math.max(0, Math.min(100, flames[i] + (wet ? -WATER_DOUSE : FIRE_GROWTH) * dt));
      if (flames[i] <= 0) continue;
      any = true;
      if (flames[i] < FIRE_SPREAD_MIN) continue;
      for (const n of map.get(room)![i]) {
        if (n.room.flames[n.tile] > 0 || n.room.water >= 30) continue;
        if (rng.chance(n.chance * (flames[i] / 100) * dt)) catching.push(n);
      }
    }
    if (!any) {
      room.burn = 0;
      continue;
    }
    const sys = room.def.system;
    if (sys) {
      room.burn += room.fire * FIRE_BURN_RATE * dt;
      if (room.burn >= 100) {
        room.burn = 0;
        ship.damageSystem(sys, 1);
      }
    }
  }
  for (const { room, tile } of catching) if (room.flames[tile] <= 0) ignite(ship, room, rng, FIRE_CATCH, events, tile);
}

function updateWater(ship: Ship, dt: number): void {
  const area = (id: string) => ship.room(id).def.w * ship.room(id).def.h;

  for (const room of ship.rooms.values()) {
    if (room.breach) room.water = Math.min(100, room.water + BREACH_INFLOW * dt);
  }

  // Water finds its level through open doors.
  for (const d of ship.doors) {
    const a = ship.room(d.a);
    const b = ship.room(d.b);
    const diff = a.water - b.water;
    if (Math.abs(diff) < 0.01) continue;
    const maxMove = (Math.abs(diff) * area(d.a) * area(d.b)) / (area(d.a) + area(d.b));
    const vol = Math.sign(diff) * Math.min(maxMove, Math.abs(diff) * WATER_FLOW * dt);
    a.water -= vol / area(d.a);
    b.water += vol / area(d.b);
  }

  // Pumps drain the whole ship, wettest rooms first in proportion to their water.
  let pumpLevel = ship.level('pumps');
  if (ship.isSwamped('pumps')) pumpLevel /= 2;
  let drain = (BILGE_DRAIN + pumpLevel * PUMP_RATE) * dt;
  let total = 0;
  for (const r of ship.rooms.values()) total += r.water * area(r.def.id);
  if (total <= 0) return;
  drain = Math.min(drain, total);
  for (const r of ship.rooms.values()) {
    const vol = r.water * area(r.def.id);
    r.water = Math.max(0, r.water - (drain * (vol / total)) / area(r.def.id));
  }
}

function updateCrewHealth(ship: Ship, dt: number): void {
  const surgeon = ship.system('surgeon');
  const heal = surgeon ? ship.level('surgeon') * SURGEON_HEAL : 0;
  for (const c of ship.crew) {
    const room = ship.room(c.room);
    // The flames underfoot burn; the smoke of the rest of the room chokes.
    const fire = room.fire;
    if (fire > 0) c.hp -= (0.7 * room.flames[tileAt(room, c.pos)] + 0.3 * fire) * FIRE_CREW_DAMAGE * dt;
    if (room.water >= DROWN_LEVEL) c.hp -= DROWN_DAMAGE * dt;
    if (heal && surgeon && c.side === ship.side && c.room === surgeon.room && !c.waypoints.length) c.hp = Math.min(c.maxHp, c.hp + heal * dt);
  }
}

export function isSinking(ship: Ship): boolean {
  return ship.floodFraction() >= SINK_FRACTION;
}
