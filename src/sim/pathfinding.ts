import type { RoomDef, Vec } from './types';

export interface Door {
  a: string;
  b: string;
  /** Tile inside room a next to the door. */
  ta: Vec;
  /** Tile inside room b next to the door. */
  tb: Vec;
}

/** Adds a door between every pair of rooms that share a wall, in the middle of the shared edge. */
export function buildDoors(rooms: RoomDef[]): Door[] {
  const doors: Door[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const door = doorBetween(rooms[i], rooms[j]) ?? flip(doorBetween(rooms[j], rooms[i]));
      if (door) doors.push(door);
    }
  }
  return doors;
}

function flip(d: Door | null): Door | null {
  return d && { a: d.b, b: d.a, ta: d.tb, tb: d.ta };
}

/** Door when a is directly left of or above b. */
function doorBetween(a: RoomDef, b: RoomDef): Door | null {
  if (a.x + a.w === b.x) {
    const lo = Math.max(a.y, b.y);
    const hi = Math.min(a.y + a.h, b.y + b.h);
    if (hi > lo) {
      const y = lo + Math.floor((hi - lo - 1) / 2);
      return { a: a.id, b: b.id, ta: { x: a.x + a.w - 1, y }, tb: { x: b.x, y } };
    }
  }
  if (a.y + a.h === b.y) {
    const lo = Math.max(a.x, b.x);
    const hi = Math.min(a.x + a.w, b.x + b.w);
    if (hi > lo) {
      const x = lo + Math.floor((hi - lo - 1) / 2);
      return { a: a.id, b: b.id, ta: { x, y: a.y + a.h - 1 }, tb: { x, y: b.y } };
    }
  }
  return null;
}

/** Doors leaving a room, oriented so `a` is the given room. */
export function doorsFrom(doors: Door[], roomId: string): Door[] {
  const out: Door[] = [];
  for (const d of doors) {
    if (d.a === roomId) out.push(d);
    else if (d.b === roomId) out.push(flip(d)!);
  }
  return out;
}

/** Shortest sequence of doors (oriented in travel direction) from one room to another, or null. */
export function findRoute(doors: Door[], from: string, to: string): Door[] | null {
  if (from === to) return [];
  const prev = new Map<string, Door>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const room = queue.shift()!;
    for (const d of doorsFrom(doors, room)) {
      if (seen.has(d.b)) continue;
      seen.add(d.b);
      prev.set(d.b, d);
      if (d.b === to) {
        const route: Door[] = [];
        for (let r = to; r !== from; r = prev.get(r)!.a) route.unshift(prev.get(r)!);
        return route;
      }
      queue.push(d.b);
    }
  }
  return null;
}
