import type { PowerId } from '../sim/types';

/** Who commands: each captain brings one gift to the voyage. Some must be earned with renown first. */
export interface CaptainDef {
  id: string;
  name: string;
  blurb: string;
  /** Renown needed before this captain will sail with you (see save.ts renown). */
  renown: number;
  /** Gun loading speed, relative to normal. */
  reload?: number;
  /** Hand-to-hand strength of the crew, relative to normal. */
  melee?: number;
  /** Columns taken off the fleet's advance each jump. */
  fleet?: number;
  /** A foul wind costs no extra day's provisions. */
  weatherwise?: boolean;
  /** Standing with every power at the start, and what bribes cost relative to normal. */
  standing?: number;
  bribe?: number;
  /** Provisions and gold at the start. */
  provisions?: number;
  gold?: number;
  /** Extra chance that false colours fool a hostile ship. */
  colours?: number;
  /** A story flag set at the start (a letter of marque), and standing changes that come with it. */
  flag?: string;
  shift?: Partial<Record<PowerId, number>>;
}

export const CAPTAINS: CaptainDef[] = [
  { id: 'rover', name: 'The Sea Rover', blurb: 'No special gifts and no special debts. The sea will decide.', renown: 0 },
  { id: 'gunner', name: 'The Old Gunner', blurb: 'Thirty years on a gun deck: every gun loads 10% faster.', renown: 0, reload: 1.1 },
  { id: 'navigator', name: 'The Navigator', blurb: 'Reads wind and current like a book: the fleet closes a little slower, and a foul wind costs no extra day.', renown: 0, fleet: 0.08, weatherwise: true },
  { id: 'gentleman', name: 'The Gentleman Pirate', blurb: 'Silk, manners and a reputation: every power thinks 10 better of you, and bribes cost a quarter less.', renown: 30, standing: 10, bribe: 0.75 },
  { id: 'smuggler', name: 'The Smuggler', blurb: 'Knows every cove and every flag: 6 more provisions to start, and false colours fool a ship 20% more often.', renown: 60, provisions: 6, colours: 0.2 },
  { id: 'bosun', name: 'The Hard Bosun', blurb: 'Rose from the forecastle with a rope’s end: the crew fight 20% harder hand to hand.', renown: 100, melee: 1.2 },
  { id: 'privateer', name: 'The Privateer', blurb: 'Sails under a French letter of marque: France is friendly, the Crown less so, and 40 gold from the commission.', renown: 150, flag: 'marque', shift: { france: 30, crown: -10 }, gold: 40 },
];

export function captain(id: string): CaptainDef {
  const c = CAPTAINS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown captain: ${id}`);
  return c;
}
