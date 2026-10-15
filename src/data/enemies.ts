import type { ShipDef } from '../sim/types';

export const NAVY_CUTTER: ShipDef = {
  id: 'cutter',
  name: 'HMS Diligence',
  className: 'Navy Cutter',
  description: 'A revenue cutter of the Royal Navy, sent to put an end to your career.',
  hull: 20,
  hands: 7,
  speedBonus: 5,
  systems: { helm: 1, sails: 3, guns: 3, pumps: 1, surgeon: 1 },
  rooms: [
    { id: 'helm', name: 'Quarterdeck', x: 0, y: 1, w: 2, h: 2, system: 'helm' },
    { id: 'surgeon', name: "Surgeon's Cabin", x: 2, y: 0, w: 2, h: 1, system: 'surgeon' },
    { id: 'sails', name: 'Mainmast', x: 2, y: 1, w: 2, h: 2, system: 'sails' },
    { id: 'pumps', name: 'Bilge', x: 2, y: 3, w: 2, h: 1, system: 'pumps' },
    { id: 'guns', name: 'Gun Deck', x: 4, y: 1, w: 2, h: 2, system: 'guns' },
    { id: 'fore', name: 'Forecastle', x: 6, y: 1, w: 1, h: 2 },
  ],
  guns: [{ weapon: 'pdr9', shot: 'round' }, { weapon: 'pdr6', shot: 'chain' }, { weapon: 'pdr6', shot: 'hot' }],
  crew: [
    { name: 'Lt. Harrow', room: 'helm' },
    { name: 'Gunner Pike', room: 'guns' },
    { name: 'Bosun Treadwell', room: 'sails' },
    { name: 'Marine Cobb', room: 'pumps' },
  ],
};
