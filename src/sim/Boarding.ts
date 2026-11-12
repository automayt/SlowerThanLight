import { orderMove } from './Crew';
import type { BattleEvent } from './events';
import { findRoute } from './pathfinding';
import type { Rng } from './rng';
import type { Crew, RoomState, Ship } from './Ship';
import { COMBAT_BONUS, rank, train } from './Skills';
import type { Side } from './types';

/** Seconds to swing or row across to the other ship. */
export const BOARD_TIME = 4;
/** HP per second one fighter deals in hand-to-hand fighting. */
export const MELEE_DPS = 4;
/** Defenders fight harder on their own deck: they know every ladder and have the cover. */
export const DEFENDER_BONUS = 1.25;
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

/** How hard a ship is to lay alongside: her speed, and more if her captain keeps the range while her sails are whole. */
export function evadeSpeed(ship: Ship): number {
  const sails = ship.system('sails');
  return grappleSpeed(ship) + (ship.keepsRange && sails && sails.damage === 0 ? 1 : 0);
}

/** How well a ship closes to grapple: her speed, and more if her captain means to board. */
export function closeSpeed(ship: Ship): number {
  return grappleSpeed(ship) + (ship.closesIn ? 1 : 0);
}

/**
 * Whether `from` can lay alongside `to` and grapple: she must be no faster than you,
 * or nobody must be at her helm to steer away.
 */
export function canGrapple(from: Ship, to: Ship): boolean {
  return evadeSpeed(to) <= closeSpeed(from) || !to.isManned('helm');
}

/** How hard one fighter hits hand to hand: their ship's fighting stock and their brawling rank. */
export function meleeStrength(c: Crew): number {
  return c.melee * (1 + rank(c, 'combat') * COMBAT_BONUS);
}

/** A rough measure of a party's fighting worth for the odds shown to the player: strength weighted by health. */
export function partyStrength(crew: Crew[], defending = false): number {
  return crew.reduce((sum, c) => sum + meleeStrength(c) * Math.max(0, c.hp / c.maxHp), 0) * (defending ? DEFENDER_BONUS : 1);
}

/** Crew standing (not walking) in a room, split into the ship's own people and boarders. */
export function roomParties(ship: Ship, roomId: string): { own: Crew[]; boarders: Crew[] } {
  const here = ship.crew.filter((c) => c.room === roomId && c.waypoints.length === 0);
  return { own: here.filter((c) => c.side === ship.side), boarders: here.filter((c) => c.side !== ship.side) };
}

// --- The melee -------------------------------------------------------------------------------------------------

/** Seconds between one fighter's blows, before their brawling rank quickens them. */
export const SWING_TIME = 1.2;
/** How much quicker each brawling rank swings. */
export const SWING_RANK = 0.06;
/** Chance a blow is parried, and how much each of the defender's brawling ranks adds. */
export const PARRY_CHANCE = 0.2;
export const PARRY_RANK = 0.07;
/** Chance a blow lands heavy, how much each of the attacker's brawling ranks adds, and how much harder it hits. */
export const CRIT_CHANCE = 0.08;
export const CRIT_RANK = 0.06;
export const CRIT_MULT = 2.5;
/** What an ordinary blow is worth on average (a parry is nothing, a heavy blow CRIT_MULT): blows are sized by it to keep MELEE_DPS. */
const BLOW_MEAN = 1 - PARRY_CHANCE - CRIT_CHANCE + CRIT_CHANCE * CRIT_MULT;
/** Each fighter's first act in a fight is a pistol shot: how long to draw and aim, its chance, a marksman's, and its ball. */
export const PISTOL_DRAW = 0.4;
export const PISTOL_HIT = 0.45;
export const MARKSMAN_HIT = 0.7;
export const PISTOL_DAMAGE = 22;
/** Marines and soldiers are drilled with the firelock. Known by their rank, so no data has to say it. */
const MARKSMAN = /^(Marine|Sgt\.|Marksman|Soldado|Cabo)\b/;
/** A side down to this share of the most fighters it has had in the fight, and outmatched this far, may break. */
export const ROUT_LOSS = 0.5;
export const ROUT_ODDS = 0.6;
/** Chance a wavering side breaks at each check, and seconds between checks. */
export const ROUT_CHANCE = 0.35;
export const ROUT_CHECK = 1;
/** Seconds broken fighters stay shaken: their captain won't send them straight back in. */
export const SHAKEN_TIME = 8;

export type BlowKind = 'hit' | 'parry' | 'crit' | 'shot' | 'miss';

/** Seconds between a fighter's blows. */
export function swingTime(c: Crew): number {
  return SWING_TIME / (1 + rank(c, 'combat') * SWING_RANK);
}

/** Chance this fighter turns a blow aside. */
export function parryChance(c: Crew): number {
  return PARRY_CHANCE + rank(c, 'combat') * PARRY_RANK;
}

/** Chance this fighter's blow lands heavy. */
export function critChance(c: Crew): number {
  return CRIT_CHANCE + rank(c, 'combat') * CRIT_RANK;
}

/** Whether a fighter is a drilled shot (marines and soldiers). */
export function marksman(c: Crew): boolean {
  return MARKSMAN.test(c.name);
}

/** Chance this fighter's opening pistol shot finds its mark. */
export function pistolChance(c: Crew): number {
  return marksman(c) ? MARKSMAN_HIT : PISTOL_HIT;
}

/** An Expert brawler never breaks, and steadies everyone of theirs beside them. */
export function steady(c: Crew): boolean {
  return rank(c, 'combat') >= 2;
}

/** What the melee needs from the battle around it. */
export interface MeleeOptions {
  /** The battle's random numbers: every roll comes from here, in a fixed order, so a fight replays exactly. */
  rng: Rng;
  /** How hard each side fights (Cold steel!). */
  fury?: Partial<Record<Side, number>>;
  /** Send a broken boarder home over the side; false if they can't go. */
  flee?: (c: Crew) => boolean;
  /** Name of the ship the boarders came from, for the log. */
  foeName?: string;
}

/** Forget a fighter's part in a melee: they are out of it (walked off, crossed over, or the fight is won). */
function disengage(c: Crew): void {
  delete c.foe;
  delete c.swing;
  delete c.fired;
}

/**
 * Pair the fighters of a room off. Anyone already engaged with a foe still standing keeps fighting them; everyone else
 * takes the foe with the fewest on them already (one who is fighting them first, then the weakest), so a crowd
 * spreads itself over the enemy and the extra hands gang up.
 */
function pairUp(fighters: Crew[], rng: Rng): void {
  const byId = new Map(fighters.map((c) => [c.id, c]));
  const attackers = new Map<number, number>();
  const valid = (c: Crew) => {
    const f = c.foe === undefined ? undefined : byId.get(c.foe);
    return !!f && f.side !== c.side && f.hp > 0;
  };
  for (const c of fighters) if (valid(c)) attackers.set(c.foe!, (attackers.get(c.foe!) ?? 0) + 1);
  for (const c of fighters) {
    if (c.hp <= 0 || valid(c)) continue;
    let best: Crew | null = null;
    let bestKey = Infinity;
    for (const f of fighters) {
      if (f.side === c.side || f.hp <= 0) continue;
      const key = (attackers.get(f.id) ?? 0) * 1000 + (f.foe === c.id ? 0 : 500) + f.hp;
      if (key < bestKey) {
        best = f;
        bestKey = key;
      }
    }
    if (!best) continue;
    const fresh = c.swing === undefined;
    c.foe = best.id;
    attackers.set(best.id, (attackers.get(best.id) ?? 0) + 1);
    // Newly in the fight: draw a pistol first (a moment's aim, staggered so a party doesn't fire as one).
    if (fresh) c.swing = PISTOL_DRAW + rng.next() * 0.5;
  }
}

/** One fighter's act: their pistol if it is still loaded, otherwise a blow of steel. */
function strike(ship: Ship, c: Crew, foe: Crew, opts: MeleeOptions, events: BattleEvent[]): void {
  const { rng } = opts;
  let kind: BlowKind;
  let dmg = 0;
  if (!c.fired) {
    c.fired = true;
    kind = rng.chance(pistolChance(c)) ? 'shot' : 'miss';
    if (kind === 'shot') dmg = PISTOL_DAMAGE;
  } else {
    // Sized so a fighter's blows average out to the steady MELEE_DPS of their strength (more with rank).
    const blow = (meleeStrength(c) * MELEE_DPS * SWING_TIME * (c.side === ship.side ? DEFENDER_BONUS : 1) * (opts.fury?.[c.side] ?? 1)) / BLOW_MEAN;
    const r = rng.next();
    const parry = parryChance(foe);
    kind = r < parry ? 'parry' : r < parry + critChance(c) ? 'crit' : 'hit';
    dmg = kind === 'parry' ? 0 : kind === 'crit' ? blow * CRIT_MULT : blow;
  }
  c.swing = (c.swing ?? 0) + swingTime(c);
  foe.hp -= dmg;
  events.push({ t: 'blow', side: ship.side, room: c.room, from: c.id, to: foe.id, dmg: Math.round(dmg * 10) / 10, kind });
}

/** Where a broken defender can fall back to: the nearest room of her ship with no boarders in it or bound for it. */
function fallBack(ship: Ship, c: Crew): string | null {
  const held = new Set(ship.boarders().map((b) => (b.waypoints.length ? b.waypoints[b.waypoints.length - 1].room : b.room)));
  let best: string | null = null;
  let bestLen = Infinity;
  for (const id of ship.rooms.keys()) {
    if (id === c.room || held.has(id) || !ship.freeSlot(id, c)) continue;
    const route = findRoute(ship.doors, c.room, id);
    if (route && route.length < bestLen) {
      best = id;
      bestLen = route.length;
    }
  }
  return best;
}

/**
 * Test one side's nerve in a melee: down to half the fighters it has had in this fight and clearly outmatched, it may
 * break. Boarders run for their own ship; defenders fall back to another room. Nobody breaks with an Expert brawler
 * beside them, and those with nowhere to run fight on. Returns whether they broke.
 */
function testNerve(ship: Ship, room: RoomState, party: Crew[], foes: Crew[], peak: number, opts: MeleeOptions, events: BattleEvent[]): boolean {
  const defending = party[0].side === ship.side;
  if (party.length > peak * (1 - ROUT_LOSS) || party.some(steady)) return false;
  if (partyStrength(party, defending) >= ROUT_ODDS * partyStrength(foes, !defending)) return false;
  if (!opts.rng.chance(ROUT_CHANCE)) return false;
  let fled = 0;
  for (const c of party) {
    if (defending) {
      const to = fallBack(ship, c);
      if (!to || !orderMove(ship, c, to)) continue;
    } else if (!opts.flee?.(c)) continue;
    disengage(c);
    c.shaken = SHAKEN_TIME;
    fled++;
  }
  if (!fled) return false;
  const broke = party[0].side;
  events.push({ t: 'rout', side: ship.side, room: room.def.id, broke, count: fled });
  const theirs = broke === 'enemy';
  const text = defending
    ? theirs
      ? `Her crew break and fall back from the ${room.def.name}!`
      : `Our people break and fall back from the ${room.def.name}!`
    : theirs
      ? `${opts.foeName ?? 'The enemy'}'s boarders break and run!`
      : 'Our boarders break and run for the ship!';
  events.push({ t: 'log', side: ship.side, text });
  return true;
}

/**
 * Hand-to-hand fighting in every contested room, and sabotage by unopposed boarders. Fighters pair off and trade
 * blows on their own clocks (a pistol shot first), each blow rolled hit, parried or heavy; a side that is losing
 * badly may break and run.
 */
export function updateBoarding(ship: Ship, dt: number, events: BattleEvent[], opts: MeleeOptions): void {
  for (const c of ship.crew) {
    if (c.shaken !== undefined && (c.shaken -= dt) <= 0) delete c.shaken;
  }
  if (!ship.crew.some((c) => c.side !== ship.side)) {
    for (const c of ship.crew) if (c.swing !== undefined) disengage(c);
    for (const r of ship.rooms.values()) r.fray = null;
    return;
  }
  const fighting = new Set<Crew>();
  for (const room of ship.rooms.values()) {
    const { own, boarders } = roomParties(ship, room.def.id);
    if (!boarders.length || !own.length) room.fray = null;
    if (!boarders.length) continue;
    if (own.length) {
      const fray = (room.fray ??= { own: 0, boarders: 0, check: ROUT_CHECK });
      fray.own = Math.max(fray.own, own.length);
      fray.boarders = Math.max(fray.boarders, boarders.length);
      const fighters = [...own, ...boarders];
      fighters.sort((a, b) => ship.crew.indexOf(a) - ship.crew.indexOf(b));
      pairUp(fighters, opts.rng);
      const byId = new Map(fighters.map((c) => [c.id, c]));
      for (const c of fighters) {
        fighting.add(c);
        c.task = 'fight';
        train(c, 'combat', dt, events);
        const foe = c.foe === undefined ? undefined : byId.get(c.foe);
        if (!foe || c.hp <= 0) continue;
        c.swing = (c.swing ?? 0) - dt;
        if (c.swing <= 0 && foe.hp > 0) strike(ship, c, foe, opts, events);
      }
      room.sabotage = 0;
      fray.check -= dt;
      if (fray.check <= 0) {
        fray.check += ROUT_CHECK;
        const ownUp = own.filter((c) => c.hp > 0);
        const boardersUp = boarders.filter((c) => c.hp > 0);
        if (ownUp.length && boardersUp.length) {
          if (testNerve(ship, room, boardersUp, ownUp, fray.boarders, opts, events)) room.fray = null;
          else if (testNerve(ship, room, ownUp, boardersUp, fray.own, opts, events)) room.fray = null;
        }
      }
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
  // Out of the fight (walked off, or the room is won): their pistol is loaded again for the next one.
  for (const c of ship.crew) if (!fighting.has(c) && c.swing !== undefined) disengage(c);
}

/** HP a boarder loses climbing through boarding nets. */
export const NET_DAMAGE = 30;

/** Put an arriving crew member into a room of a ship (the nearest room with a free tile if that room is full). */
export function land(ship: Ship, crew: Crew, roomId: string): void {
  if (ship.boardingNets && crew.side !== ship.side) crew.hp = Math.max(1, crew.hp - NET_DAMAGE);
  const room = ship.rooms.has(roomId) && ship.freeSlot(roomId) ? roomId : nearestFreeRoom(ship, roomId) ?? roomId;
  const slot = ship.freeSlot(room) ?? { x: ship.room(room).def.x, y: ship.room(room).def.y };
  crew.room = room;
  crew.slot = slot;
  crew.pos = { x: slot.x + 0.5, y: slot.y + 0.5 };
  crew.waypoints = [];
  crew.task = 'idle';
  disengage(crew);
  ship.crew.push(crew);
}

/** The room with a free tile whose middle is nearest the middle of `roomId` (ties to the first), if any. */
function nearestFreeRoom(ship: Ship, roomId: string): string | undefined {
  const mid = (id: string) => {
    const d = ship.room(id).def;
    return { x: d.x + d.w / 2, y: d.y + d.h / 2 };
  };
  const at = ship.rooms.has(roomId) ? mid(roomId) : { x: ship.width / 2, y: ship.height / 2 };
  let best: string | undefined;
  let bestD = Infinity;
  for (const id of ship.rooms.keys()) {
    if (!ship.freeSlot(id)) continue;
    const m = mid(id);
    const d = (m.x - at.x) ** 2 + (m.y - at.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}
