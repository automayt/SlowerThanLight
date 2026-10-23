import { Rng } from './rng';
import type { ShotType, SystemId } from './types';

/**
 * The temper of an enemy captain: how she fights. One is picked for each encounter from the pool her kind of ship
 * draws on, from the battle's seed (so a co-op client builds the same captain the server has).
 */
export type TemperId = 'steady' | 'boarder' | 'gunner' | 'coward' | 'firebrand';

export interface TemperDef {
  /** Short title for the HUD. */
  name: string;
  /** What to expect from her, for the log. */
  blurb: string;
  /** The same in a few words, for the HUD. */
  short: string;
  /** Her captain's hail as the fight opens. */
  hails: string[];
  /** Systems her favoured guns are laid on: the guns loaded with her favourite shot, or else the first `aimGuns`. */
  aim?: SystemId[];
  aimGuns?: number;
  /** Shot she loads in some of her guns, and how many of them. */
  shot?: { type: ShotType; guns: number };
  /** Loading speed by shot (a firebrand's furnace keeps hot shot coming). */
  shotRate?: Partial<Record<ShotType, number>>;
  /** Boarding: the smallest party she sends, the first moment she thinks of it, and the pause between parties. */
  board?: { size: number; first: number; every: number; odds: number };
  /** Never sends boarders. */
  noBoarding?: boolean;
  /** She keeps the range: harder to grapple while her sails are whole. */
  keepsRange?: boolean;
  /** She closes in: easier for her to grapple you. */
  closesIn?: boolean;
  /** Less likely to miss (percent off her guns' inaccuracy). */
  aimBonus?: number;
  /** Fleeing and striking: added to her captain's thresholds and surrender chance. */
  fleeAt?: number;
  surrender?: number;
  surrenderAt?: number;
}

export const TEMPERS: Record<TemperId, TemperDef> = {
  steady: {
    name: 'Steady',
    blurb: 'a steady hand: fights by the book',
    short: 'fights by the book',
    hails: ['Heave to and strike, in the King’s name!', 'Run out the guns. Steady, lads.', 'You’ll find us ready for you.'],
  },
  boarder: {
    name: 'Born Boarder',
    blurb: 'a born boarder: she closes fast and sends her cutthroats over the side',
    short: 'closes fast to board you',
    hails: ['Grapnels ready! We’ll take her with steel!', 'Over the side, boys, and no quarter!', 'Lay us alongside. I want her deck.'],
    shot: { type: 'grape', guns: 1 },
    aim: ['guns'],
    board: { size: 2, first: 10, every: 36, odds: 0.6 },
    closesIn: true,
  },
  gunner: {
    name: 'Long Gun',
    blurb: 'a long-gun captain: her guns shoot true, and she keeps out of grappling range while her sails are whole',
    short: 'shoots true, keeps her range',
    hails: ['Keep her at long range. Lay the guns true.', 'Steady, Mr Pike. Make every ball tell.', 'We’ll not let that rabble near us.'],
    noBoarding: true,
    keepsRange: true,
    aimBonus: 5,
  },
  coward: {
    name: 'Faint-heart',
    blurb: 'a faint-hearted captain: quick to run, quicker to strike',
    short: 'quick to run or strike',
    hails: ['Make sail! Make all sail!', 'Oh Lord, it’s pirates. Hands to the braces!', 'Perhaps they only want the cargo…'],
    fleeAt: 0.25,
    surrender: 0.25,
    surrenderAt: 0.15,
  },
  firebrand: {
    name: 'Firebrand',
    blurb: 'a firebrand: heated shot into your gun deck and rigging',
    short: 'heated shot, fast',
    hails: ['Heat the shot! Let her burn!', 'Fire and brimstone, boys! Light her up!', 'I’ll see your sails in flames.'],
    shot: { type: 'hot', guns: 2 },
    shotRate: { hot: 1.3 },
    aim: ['guns', 'sails'],
  },
};

/** Which tempers each kind of enemy ship can sail under (by ship id). Unlisted ships are steady. */
const POOLS: Record<string, TemperId[]> = {
  cutter: ['steady', 'gunner'],
  merchant: ['coward', 'steady'],
  smuggler: ['coward', 'firebrand'],
  privateer: ['gunner', 'boarder', 'firebrand'],
  corsair: ['boarder', 'firebrand'],
  rival: ['boarder', 'gunner', 'firebrand'],
  guarda: ['boarder', 'steady'],
  galleon: ['steady', 'gunner'],
  sloop: ['gunner', 'steady'],
  frigate: ['steady'],
};

export function temperPool(shipId: string): TemperId[] {
  return POOLS[shipId] ?? ['steady'];
}

/** The temper of the captain of a ship of this kind in a battle with this seed. Uses its own stream, not the battle's. */
export function pickTemper(shipId: string, seed: number): TemperId {
  return new Rng((seed ^ 0x2c1b3c6d) >>> 0).pick(temperPool(shipId));
}
