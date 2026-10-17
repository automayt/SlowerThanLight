export { SEA_EVENTS, seaEvent } from './events';

export const PORT_NAMES = ['Nassau', 'Port Royal', 'Saint-Pierre', 'Bridgetown', 'Willemstad', 'Charles Town'];

/** A line about each port, shown under its name. */
export const PORT_TAGLINES: Record<string, string> = {
  Nassau: 'The pirates’ republic: no governor, no questions, and rum by the barrel.',
  'Port Royal': 'A Crown town that hangs pirates by day and drinks with them by night. Keep your colours furled.',
  'Saint-Pierre': 'A French port on Martinique, happy to trade with anyone who is at war with England.',
  Bridgetown: 'Barbados sugar and Barbados merchants. Gold speaks louder here than any flag.',
  Willemstad: 'Dutch Curaçao, where everything is for sale and the clerks never look up from their ledgers.',
  'Charles Town': 'A colonial port that buys stolen cargo cheap and asks no more than it must.',
};

/** Names for crew who sign on during the voyage. */
export const RECRUIT_NAMES = [
  'Jack Tarrant',
  'Mary Kell',
  'One-Eyed Sam',
  'Ezra Pell',
  'Nell Starling',
  'Cutlass Joe',
  'Ines Barrow',
  'Dutch Willem',
  'Tom Gully',
  'Red Bess',
  'Abel Crane',
  'Kit Mallory',
  'Jonah Quick',
  'Sal Fenwick',
  'Black Caesar',
  'Hannah Rook',
  'Mateo Cruz',
  'Peg-Leg Doyle',
  'Ruth Maddox',
  'Silent Amos',
  'Gideon Shaw',
  'Lottie Vance',
  'Patch Morrow',
  'Yusuf the Moor',
  'Bram Hollis',
  'Cora Teague',
  'Whistling Ned',
  'Tobiah Fry',
];

/** One stretch of the voyage: its own chart, its own fleet, its own kind of ship. */
export interface SectorDef {
  name: string;
  /** Shown when you sail into it. */
  blurb: string;
  /** Who you meet at battle nodes, with relative weights. */
  enemies: [string, number][];
  /** What the fleet's vanguard sends at you when it overruns a node. */
  ambush: string;
}

export const SECTORS: SectorDef[] = [
  {
    name: 'The Windward Isles',
    blurb: 'Fat merchantmen and nervous smugglers thread the islands a day out of Tortuga. Easy pickings, if you are quick.',
    enemies: [
      ['merchant', 40],
      ['smuggler', 25],
      ['privateer', 20],
      ['cutter', 15],
    ],
    ambush: 'cutter',
  },
  {
    name: 'The Spanish Main',
    blurb: 'Guarda costas, French corsairs and treasure galleons. Richer prizes, and sharper teeth guarding them.',
    enemies: [
      ['guarda', 20],
      ['corsair', 20],
      ['privateer', 15],
      ['galleon', 8],
      ['merchant', 22],
      ['cutter', 15],
    ],
    ambush: 'cutter',
  },
  {
    name: "The King's Waters",
    blurb: 'Navy sloops and rival brethren stand between you and the blockade. Every sail is a threat now.',
    enemies: [
      ['sloop', 25],
      ['cutter', 20],
      ['rival', 25],
      ['galleon', 10],
      ['corsair', 10],
      ['privateer', 10],
    ],
    ambush: 'sloop',
  },
];
