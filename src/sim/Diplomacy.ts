import { POWER_IDS, power, relation } from '../data/powers';
import type { OutcomeKind } from './Battle';
import type { PowerId } from './types';

/** How a power regards you, from -100 (they want you hanged) to 100 (they would sail into the guns with you). */
export type Standing = Record<PowerId, number>;

export const STANDING_MIN = -100;
export const STANDING_MAX = 100;

export type TierId = 'feud' | 'hostile' | 'wary' | 'friendly' | 'allied';

/** Opinion bands, lowest first: each starts at `min`. */
export const TIERS: { id: TierId; name: string; min: number; blurb: string }[] = [
  { id: 'feud', name: 'Blood feud', min: STANDING_MIN, blurb: 'Their ships attack on sight and will not parley or be bought; their ports gouge you and will not sign on crew.' },
  { id: 'hostile', name: 'Hostile', min: -60, blurb: 'Their warships attack. A parley seldom works, but a bribe usually does. Their ports charge more.' },
  { id: 'wary', name: 'Wary', min: -20, blurb: 'Their warships may let you pass. Fair prices in their ports.' },
  { id: 'friendly', name: 'Friendly', min: 20, blurb: 'Their ships hail you as a friend and trade with you. Their ports give a discount.' },
  { id: 'allied', name: 'Allied', min: 60, blurb: 'Their captains will sail in company and fight beside you. Their ports give a larger discount.' },
];

export function tierOf(value: number): TierId {
  let out: TierId = 'feud';
  for (const t of TIERS) if (value >= t.min) out = t.id;
  return out;
}

export function tierName(id: TierId): string {
  return TIERS.find((t) => t.id === id)!.name;
}

const TIER_PHRASE: Record<TierId, string> = { feud: 'out for your blood', hostile: 'hostile', wary: 'wary of you', friendly: 'friendly', allied: 'your ally' };
const PLURAL = new Set<PowerId>(['brethren', 'trade']);

const RANK: Record<TierId, number> = { feud: 0, hostile: 1, wary: 2, friendly: 3, allied: 4 };

/** True if `a` is at least as warm as `b`. */
export function atLeast(a: TierId, b: TierId): boolean {
  return RANK[a] >= RANK[b];
}

export function freshStanding(): Standing {
  return Object.fromEntries(POWER_IDS.map((id) => [id, power(id).start])) as Standing;
}

/** Share of a change that spills onto the other powers, times how they regard the one you hurt or helped. */
export const RIPPLE = 0.4;

/** Port prices by how the harbour's masters regard you. */
export const PORT_PRICE: Record<TierId, number> = { feud: 1.5, hostile: 1.25, wary: 1, friendly: 0.9, allied: 0.8 };

/** Standing lost for starting a fight with a ship that would have let you be, and for turning on a friend. */
export const AGGRESSION = 6;
export const BETRAYAL = 20;

/** Standing lost for how the fight ended: sinking her is remembered longest, sparing a crew that struck least. */
export const OUTCOME_STANDING: Partial<Record<OutcomeKind, number>> = {
  enemySunk: -10,
  victory: -6,
  captured: -6,
  surrender: -3,
};

/**
 * Change one power's opinion and, with `ripple`, let the others react: its enemies warm to you when you hurt it,
 * its friends cool (and the other way round when you help it). Returns each power's actual change (clamped), for reporting.
 */
export function shiftStanding(s: Standing, id: PowerId, amount: number, ripple: boolean): Partial<Record<PowerId, number>> {
  const deltas: Partial<Record<PowerId, number>> = { [id]: amount };
  if (ripple) {
    for (const other of POWER_IDS) {
      if (other === id) continue;
      const d = Math.round(amount * relation(id, other) * RIPPLE);
      if (d) deltas[other] = d;
    }
  }
  const out: Partial<Record<PowerId, number>> = {};
  for (const [p, d] of Object.entries(deltas) as [PowerId, number][]) {
    const before = s[p];
    s[p] = Math.max(STANDING_MIN, Math.min(STANDING_MAX, before + d));
    if (s[p] !== before) out[p] = s[p] - before;
  }
  return out;
}

/**
 * One line for a set of changes ("The Crown −16, Spain +6"), plus a line for every power whose opinion of you
 * crossed into a new band.
 */
export function describeShift(before: Standing, deltas: Partial<Record<PowerId, number>>): string[] {
  const entries = (Object.entries(deltas) as [PowerId, number][]).filter(([, d]) => d);
  if (!entries.length) return [];
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const lines = [`Standing: ${entries.map(([p, d]) => `${power(p).name} ${d > 0 ? '+' : '−'}${Math.abs(d)}`).join(', ')}`];
  for (const [p, d] of entries) {
    const was = tierOf(before[p]);
    const now = tierOf(before[p] + d);
    if (was !== now) lines.push(`${power(p).name} ${PLURAL.has(p) ? 'are' : 'is'} now ${TIER_PHRASE[now]}.`);
  }
  return lines;
}
