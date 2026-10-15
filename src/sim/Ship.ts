import { weapon } from '../data/weapons';
import { buildDoors, type Door } from './pathfinding';
import type { RoomDef, ShipDef, ShotType, Side, SystemId, Vec, WeaponDef } from './types';
import { HANDS_SYSTEMS } from './types';

/** Water level (0..100) at which a room's system stops working. */
export const SWAMP_LEVEL = 50;

export interface RoomState {
  def: RoomDef;
  /** Fire intensity 0..100. */
  fire: number;
  /** Accumulated fire damage toward the next system damage point. */
  burn: number;
  /** Water level 0..100. */
  water: number;
  breach: boolean;
  breachProgress: number;
}

export interface SystemState {
  id: SystemId;
  room: string;
  max: number;
  damage: number;
  /** Hands assigned (unused for helm and guns). */
  hands: number;
  /** 0..100 toward repairing one damage point. */
  repair: number;
}

export interface GunState {
  def: WeaponDef;
  powered: boolean;
  /** Seconds loaded so far. */
  charge: number;
  target: string | null;
  shot: ShotType;
}

export type CrewTask = 'moving' | 'fire' | 'breach' | 'repair' | 'man' | 'idle';

export interface Waypoint extends Vec {
  /** Room the crew member is in once this waypoint is reached. */
  room: string;
}

export interface Crew {
  id: number;
  name: string;
  side: Side;
  hp: number;
  maxHp: number;
  /** Room currently occupied. */
  room: string;
  /** Station the AI sends this crew member back to. */
  home: string;
  /** Position in tile units; tile centers are at +0.5. */
  pos: Vec;
  /** Tile reserved in the destination room. */
  slot: Vec;
  waypoints: Waypoint[];
  task: CrewTask;
}

let nextCrewId = 1;

export class Ship {
  readonly def: ShipDef;
  readonly side: Side;
  readonly doors: Door[];
  readonly rooms = new Map<string, RoomState>();
  readonly systems = new Map<SystemId, SystemState>();
  readonly guns: GunState[];
  crew: Crew[] = [];
  hull: number;
  /** "Make sail" escape charge, 0..100. */
  escape = 0;
  /** Bounding size in tiles. */
  readonly width: number;
  readonly height: number;

  constructor(def: ShipDef, side: Side) {
    this.def = def;
    this.side = side;
    this.hull = def.hull;
    this.doors = buildDoors(def.rooms);
    this.width = Math.max(...def.rooms.map((r) => r.x + r.w));
    this.height = Math.max(...def.rooms.map((r) => r.y + r.h));

    for (const r of def.rooms) {
      this.rooms.set(r.id, { def: r, fire: 0, burn: 0, water: 0, breach: false, breachProgress: 0 });
      if (r.system) {
        const max = def.systems[r.system] ?? 1;
        this.systems.set(r.system, { id: r.system, room: r.id, max, damage: 0, hands: 0, repair: 0 });
      }
    }

    this.guns = def.guns.map((g) => ({
      def: weapon(g.weapon),
      powered: false,
      charge: 0,
      target: null,
      shot: g.shot ?? 'round',
    }));

    for (const c of def.crew) {
      const slot = this.freeSlot(c.room);
      if (!slot) throw new Error(`No room for ${c.name} in ${def.id}/${c.room}`);
      this.crew.push({
        id: nextCrewId++,
        name: c.name,
        side,
        hp: 100,
        maxHp: 100,
        room: c.room,
        home: c.room,
        pos: { x: slot.x + 0.5, y: slot.y + 0.5 },
        slot,
        waypoints: [],
        task: 'idle',
      });
    }

    this.autoAssignHands();
  }

  /** Starting allocation: power guns in order, then fill sails, then pumps. */
  autoAssignHands(): void {
    for (let i = 0; i < this.guns.length; i++) this.toggleGun(i, true);
    for (const id of ['sails', 'pumps'] as SystemId[]) {
      while (this.addHands(id, 1)) {
        /* keep adding */
      }
    }
  }

  room(id: string): RoomState {
    const r = this.rooms.get(id);
    if (!r) throw new Error(`No room ${id} on ${this.def.id}`);
    return r;
  }

  roomAt(tx: number, ty: number): RoomState | null {
    for (const r of this.rooms.values()) {
      const d = r.def;
      if (tx >= d.x && tx < d.x + d.w && ty >= d.y && ty < d.y + d.h) return r;
    }
    return null;
  }

  system(id: SystemId): SystemState | undefined {
    return this.systems.get(id);
  }

  systemInRoom(roomId: string): SystemState | undefined {
    const sys = this.room(roomId).def.system;
    return sys ? this.systems.get(sys) : undefined;
  }

  /** Bars not knocked out by damage. */
  capacity(id: SystemId): number {
    const s = this.systems.get(id);
    return s ? Math.max(0, s.max - s.damage) : 0;
  }

  isSwamped(id: SystemId): boolean {
    const s = this.systems.get(id);
    return !!s && this.room(s.room).water >= SWAMP_LEVEL;
  }

  /** Hands working a system right now. Guns count hands on powered guns. */
  allocated(id: SystemId): number {
    if (id === 'guns') return this.guns.reduce((n, g) => n + (g.powered ? g.def.hands : 0), 0);
    return this.systems.get(id)?.hands ?? 0;
  }

  /** Effective working level of a system. */
  level(id: SystemId): number {
    const s = this.systems.get(id);
    if (!s) return 0;
    if (id === 'helm') return this.isSwamped(id) ? 0 : this.capacity(id);
    if (id === 'pumps') return this.allocated(id);
    return this.isSwamped(id) ? 0 : this.allocated(id);
  }

  freeHands(): number {
    let used = this.allocated('guns');
    for (const id of HANDS_SYSTEMS) used += this.allocated(id);
    return this.def.hands - used;
  }

  /** Move hands onto (+) or off (-) a system. Returns false when not possible. */
  addHands(id: SystemId, delta: number): boolean {
    const s = this.systems.get(id);
    if (!s || !HANDS_SYSTEMS.includes(id)) return false;
    const next = s.hands + delta;
    if (next < 0 || next > this.capacity(id)) return false;
    if (delta > 0 && this.freeHands() < delta) return false;
    s.hands = next;
    return true;
  }

  /** Power a gun on or off (toggles when `on` is omitted). */
  toggleGun(index: number, on?: boolean): boolean {
    const g = this.guns[index];
    if (!g) return false;
    const want = on ?? !g.powered;
    if (want === g.powered) return true;
    if (want) {
      if (this.freeHands() < g.def.hands) return false;
      if (this.allocated('guns') + g.def.hands > this.capacity('guns')) return false;
    }
    g.powered = want;
    return true;
  }

  damageSystem(id: SystemId, amount: number): void {
    const s = this.systems.get(id);
    if (!s || amount <= 0) return;
    s.damage = Math.min(s.max, s.damage + amount);
    s.repair = 0;
    this.clampToCapacity();
  }

  /** After damage, take hands off systems that no longer have the bars for them. */
  clampToCapacity(): void {
    for (const id of HANDS_SYSTEMS) {
      const s = this.systems.get(id);
      if (s) s.hands = Math.min(s.hands, this.capacity(id));
    }
    for (let i = this.guns.length - 1; i >= 0 && this.allocated('guns') > this.capacity('guns'); i--) {
      this.guns[i].powered = false;
    }
  }

  crewInRoom(roomId: string): Crew[] {
    return this.crew.filter((c) => c.room === roomId && c.waypoints.length === 0);
  }

  isManned(id: SystemId): boolean {
    const s = this.systems.get(id);
    return !!s && this.crew.some((c) => c.room === s.room && c.task === 'man');
  }

  /** Percent chance an incoming ball misses. */
  evasion(): number {
    if (this.level('helm') <= 0 || !this.isManned('helm')) return 0;
    const sails = this.level('sails');
    if (sails <= 0) return 0;
    let ev = sails * 6 + this.def.speedBonus + (this.level('helm') - 1) * 4;
    if (this.isManned('sails')) ev += 5;
    return Math.max(0, Math.min(60, ev));
  }

  /** Escape charge rate in percent per second (0 when the ship cannot get under way). */
  escapeRate(): number {
    if (this.level('helm') <= 0 || !this.isManned('helm')) return 0;
    const sails = this.level('sails');
    if (sails <= 0) return 0;
    let rate = 0.8 + sails * 0.5 + this.def.speedBonus * 0.03;
    if (this.isManned('sails')) rate *= 1.2;
    return Math.max(0.2, rate);
  }

  totalArea(): number {
    let a = 0;
    for (const r of this.rooms.values()) a += r.def.w * r.def.h;
    return a;
  }

  /** Fraction (0..1) of the ship's volume full of water. */
  floodFraction(): number {
    let vol = 0;
    for (const r of this.rooms.values()) vol += r.water * r.def.w * r.def.h;
    return vol / (this.totalArea() * 100);
  }

  /** A tile in the room not taken by any crew member's reserved slot. */
  freeSlot(roomId: string, ignore?: Crew): Vec | null {
    const d = this.room(roomId).def;
    for (let y = d.y; y < d.y + d.h; y++) {
      for (let x = d.x; x < d.x + d.w; x++) {
        if (!this.crew.some((c) => c !== ignore && c.slot.x === x && c.slot.y === y)) return { x, y };
      }
    }
    return null;
  }

  roomCenter(roomId: string): Vec {
    const d = this.room(roomId).def;
    return { x: d.x + d.w / 2, y: d.y + d.h / 2 };
  }
}
