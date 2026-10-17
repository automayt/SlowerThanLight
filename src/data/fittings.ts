/** One-off fittings a chandler can sell: each changes the ship for the rest of the voyage. */
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
  careened: { id: 'careened', name: 'Careened Hull', short: '+5% evasion', blurb: 'Weed and barnacles scraped off: +5% evasion and a quicker getaway.', price: 55 },
  spars: { id: 'spars', name: 'Spare Spars', short: 'Mend 2 systems a jump', blurb: 'Spare spars and cordage: running repairs mend two damaged systems per jump instead of one.', price: 45 },
  chest: { id: 'chest', name: "Surgeon's Chest", short: 'Heal 30 HP a jump', blurb: 'Laudanum, lint and a proper saw: crew heal 30 HP per jump, not 15.', price: 40 },
  nets: { id: 'nets', name: 'Boarding Nets', short: 'Boarders land wounded', blurb: 'Rigged along the rails: enemy boarders come over the side wounded (−30 HP).', price: 45 },
  casks: { id: 'casks', name: 'Water Casks', short: 'Carry 30 provisions', blurb: 'Extra water casks: room for 30 provisions instead of 20.', price: 30 },
};

export const FITTING_IDS = Object.keys(FITTINGS);

export function fitting(id: string): FittingDef {
  const f = FITTINGS[id];
  if (!f) throw new Error(`Unknown fitting: ${id}`);
  return f;
}
