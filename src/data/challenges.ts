/**
 * Hardships a captain can choose before sailing, for more renown. Each is a plain number the Run reads: none is
 * on unless chosen, so an ordinary voyage is unchanged.
 */
export interface ChallengeDef {
  id: string;
  name: string;
  /** What it does, for the toggle and its tip. */
  blurb: string;
  /** Extra share of the voyage's renown (0.25 = a quarter more). */
  renown: number;
  /** Columns a jump the fleet closes faster. */
  fleet?: number;
  /** Start with no gold at all. */
  noGold?: boolean;
  /** Provisions at the start, and room in the hold, taken away. */
  provisions?: number;
  hold?: number;
  /** Share of her hull she starts the voyage without (and can only win back with oak planking). */
  hull?: number;
}

export const CHALLENGES: ChallengeDef[] = [
  { id: 'hunted', name: 'The Admiralty’s Wrath', blurb: 'A price on your head: the fleet closes 0.15 columns faster every jump.', renown: 0.3, fleet: 0.15 },
  { id: 'pauper', name: 'An Empty Purse', blurb: 'You sail from Tortuga without a coin in the strongbox.', renown: 0.15, noGold: true },
  { id: 'rations', name: 'Short Rations', blurb: 'Four fewer provisions to start, and room for six fewer in the hold.', renown: 0.2, provisions: 4, hold: 6 },
  { id: 'leaky', name: 'A Leaky Old Tub', blurb: 'Rotten timbers: she sails with a quarter less hull.', renown: 0.3, hull: 0.25 },
];

export const CHALLENGE_IDS = CHALLENGES.map((c) => c.id);

export function challenge(id: string): ChallengeDef {
  const c = CHALLENGES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown challenge: ${id}`);
  return c;
}

/** The renown multiplier for a set of challenges: shares add (two quarter-shares make half again). */
export function challengeRenown(ids: readonly string[]): number {
  return 1 + ids.reduce((n, id) => n + challenge(id).renown, 0);
}
