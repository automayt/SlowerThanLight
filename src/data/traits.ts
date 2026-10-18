import type { SkillXp } from '../sim/Skills';

/** Where a sailor learned the trade. Some come with a skill already learned; every one opens choices in events. */
export interface TraitDef {
  id: string;
  /** "a gunner's mate" reads after a name: "Mary Kell, gunner's mate". */
  name: string;
  blurb: string;
  /** Experience they bring aboard (Veteran is 50). */
  xp?: SkillXp;
  /** What a port's hiring hall asks above the usual price for them. */
  premium: number;
}

export const TRAITS: Record<string, TraitDef> = {
  gunner: { id: 'gunner', name: 'gunner’s mate', blurb: 'Served the guns of a King’s ship: a Veteran gunner from the start.', xp: { gunnery: 60 }, premium: 10 },
  helmsman: { id: 'helmsman', name: 'old salt', blurb: 'Forty years before the mast: a Veteran helmsman from the start.', xp: { seamanship: 60 }, premium: 10 },
  carpenter: { id: 'carpenter', name: 'ship’s carpenter', blurb: 'Apprenticed in a Bristol yard: a Veteran carpenter from the start.', xp: { repair: 60 }, premium: 10 },
  brawler: { id: 'brawler', name: 'brawler', blurb: 'Fought for money in the taverns of Port Royal: a Veteran brawler from the start.', xp: { combat: 60 }, premium: 10 },
  surgeon: { id: 'surgeon', name: 'barber-surgeon', blurb: 'Can set a bone and stitch a wound: the whole crew heal 5 HP more each jump.', premium: 15 },
  cook: { id: 'cook', name: 'cook', blurb: 'Can make a meal from flying fish and rainwater: quiet seas bring in food more often.', premium: 5 },
  navigator: { id: 'navigator', name: 'navigator', blurb: 'Reads stars, currents and Spanish charts: opens choices only a navigator would see.', premium: 10 },
  landsman: { id: 'landsman', name: 'green hand', blurb: 'Never been to sea, but cheap and willing.', premium: -10 },
};

export const TRAIT_IDS = Object.keys(TRAITS);

export function trait(id: string): TraitDef {
  const t = TRAITS[id];
  if (!t) throw new Error(`Unknown trait: ${id}`);
  return t;
}

/** Extra healing per jump for each barber-surgeon aboard, and the extra chance of food on a quiet crossing for a cook. */
export const SURGEON_TRAIT_HEAL = 5;
export const COOK_FORAGE = 0.2;
