/** One-off fittings a chandler can sell: each changes the ship for the rest of the voyage. Prices rise with each sector (Run.price). */
export interface FittingDef {
  id: string;
  name: string;
  blurb: string;
  /** A few words for a price list. */
  short: string;
  price: number;
}

export const FITTINGS: Record<string, FittingDef> = {
  drill: { id: 'drill', name: 'Gun Drill', short: 'Guns load 10% faster', blurb: 'A master gunner drills your crews: every gun loads 10% faster.', price: 70 },
  careened: {
    id: 'careened',
    name: 'Careened Hull',
    short: '+5% evasion, +1 grapple',
    blurb: 'Weed and barnacles scraped off: +5% evasion, a quicker getaway, and +1 grapple speed to lay alongside a faster ship.',
    price: 55,
  },
  spars: { id: 'spars', name: 'Spare Spars', short: 'Mend 2 systems a jump', blurb: 'Spare spars and cordage: running repairs mend two damaged systems per jump instead of one.', price: 45 },
  chest: { id: 'chest', name: "Surgeon's Chest", short: 'Heal 30 HP a jump', blurb: 'Laudanum, lint and a proper saw: crew heal 30 HP per jump, not 15 (hungry crews heal nothing).', price: 40 },
  nets: { id: 'nets', name: 'Boarding Nets', short: 'Boarders land wounded', blurb: 'Rigged along the rails: enemy boarders come over the side wounded (−30 HP).', price: 45 },
  casks: { id: 'casks', name: 'Water Casks', short: 'Carry 30 provisions', blurb: 'Extra water casks: room for 30 provisions instead of 20.', price: 30 },
  copper: { id: 'copper', name: 'Copper Sheathing', short: '+5% evasion', blurb: 'Copper plates below the waterline keep her bottom clean and fast: +5% evasion (on top of a careened hull).', price: 80 },
  marines: { id: 'marines', name: 'Marine Drill', short: 'Crew fight 25% harder', blurb: 'A deserter from the marines teaches cutlass and bayonet: your crew fight 25% harder hand to hand.', price: 60 },
  lockers: { id: 'lockers', name: 'Shot Lockers', short: 'Chain and grape load 20% faster', blurb: 'Racks of ready chain and grape beside every gun: guns loaded with them fire 20% sooner.', price: 50 },
  figurehead: { id: 'figurehead', name: 'Fearsome Figurehead', short: 'Foes strike sooner, pay toll', blurb: 'A snarling sea-devil at the bow: ships strike their colours more readily (+10%) and pay toll more often (+15%).', price: 45 },
  flags: { id: 'flags', name: 'Locker of Flags', short: 'False colours fool more often', blurb: 'Every nation’s ensign and signal book: false colours fool a hostile ship 70% of the time instead of 45%.', price: 35 },
  pumps: { id: 'pumps', name: 'Chain Pumps', short: 'Pumps drain 50% faster', blurb: 'Modern chain pumps in place of the old suction pumps: the pumps drain water half again as fast.', price: 50 },
};

export const FITTING_IDS = Object.keys(FITTINGS);

export function fitting(id: string): FittingDef {
  const f = FITTINGS[id];
  if (!f) throw new Error(`Unknown fitting: ${id}`);
  return f;
}
