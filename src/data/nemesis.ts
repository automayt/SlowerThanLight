/**
 * Silas Crane: once your quartermaster, marooned on a sandbar for robbing the common purse. Now he has a ship, the
 * Black Dog, and a grudge. He waits somewhere on every sector's chart until he is beaten. He runs rather than strikes,
 * and each time he gets away (or you run, or you pay him off) he comes back better found, with a bigger price on his head.
 */
export const NEMESIS = {
  captain: 'Silas Crane',
  ship: 'The Black Dog',
  /** The enemy kind he sails, by sector (0-based): a privateer's hull to begin with, then a brigantine. */
  kinds: ['privateer', 'rival', 'rival'],
  /** Hull added per time he has got away. */
  hullPerGrudge: 0.15,
  /** Bounty before sector scaling, and what each escape adds to it. */
  bounty: 45,
  bountyPerGrudge: 30,
  /** Share of his hull at which he cuts and runs (until the last meeting, when he fights to the end). */
  fleeAt: 0.4,
  /** What buying him off costs, relative to an ordinary bribe. */
  bribe: 1.5,
};

/** How he greets you, by how you last parted. */
export const NEMESIS_HAILS: Record<'first' | 'fled' | 'ran' | 'paid' | 'missed', string> = {
  first:
    'A black-hulled privateer with a dog’s head painted on her bow. At her rail, grinning, stands Silas Crane: your old quartermaster, the one you marooned on a sandbar with a pistol and a bottle. "I said I’d see you again, Captain. I’ll have that ship, and then your hide."',
  fled: 'The Black Dog again, new canvas and new guns, the shot-holes you gave her plugged and painted over. Crane cups his hands: "You should have finished it when you had the chance!"',
  ran: 'The Black Dog, closing fast. Crane is laughing before he is in hail. "Run again, Captain! Your crew must be so proud."',
  paid: 'The Black Dog, back for more. "Your gold spent sweetly," Crane calls across. "Bring more. Or don’t, and I’ll take it off your corpse."',
  missed: 'The Black Dog, hull-down and waiting where you would have to pass. Crane has been asking after you in every port.',
};

/** Rival captains at the dice tables, by port: they play Bones for coin. */
export const DICE_RIVALS: Record<string, string> = {
  Nassau: 'Calico Meg',
  'Port Royal': 'Lieutenant Hobb (off duty)',
  'Saint-Pierre': 'Capitaine Lafitte',
  Bridgetown: 'Josiah Pratt, sugar factor',
  Willemstad: 'Mynheer de Wit',
  'Charles Town': 'Old Barnaby Teach',
  Havana: 'Don Esteban',
};

/** Taverns, for the name over the door. */
export const TAVERNS: Record<string, string> = {
  Nassau: 'The Rum Barrel',
  'Port Royal': 'The Sign of the Mermaid',
  'Saint-Pierre': 'Le Coq Rouge',
  Bridgetown: 'The Sugar Loaf',
  Willemstad: 'De Gouden Leeuw',
  'Charles Town': 'The Pelican',
  Havana: 'La Bodeguita',
};

/** Story flags the voyage itself sets (not an event): Crane got away, Crane is beaten. */
export const VOYAGE_FLAGS = ['crane-fled', 'crane-dead'];

/** Chain pages the voyage itself opens (not another event): the wreck a tavern rumour marks on the chart. */
export const VOYAGE_CHAIN_PAGES = ['rumour-wreck'];
