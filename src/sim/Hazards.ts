import { doorsFrom } from './pathfinding';
import type { BattleEvent } from './events';
import type { Rng } from './rng';
import type { Ship } from './Ship';

export const FIRE_GROWTH = 5; // intensity per second
export const FIRE_SPREAD_CHANCE = 0.05; // per second per neighbour at full intensity
export const FIRE_BURN_RATE = 0.15; // burn per second per point of intensity (100 burn = 1 system damage)
export const FIRE_CREW_DAMAGE = 0.08; // HP per second per point of intensity
export const WATER_DOUSE = 25; // fire removed per second in a room with water >= 30

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

function updateFire(ship: Ship, dt: number, rng: Rng, events: BattleEvent[]): void {
  const ignite: string[] = [];
  for (const room of ship.rooms.values()) {
    if (room.fire <= 0) continue;
    if (room.water >= 30) room.fire -= WATER_DOUSE * dt;
    else room.fire += FIRE_GROWTH * dt;
    room.fire = Math.max(0, Math.min(100, room.fire));
    if (room.fire <= 0) {
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

    if (room.fire > 50) {
      for (const d of doorsFrom(ship.doors, room.def.id)) {
        const next = ship.room(d.b);
        if (next.fire <= 0 && next.water < 30 && rng.chance(FIRE_SPREAD_CHANCE * (room.fire / 100) * dt)) ignite.push(d.b);
      }
    }
  }
  for (const id of ignite) {
    const room = ship.room(id);
    if (room.fire > 0) continue;
    room.fire = 20;
    events.push({ t: 'fire', side: ship.side, room: id });
  }
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
    if (room.fire > 0) c.hp -= room.fire * FIRE_CREW_DAMAGE * dt;
    if (room.water >= DROWN_LEVEL) c.hp -= DROWN_DAMAGE * dt;
    if (heal && surgeon && c.room === surgeon.room && !c.waypoints.length) c.hp = Math.min(c.maxHp, c.hp + heal * dt);
  }
}

export function isSinking(ship: Ship): boolean {
  return ship.floodFraction() >= SINK_FRACTION;
}
