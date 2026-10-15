import type { EnemyDef, ShipDef } from '../sim/types';

export const NAVY_CUTTER: ShipDef = {
  id: 'cutter',
  name: 'HMS Diligence',
  className: 'Navy Cutter',
  description: 'A revenue cutter of the Royal Navy, sent to put an end to your career.',
  hull: 24,
  hands: 8,
  speedBonus: 5,
  systems: { helm: 1, sails: 3, guns: 4, pumps: 1, surgeon: 1 },
  rooms: [
    { id: 'helm', name: 'Quarterdeck', x: 0, y: 1, w: 2, h: 2, system: 'helm' },
    { id: 'surgeon', name: "Surgeon's Cabin", x: 2, y: 0, w: 2, h: 1, system: 'surgeon' },
    { id: 'sails', name: 'Mainmast', x: 2, y: 1, w: 2, h: 2, system: 'sails' },
    { id: 'pumps', name: 'Bilge', x: 2, y: 3, w: 2, h: 1, system: 'pumps' },
    { id: 'guns', name: 'Gun Deck', x: 4, y: 1, w: 2, h: 2, system: 'guns' },
    { id: 'fore', name: 'Forecastle', x: 6, y: 1, w: 1, h: 2 },
  ],
  guns: [{ weapon: 'pdr9', shot: 'round' }, { weapon: 'pdr9', shot: 'chain' }, { weapon: 'pdr6', shot: 'hot' }, { weapon: 'pdr6', shot: 'round' }],
  crew: [
    { name: 'Lt. Harrow', room: 'helm' },
    { name: 'Gunner Pike', room: 'guns' },
    { name: 'Marine Fletcher', room: 'guns' },
    { name: 'Bosun Treadwell', room: 'sails' },
    { name: 'Marine Cobb', room: 'pumps' },
  ],
};

/** Fat, slow and lightly armed: the prize every pirate dreams of. She runs early and strikes easily. */
export const MERCHANT_BRIG: ShipDef = {
  id: 'merchant',
  name: 'The Fat Margaret',
  className: 'Merchant Brig',
  description: 'A deep-laden merchantman out of Bristol, wallowing under a hold full of sugar and silver.',
  hull: 22,
  hands: 6,
  speedBonus: -5,
  systems: { helm: 1, sails: 4, guns: 2, pumps: 2, surgeon: 1 },
  rooms: [
    { id: 'helm', name: 'Quarterdeck', x: 0, y: 1, w: 2, h: 2, system: 'helm' },
    { id: 'surgeon', name: "Purser's Cabin", x: 2, y: 0, w: 2, h: 1, system: 'surgeon' },
    { id: 'sails', name: 'Mainmast', x: 2, y: 1, w: 2, h: 2, system: 'sails' },
    { id: 'pumps', name: 'Bilge', x: 2, y: 3, w: 2, h: 1, system: 'pumps' },
    { id: 'hold', name: 'Cargo Hold', x: 4, y: 1, w: 3, h: 2 },
    { id: 'guns', name: 'Gun Deck', x: 4, y: 0, w: 3, h: 1, system: 'guns' },
    { id: 'fore', name: 'Forecastle', x: 7, y: 1, w: 1, h: 2 },
  ],
  guns: [{ weapon: 'pdr6', shot: 'round' }, { weapon: 'pdr6', shot: 'round' }],
  crew: [
    { name: 'Master Coyle', room: 'helm' },
    { name: 'Mate Dunmore', room: 'sails' },
    { name: 'Gunner Tibbs', room: 'guns' },
    { name: 'Cook Ashby', room: 'pumps' },
  ],
};

/** A licensed raider: quick, mean, and loaded with grape and chain to take prizes intact. */
export const PRIVATEER: ShipDef = {
  id: 'privateer',
  name: 'The Mistral',
  className: 'Privateer Schooner',
  description: 'A rakish schooner sailing under a letter of marque, hunting pirates for the bounty.',
  hull: 20,
  hands: 8,
  speedBonus: 10,
  systems: { helm: 2, sails: 4, guns: 4, pumps: 1, surgeon: 1 },
  rooms: [
    { id: 'helm', name: 'Quarterdeck', x: 0, y: 1, w: 2, h: 2, system: 'helm' },
    { id: 'surgeon', name: "Surgeon's Cabin", x: 2, y: 0, w: 2, h: 1, system: 'surgeon' },
    { id: 'sails', name: 'Mainmast', x: 2, y: 1, w: 2, h: 2, system: 'sails' },
    { id: 'pumps', name: 'Bilge', x: 2, y: 3, w: 2, h: 1, system: 'pumps' },
    { id: 'guns', name: 'Gun Deck', x: 4, y: 1, w: 2, h: 2, system: 'guns' },
    { id: 'fore', name: 'Bowsprit', x: 6, y: 1, w: 1, h: 2 },
  ],
  guns: [{ weapon: 'pdr9', shot: 'grape' }, { weapon: 'pdr9', shot: 'chain' }, { weapon: 'pdr6', shot: 'round' }, { weapon: 'pdr6', shot: 'hot' }],
  crew: [
    { name: 'Capt. Delacroix', room: 'helm' },
    { name: 'Gunner Roux', room: 'guns' },
    { name: 'Marksman Vell', room: 'guns' },
    { name: 'Topman Kessel', room: 'sails' },
    { name: 'Bosun Ortega', room: 'pumps' },
  ],
};

/** The squadron flagship barring the way to freedom. She will not run and she will not strike. */
export const NAVY_FRIGATE: ShipDef = {
  id: 'frigate',
  name: 'HMS Relentless',
  className: 'Navy Frigate',
  description: 'Thirty-two guns and a commodore who has sworn to see you hang.',
  hull: 34,
  hands: 12,
  speedBonus: -5,
  systems: { helm: 2, sails: 3, guns: 7, pumps: 3, surgeon: 2 },
  rooms: [
    { id: 'helm', name: 'Quarterdeck', x: 0, y: 1, w: 2, h: 3, system: 'helm' },
    { id: 'surgeon', name: "Surgeon's Cabin", x: 2, y: 0, w: 2, h: 1, system: 'surgeon' },
    { id: 'sails', name: 'Mainmast', x: 2, y: 1, w: 2, h: 3, system: 'sails' },
    { id: 'marines', name: 'Marine Barracks', x: 2, y: 4, w: 2, h: 1 },
    { id: 'magazine', name: 'Powder Magazine', x: 4, y: 0, w: 3, h: 1 },
    { id: 'guns', name: 'Gun Deck', x: 4, y: 1, w: 3, h: 3, system: 'guns' },
    { id: 'pumps', name: 'Bilge', x: 4, y: 4, w: 3, h: 1, system: 'pumps' },
    { id: 'fore', name: 'Forecastle', x: 7, y: 1, w: 2, h: 3 },
  ],
  guns: [
    { weapon: 'pdr12', shot: 'round' },
    { weapon: 'pdr12', shot: 'chain' },
    { weapon: 'carronade', shot: 'round' },
    { weapon: 'pdr9', shot: 'grape' },
  ],
  crew: [
    { name: 'Commodore Ashcroft', room: 'helm' },
    { name: 'Lt. Penhallow', room: 'sails' },
    { name: 'Master Gunner Byrne', room: 'guns' },
    { name: 'Gunner Hale', room: 'guns' },
    { name: 'Sgt. Royce', room: 'marines' },
    { name: 'Marine Tully', room: 'fore' },
    { name: 'Carpenter Wynn', room: 'pumps' },
  ],
};

export const ENEMIES: Record<string, EnemyDef> = {
  cutter: {
    id: 'cutter',
    ship: NAVY_CUTTER,
    faction: 'navy',
    ai: { fleeAt: 0.3, surrenderChance: 0.35, surrenderAt: 0.25 },
    plunder: [15, 25],
    sighting: 'A Navy cutter beats up to windward, guns run out.',
  },
  merchant: {
    id: 'merchant',
    ship: MERCHANT_BRIG,
    faction: 'merchant',
    ai: { fleeAt: 1, surrenderChance: 0.6, surrenderAt: 0.45 },
    plunder: [55, 85],
    sighting: 'A fat merchant brig, low in the water. She has seen you and means to run!',
  },
  privateer: {
    id: 'privateer',
    ship: PRIVATEER,
    faction: 'privateer',
    ai: { fleeAt: 0.25, surrenderChance: 0.25, surrenderAt: 0.2 },
    plunder: [30, 50],
    sighting: 'A privateer schooner hoists her colours. Bounty hunters!',
  },
  frigate: {
    id: 'frigate',
    ship: NAVY_FRIGATE,
    faction: 'navy',
    ai: { fleeAt: 0, surrenderChance: 0, surrenderAt: 0 },
    plunder: [150, 150],
    sighting: 'HMS Relentless bars the channel. The Commodore means to finish this here.',
  },
};

export const ENEMY_LIST: EnemyDef[] = Object.values(ENEMIES);

export function enemy(id: string): EnemyDef {
  const e = ENEMIES[id];
  if (!e) throw new Error(`Unknown enemy: ${id}`);
  return e;
}
