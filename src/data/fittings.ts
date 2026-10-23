import type { ShotType } from '../sim/types';

/** One-off fittings a chandler can sell: each changes the ship for the rest of the voyage. Prices rise with each sector (Run.price). */
export interface FittingDef {
  id: string;
  name: string;
  blurb: string;
  /** A few words for a price list. */
  short: string;
  price: number;
  /** Seldom stocked: a chandler has one now and then, beside the usual wares (Run.stockFittings). Most have a drawback. */
  rare?: boolean;
  /** What it does in a fight, for the fittings that work through FittingEffects (older fittings are wired in Run). */
  effects?: FittingEffects;
}

/** How fittings change the ship and the fight. Every field is optional; several fittings combine (see fittingEffects). */
export interface FittingEffects {
  /** Evasion in percent, added to the hull's own. */
  evasion?: number;
  /** Stout sides: balls this heavy or lighter often glance off (Combat.applyHit). */
  armour?: number;
  /** Hand-to-hand strength, relative to normal. */
  melee?: number;
  /** Gun loading speed, relative to normal. */
  reload?: number;
  /** Loading speed by shot, relative to normal. */
  shotRate?: Partial<Record<ShotType, number>>;
  /** No quarter asked or given: no ship strikes her colours to you. */
  noQuarter?: boolean;
  /** How fast the enemy's guns load, relative to normal (her gun crews' nerve). */
  enemyReload?: number;
}

export const FITTINGS: Record<string, FittingDef> = {
  drill: { id: 'drill', name: 'Gun Drill', short: 'Guns load 10% faster', blurb: 'A master gunner drills your crews: every gun loads 10% faster.', price: 85 },
  careened: {
    id: 'careened',
    name: 'Careened Hull',
    short: '+5% evasion, +1 grapple',
    blurb: 'Weed and barnacles scraped off: +5% evasion, a quicker getaway, and +1 grapple speed to lay alongside a faster ship.',
    price: 55,
  },
  spars: { id: 'spars', name: 'Spare Spars', short: 'Mend 2 systems and 1 hull a jump', blurb: 'Spare spars, planks and cordage: running repairs mend two damaged systems and a point of hull per jump.', price: 45 },
  chest: { id: 'chest', name: "Surgeon's Chest", short: 'Heal 30 HP a jump', blurb: 'Laudanum, lint and a proper saw: crew heal 30 HP per jump, not 15 (hungry crews heal nothing).', price: 40 },
  nets: { id: 'nets', name: 'Boarding Nets', short: 'Boarders land wounded', blurb: 'Rigged along the rails: enemy boarders come over the side wounded (−30 HP).', price: 45 },
  casks: { id: 'casks', name: 'Water Casks', short: 'Carry 30 provisions', blurb: 'Extra water casks: room for 30 provisions instead of 20.', price: 30 },
  copper: { id: 'copper', name: 'Copper Sheathing', short: '+5% evasion', blurb: 'Copper plates below the waterline keep her bottom clean and fast: +5% evasion (on top of a careened hull).', price: 80 },
  marines: { id: 'marines', name: 'Marine Drill', short: 'Crew fight 25% harder', blurb: 'A deserter from the marines teaches cutlass and bayonet: your crew fight 25% harder hand to hand.', price: 60 },
  lockers: { id: 'lockers', name: 'Shot Lockers', short: 'Chain and grape load 30% faster', blurb: 'Racks of ready chain and grape beside every gun: guns loaded with them fire 30% sooner. Swivels love them.', price: 40 },
  figurehead: { id: 'figurehead', name: 'Fearsome Figurehead', short: 'Foes strike sooner, pay toll', blurb: 'A snarling sea-devil at the bow: ships strike their colours more readily (+10%) and pay toll more often (+15%).', price: 45 },
  flags: { id: 'flags', name: 'Locker of Flags', short: 'False colours fool more often', blurb: 'Every nation’s ensign and signal book: false colours fool a hostile ship 70% of the time instead of 45%.', price: 35 },
  pumps: { id: 'pumps', name: 'Chain Pumps', short: 'Pumps drain 50% faster', blurb: 'Modern chain pumps in place of the old suction pumps: the pumps drain water half again as fast.', price: 50 },
  furnace: {
    id: 'furnace',
    name: 'Shot Furnace',
    short: 'Hot shot loads 30% faster',
    blurb: 'A brick furnace on the gun deck keeps balls glowing: guns loaded with hot shot fire 30% sooner. Set her alight and keep her burning.',
    price: 50,
    effects: { shotRate: { hot: 1.3 } },
  },
  // Rare finds, each with a price to pay beyond the gold.
  oak: {
    id: 'oak',
    name: 'Live-Oak Doubling',
    short: 'Rare · light balls glance off · −5% evasion',
    blurb: 'A second skin of Carolina live oak: balls from light guns (1 damage) often glance off her sides. She sits deep and slow: −5% evasion.',
    price: 90,
    rare: true,
    effects: { armour: 1, evasion: -5 },
  },
  redflag: {
    id: 'redflag',
    name: 'The Red Flag',
    short: 'Rare · crew fight 30% harder, foes shaken · none will strike',
    blurb: 'No quarter asked or given. Your crew fight 30% harder hand to hand and enemy gun crews load 10% slower in dread of you, but no ship will strike her colours to you: take her by boarding, or sink her.',
    price: 55,
    rare: true,
    effects: { melee: 1.3, noQuarter: true, enemyReload: 0.9 },
  },
  doubleshot: {
    id: 'doubleshot',
    name: 'Double-Shotted Guns',
    short: 'Rare · guns load 20% faster · chain, grape 25% slower',
    blurb: 'Two balls and a double charge in every gun, by a gunner who learned his trade at Malaga: every gun loads 20% faster, but fiddly chain and grape load 25% slower.',
    price: 100,
    rare: true,
    effects: { reload: 1.2, shotRate: { chain: 0.75, grape: 0.75 } },
  },
};

export const FITTING_IDS = Object.keys(FITTINGS);
/** What every chandler might stock, and the rare finds that turn up now and then. */
export const COMMON_FITTING_IDS = FITTING_IDS.filter((id) => !FITTINGS[id].rare);
export const RARE_FITTING_IDS = FITTING_IDS.filter((id) => FITTINGS[id].rare);
/** Chance a port's chandler has a rare fitting as well (from the second sector on), and in a chandlers' port. */
export const RARE_CHANCE = 0.25;
export const RARE_CHANCE_CHANDLER = 0.5;

export function fitting(id: string): FittingDef {
  const f = FITTINGS[id];
  if (!f) throw new Error(`Unknown fitting: ${id}`);
  return f;
}

/** What a set of fittings adds up to through FittingEffects: evasion and armour add, rates multiply. */
export function fittingEffects(ids: readonly string[]): Required<Omit<FittingEffects, 'shotRate'>> & { shotRate: Partial<Record<ShotType, number>> } {
  const out = { evasion: 0, armour: 0, melee: 1, reload: 1, shotRate: {} as Partial<Record<ShotType, number>>, noQuarter: false, enemyReload: 1 };
  for (const id of ids) {
    const e = FITTINGS[id]?.effects;
    if (!e) continue;
    out.evasion += e.evasion ?? 0;
    out.armour = Math.max(out.armour, e.armour ?? 0);
    out.melee *= e.melee ?? 1;
    out.reload *= e.reload ?? 1;
    out.noQuarter ||= !!e.noQuarter;
    out.enemyReload *= e.enemyReload ?? 1;
    for (const [shot, r] of Object.entries(e.shotRate ?? {}) as [ShotType, number][]) out.shotRate[shot] = (out.shotRate[shot] ?? 1) * r;
  }
  return out;
}
