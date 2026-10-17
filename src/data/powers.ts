import type { PowerId } from '../sim/types';

/** A power at sea: a crown, a people or a trade, with a long memory for what you do to its ships. */
export interface PowerDef {
  id: PowerId;
  name: string;
  /** What its people call it in a sentence: "the Crown", "Spain". */
  short: string;
  blurb: string;
  /** How it regards a fresh pirate crew out of Tortuga. */
  start: number;
  /** Ink colour for its line in the ledger. */
  color: string;
}

export const POWERS: Record<PowerId, PowerDef> = {
  crown: {
    id: 'crown',
    name: 'The Crown',
    short: 'the Crown',
    blurb: 'King George’s Navy, his governors and the privateers they hire. It hangs pirates, but a governor can be bought and an admiral can be persuaded to look elsewhere.',
    start: -40,
    color: '#e06a5a',
  },
  spain: {
    id: 'spain',
    name: 'Spain',
    short: 'Spain',
    blurb: 'Guarda costas and the treasure fleets of the Main. Spain hates England more than it hates you, and pays well for an enemy of its enemy.',
    start: -10,
    color: '#f2c14e',
  },
  france: {
    id: 'france',
    name: 'France',
    short: 'France',
    blurb: 'Corsairs out of Martinique and Saint-Malo. France will sign a letter of marque for anyone who sinks English ships.',
    start: 0,
    color: '#7fa7e8',
  },
  brethren: {
    id: 'brethren',
    name: 'The Brethren',
    short: 'the Brethren',
    blurb: 'The Brethren of the Coast: every pirate crew from Nassau to the Main. Brothers until there is gold to argue over.',
    start: 10,
    color: '#c9c9c9',
  },
  trade: {
    id: 'trade',
    name: 'The Merchants',
    short: 'the merchants',
    blurb: 'Merchant houses, Dutch traders and smugglers. They remember who robbed them and who let them by, and their money buys governors.',
    start: -10,
    color: '#9be37f',
  },
};

export const POWER_IDS = Object.keys(POWERS) as PowerId[];

export function power(id: PowerId): PowerDef {
  const p = POWERS[id];
  if (!p) throw new Error(`Unknown power: ${id}`);
  return p;
}

/**
 * How the powers regard each other: -1 sworn enemies, -0.5 rivals, 0.5 friends. Hurting a power pleases its
 * enemies and angers its friends (see Diplomacy.RIPPLE). Pairs not listed don't care.
 */
export const RELATIONS: [PowerId, PowerId, number][] = [
  ['crown', 'spain', -1],
  ['crown', 'france', -1],
  ['crown', 'brethren', -1],
  ['crown', 'trade', 0.5],
  ['spain', 'france', -0.5],
  ['spain', 'brethren', -0.5],
  ['trade', 'brethren', -0.5],
];

export function relation(a: PowerId, b: PowerId): number {
  if (a === b) return 1;
  return RELATIONS.find(([x, y]) => (x === a && y === b) || (x === b && y === a))?.[2] ?? 0;
}

/** Who holds each port: their opinion of you sets the prices and decides what the harbour will do for you. */
export const PORT_POWER: Record<string, PowerId> = {
  Nassau: 'brethren',
  'Port Royal': 'crown',
  'Saint-Pierre': 'france',
  Bridgetown: 'trade',
  Willemstad: 'trade',
  'Charles Town': 'trade',
  Havana: 'spain',
};

export function portPower(name: string): PowerId {
  return PORT_POWER[name] ?? 'trade';
}
