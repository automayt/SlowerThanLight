import type { BattleEvent } from './events';
import { ignite } from './Hazards';
import type { Rng } from './rng';
import type { Ship } from './Ship';
import type { ShotType } from './types';

/**
 * Critical hits: now and then a ball finds something that matters, and a fight turns on it. What happens depends on
 * the room struck. Rolled once for every ball that strikes home (not one that glances off or is stopped).
 */
export type CritKind = 'magazine' | 'powder' | 'mast' | 'helmsman' | 'bulwarks' | 'waterline' | 'splinters';

/** Chance a round or hot ball striking home lands a critical hit. */
export const CRIT_CHANCE = 0.07;
/** A ball into the powder room: far likelier to set it off. */
export const MAGAZINE_CRIT = 0.2;
/** Chain is aimed at the rigging: it can bring a mast down, but does nothing critical elsewhere. */
export const CHAIN_MAST_CRIT = 0.12;
/** Grape sweeping the quarterdeck can cut down the helmsman. */
export const GRAPE_HELM_CRIT = 0.12;

/** What each kind of critical hit does. */
export const MAGAZINE_HULL = 3;
export const MAGAZINE_CREW = 30;
export const POWDER_CREW = 15;
export const MAST_ESCAPE = 50;
export const MAST_CREW = 20;
export const HELMSMAN_HP = 40;
export const WATERLINE_WATER = 40;
export const SPLINTER_CREW = 25;

/** The chance a ball of this shot striking this room is a critical hit. */
export function critChance(ship: Ship, roomId: string, shot: ShotType): number {
  const sys = ship.room(roomId).def.system;
  if (shot === 'chain') return sys === 'sails' ? CHAIN_MAST_CRIT : 0;
  if (shot === 'grape') return sys === 'helm' ? GRAPE_HELM_CRIT : 0;
  return roomId === 'magazine' ? MAGAZINE_CRIT : CRIT_CHANCE;
}

/** Which critical hit a room suffers. */
export function critKind(ship: Ship, roomId: string): CritKind {
  if (roomId === 'magazine') return 'magazine';
  switch (ship.room(roomId).def.system) {
    case 'guns':
      return 'powder';
    case 'sails':
      return 'mast';
    case 'helm':
      return 'helmsman';
    case 'bulwarks':
      return 'bulwarks';
    case 'pumps':
      return 'waterline';
    default:
      return 'splinters';
  }
}

/**
 * Roll for a critical hit from a ball that has struck a room, and apply it. `mult` scales the chance (a raking volley).
 * Returns any extra hull damage it did.
 */
export function rollCrit(ship: Ship, roomId: string, shot: ShotType, rng: Rng, events: BattleEvent[], mult = 1): number {
  const chance = critChance(ship, roomId, shot) * mult;
  if (chance <= 0 || !rng.chance(chance)) return 0;
  return applyCrit(ship, roomId, critKind(ship, roomId), rng, events);
}

/** Make a critical hit happen. Returns the extra hull damage done. */
export function applyCrit(ship: Ship, roomId: string, kind: CritKind, rng: Rng, events: BattleEvent[]): number {
  const room = ship.room(roomId);
  const here = ship.crew.filter((c) => c.room === roomId);
  const hurt = (hp: number) => {
    for (const c of here) c.hp -= hp;
  };
  let hull = 0;
  let name: string | undefined;
  switch (kind) {
    case 'magazine':
      hull = Math.min(ship.hull, MAGAZINE_HULL);
      ship.hull -= hull;
      hurt(MAGAZINE_CREW);
      for (let i = 0; i < room.flames.length; i++) ignite(ship, room, rng, 60, events, i);
      break;
    case 'powder':
      ship.damageSystem('guns', 1);
      hurt(POWDER_CREW);
      ignite(ship, room, rng, 60, events);
      break;
    case 'mast':
      ship.damageSystem('sails', 1);
      ship.escape = Math.max(0, ship.escape - MAST_ESCAPE);
      hurt(MAST_CREW);
      break;
    case 'helmsman': {
      // Whoever has the wheel, else anyone of hers on the quarterdeck.
      const sys = room.def.system;
      const victim = (sys && ship.stationed(sys)) ?? here.find((c) => c.side === ship.side);
      if (victim) {
        victim.hp -= HELMSMAN_HP;
        name = victim.name;
      }
      break;
    }
    case 'bulwarks':
      ship.layers = 0;
      ship.layerCharge = 0;
      ship.damageSystem('bulwarks', 1);
      break;
    case 'waterline':
      if (!room.breach) {
        room.breach = true;
        room.breachProgress = 0;
        events.push({ t: 'breach', side: ship.side, room: roomId });
      }
      room.water = Math.min(100, room.water + WATERLINE_WATER);
      break;
    case 'splinters':
      hurt(SPLINTER_CREW);
      break;
  }
  events.push({ t: 'crit', side: ship.side, room: roomId, kind, ...(name ? { name } : {}) });
  return hull;
}
