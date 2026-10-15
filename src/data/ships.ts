import type { ShipDef } from '../sim/types';

/** Player ships. Layouts are tile grids with the bow toward +x; doors are added between adjacent rooms. */
export const PLAYER_SHIPS: ShipDef[] = [
  {
    id: 'wren',
    name: 'The Wren',
    className: 'Sloop',
    description: 'A nimble sloop that dances out of the way of broadsides. Light guns, light hull, quick to slip away.',
    hull: 20,
    hands: 8,
    speedBonus: 10,
    systems: { helm: 2, sails: 4, guns: 3, pumps: 2, surgeon: 1 },
    rooms: [
      { id: 'helm', name: 'Quarterdeck', x: 0, y: 1, w: 2, h: 2, system: 'helm' },
      { id: 'surgeon', name: "Surgeon's Cabin", x: 2, y: 0, w: 2, h: 1, system: 'surgeon' },
      { id: 'sails', name: 'Mainmast', x: 2, y: 1, w: 2, h: 2, system: 'sails' },
      { id: 'pumps', name: 'Bilge', x: 2, y: 3, w: 2, h: 1, system: 'pumps' },
      { id: 'guns', name: 'Gun Deck', x: 4, y: 1, w: 2, h: 2, system: 'guns' },
      { id: 'fore', name: 'Forecastle', x: 6, y: 1, w: 1, h: 2 },
    ],
    guns: [{ weapon: 'pdr9' }, { weapon: 'pdr9' }, { weapon: 'pdr6' }],
    crew: [
      { name: 'Anne Rook', room: 'helm' },
      { name: 'Tobias Finch', room: 'guns' },
      { name: 'Mags Calloway', room: 'sails' },
      { name: 'Little Pim', room: 'pumps' },
      { name: 'Jem Sparrow', room: 'fore' },
    ],
  },
  {
    id: 'gull',
    name: 'The Black Gull',
    className: 'Brigantine',
    description: 'A sturdy all-rounder. Enough guns to trade blows, enough sail to run when the odds turn.',
    hull: 24,
    hands: 8,
    speedBonus: 0,
    systems: { helm: 2, sails: 3, guns: 4, pumps: 2, surgeon: 2 },
    rooms: [
      { id: 'helm', name: 'Quarterdeck', x: 0, y: 1, w: 2, h: 2, system: 'helm' },
      { id: 'surgeon', name: "Surgeon's Cabin", x: 2, y: 0, w: 2, h: 1, system: 'surgeon' },
      { id: 'sails', name: 'Mainmast', x: 2, y: 1, w: 2, h: 2, system: 'sails' },
      { id: 'quarters', name: 'Crew Quarters', x: 2, y: 3, w: 2, h: 1 },
      { id: 'guns', name: 'Gun Deck', x: 4, y: 1, w: 3, h: 2, system: 'guns' },
      { id: 'magazine', name: 'Powder Magazine', x: 4, y: 0, w: 3, h: 1 },
      { id: 'pumps', name: 'Bilge', x: 4, y: 3, w: 3, h: 1, system: 'pumps' },
      { id: 'fore', name: 'Forecastle', x: 7, y: 1, w: 1, h: 2 },
    ],
    guns: [{ weapon: 'pdr9' }, { weapon: 'pdr9' }, { weapon: 'pdr12' }],
    crew: [
      { name: 'Captain Vane', room: 'helm' },
      { name: 'Hester Black', room: 'guns' },
      { name: 'Jory Quill', room: 'guns' },
      { name: 'Old Salt Ned', room: 'sails' },
      { name: 'Doc Mabry', room: 'pumps' },
    ],
  },
  {
    id: 'maw',
    name: 'The Iron Maw',
    className: 'Frigate',
    description: 'A captured frigate bristling with heavy iron. Slow as a barge, but she can take a pounding and give one back.',
    hull: 30,
    hands: 10,
    speedBonus: -5,
    systems: { helm: 2, sails: 2, guns: 6, pumps: 3, surgeon: 2 },
    rooms: [
      { id: 'helm', name: 'Quarterdeck', x: 0, y: 1, w: 2, h: 3, system: 'helm' },
      { id: 'surgeon', name: "Surgeon's Cabin", x: 2, y: 0, w: 2, h: 1, system: 'surgeon' },
      { id: 'sails', name: 'Mainmast', x: 2, y: 1, w: 2, h: 3, system: 'sails' },
      { id: 'quarters', name: 'Crew Quarters', x: 2, y: 4, w: 2, h: 1 },
      { id: 'magazine', name: 'Powder Magazine', x: 4, y: 0, w: 3, h: 1 },
      { id: 'guns', name: 'Gun Deck', x: 4, y: 1, w: 3, h: 3, system: 'guns' },
      { id: 'pumps', name: 'Bilge', x: 4, y: 4, w: 3, h: 1, system: 'pumps' },
      { id: 'fore', name: 'Forecastle', x: 7, y: 1, w: 2, h: 3 },
    ],
    guns: [{ weapon: 'pdr12' }, { weapon: 'pdr12' }, { weapon: 'carronade' }, { weapon: 'pdr6' }],
    crew: [
      { name: 'Captain Kidd Hale', room: 'helm' },
      { name: 'Bess Ironside', room: 'guns' },
      { name: 'Silas Grim', room: 'guns' },
      { name: 'Wick', room: 'sails' },
      { name: 'Rosa Teach', room: 'pumps' },
      { name: 'Barnaby Coil', room: 'fore' },
    ],
  },
];

export function playerShip(id: string): ShipDef {
  const s = PLAYER_SHIPS.find((p) => p.id === id);
  if (!s) throw new Error(`Unknown ship: ${id}`);
  return s;
}
