import { weapon } from '../data/weapons';
import { buildDoors, type Door } from './pathfinding';
import type { RoomDef, ShipDef, ShotType, Side, SystemId, Vec, WeaponDef } from './types';
import { HANDS_SYSTEMS } from './types';
import { rank, SEAMANSHIP_EVASION, type SkillXp } from './Skills';

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
  /** Progress (0..100) of unopposed boarders wrecking this room's system. */
  sabotage: number;
}

export interface SystemState {
  id: SystemId;
  room: string;
  max: number;
  damage: number;
  /** Hands assigned (unused for helm and guns). */
  hands: number;
  /** Hands the captain asked for; restored automatically after repairs. */
  wanted: number;
  /** 0..100 toward repairing one damage point. */
  repair: number;
}

export interface GunState {
  def: WeaponDef;
  powered: boolean;
  /** Captain wants this gun crewed; it is re-powered automatically after repairs. */
  wanted: boolean;
  /** Seconds loaded so far. */
  charge: number;
  target: string | null;
  shot: ShotType;
}

export type CrewTask = 'moving' | 'fire' | 'breach' | 'repair' | 'man' | 'fight' | 'sabotage' | 'idle';

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
  /** Hand-to-hand fighting strength, from the ship they signed on with. */
  melee: number;
  /** Experience per skill (player crew only gain it). */
  xp: SkillXp;
}

/** A crew member as remembered between battles. */
export interface CrewRecord {
  name: string;
  hp: number;
  home: string;
  /** Experience per skill; missing for green hands. */
  xp?: SkillXp;
}

/** Wear and tear a ship carries from one encounter to the next. */
export interface ShipCondition {
  hull: number;
  crew: CrewRecord[];
  /** Damage points per system. */
  damage: Partial<Record<SystemId, number>>;
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
  /** Loading speed multiplier for every gun (difficulty scales the enemy's). */
  reloadRate = 1;
  /** "Make sail" escape charge, 0..100. */
  escape = 0;
  /** Bounding size in tiles. */
  readonly width: number;
  readonly height: number;

  constructor(def: ShipDef, side: Side, condition?: ShipCondition) {
    this.def = def;
    this.side = side;
    this.hull = condition ? Math.max(1, Math.min(def.hull, condition.hull)) : def.hull;
    this.doors = buildDoors(def.rooms);
    this.width = Math.max(...def.rooms.map((r) => r.x + r.w));
    this.height = Math.max(...def.rooms.map((r) => r.y + r.h));

    for (const r of def.rooms) {
      this.rooms.set(r.id, { def: r, fire: 0, burn: 0, water: 0, breach: false, breachProgress: 0, sabotage: 0 });
      if (r.system) {
        const max = def.systems[r.system] ?? 1;
        this.systems.set(r.system, { id: r.system, room: r.id, max, damage: 0, hands: 0, wanted: 0, repair: 0 });
      }
    }

    this.guns = def.guns.map((g) => ({
      def: weapon(g.weapon),
      powered: false,
      wanted: false,
      charge: 0,
      target: null,
      shot: g.shot ?? 'round',
    }));

    const roster: CrewRecord[] = condition?.crew ?? def.crew.map((c) => ({ name: c.name, hp: 100, home: c.room }));
    for (const c of roster) {
      // Hired hands without a known station bunk wherever there is space.
      const room = this.rooms.has(c.home) && this.freeSlot(c.home) ? c.home : [...this.rooms.keys()].find((id) => this.freeSlot(id));
      const slot = room && this.freeSlot(room);
      if (!room || !slot) throw new Error(`No room for ${c.name} in ${def.id}/${c.home}`);
      this.crew.push({
        id: nextCrewId++,
        name: c.name,
        side,
        hp: Math.max(1, Math.min(100, c.hp)),
        maxHp: 100,
        room,
        home: room,
        pos: { x: slot.x + 0.5, y: slot.y + 0.5 },
        slot,
        waypoints: [],
        task: 'idle',
        melee: def.melee ?? 1,
        xp: { ...(c.xp ?? {}) },
      });
    }

    if (condition) {
      for (const [id, dmg] of Object.entries(condition.damage) as [SystemId, number][]) {
        const sys = this.systems.get(id);
        if (sys) sys.damage = Math.max(0, Math.min(sys.max, dmg));
      }
    }

    this.autoAssignHands();
  }

  /** Snapshot of hull, surviving crew and system damage to carry into the next encounter. */
  condition(): ShipCondition {
    const damage: Partial<Record<SystemId, number>> = {};
    for (const s of this.systems.values()) if (s.damage > 0) damage[s.id] = s.damage;
    return {
      hull: Math.max(0, this.hull),
      crew: this.own().filter((c) => c.hp > 0).map((c) => ({ name: c.name, hp: Math.round(c.hp), home: c.home, ...(Object.keys(c.xp).length ? { xp: { ...c.xp } } : {}) })),
      damage,
    };
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
    s.wanted = next;
    return true;
  }

  /** Power a gun on or off (toggles when `on` is omitted). */
  toggleGun(index: number, on?: boolean): boolean {
    const g = this.guns[index];
    if (!g) return false;
    const want = on ?? !g.powered;
    if (want === g.powered) {
      g.wanted = want;
      return true;
    }
    if (want && !this.canPower(index)) return false;
    g.powered = want;
    g.wanted = want;
    return true;
  }

  private canPower(index: number): boolean {
    const g = this.guns[index];
    return this.freeHands() >= g.def.hands && this.allocated('guns') + g.def.hands <= this.capacity('guns');
  }

  /** Put hands back where the captain wanted them, as far as capacity and free hands allow. */
  restoreWanted(): void {
    this.guns.forEach((g, i) => {
      if (g.wanted && !g.powered && this.canPower(i)) g.powered = true;
    });
    for (const id of HANDS_SYSTEMS) {
      const s = this.systems.get(id);
      while (s && s.hands < s.wanted && s.hands < this.capacity(id) && this.freeHands() > 0) s.hands++;
    }
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

  /** This ship's own crew aboard her (not enemy boarders). */
  own(): Crew[] {
    return this.crew.filter((c) => c.side === this.side);
  }

  /** Enemy boarders aboard this ship. */
  boarders(): Crew[] {
    return this.crew.filter((c) => c.side !== this.side);
  }

  /** Own crew standing in a room. */
  crewInRoom(roomId: string): Crew[] {
    return this.crew.filter((c) => c.side === this.side && c.room === roomId && c.waypoints.length === 0);
  }

  isManned(id: SystemId): boolean {
    return !!this.stationed(id);
  }

  /** The crew member manning a system's station, if anyone is. */
  stationed(id: SystemId): Crew | undefined {
    const s = this.systems.get(id);
    return s && this.crew.find((c) => c.side === this.side && c.room === s.room && c.task === 'man');
  }

  /** Percent chance an incoming ball misses. */
  evasion(): number {
    if (this.level('helm') <= 0 || !this.isManned('helm')) return 0;
    const sails = this.level('sails');
    if (sails <= 0) return 0;
    let ev = sails * 6 + this.def.speedBonus + (this.level('helm') - 1) * 4 + rank(this.stationed('helm'), 'seamanship') * SEAMANSHIP_EVASION;
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
