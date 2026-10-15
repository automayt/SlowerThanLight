import type { SeaEventDef } from '../sim/types';

export const PORT_NAMES = ['Nassau', 'Port Royal', 'Saint-Pierre', 'Bridgetown', 'Willemstad', 'Charles Town'];

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
];

export const SEA_EVENTS: SeaEventDef[] = [
  {
    id: 'castaway',
    title: 'Castaway',
    text: 'A ragged figure on a sandbar waves a shirt on a stick. Your lookout swears there is no one else on the island.',
    choices: [
      {
        label: 'Send a boat',
        outcomes: [
          { weight: 3, effect: { text: 'A sailmaker marooned for cheating at cards. He signs the articles gladly.', recruit: 1 } },
          { weight: 1, effect: { text: 'A Navy lookout on the dune fires a signal rocket as your boat pulls away. They know where you are.', navy: 1 } },
        ],
      },
      { label: 'Sail on', outcomes: [{ weight: 1, effect: { text: 'You leave the poor soul to the gulls.' } }] },
    ],
  },
  {
    id: 'wreck',
    title: 'Drifting Wreck',
    text: 'Spars and barrels bob around a half-sunk merchantman. Her stern cabin is still above water.',
    choices: [
      {
        label: 'Salvage what you can',
        outcomes: [
          { weight: 3, effect: { text: 'Your men pry open a strongbox in the captain’s cabin. Silver!', gold: 25 } },
          { weight: 2, effect: { text: 'A powder keg goes up as the hatch gives way. A handful of coins, and burns all round.', gold: 8, crewHp: -25 } },
        ],
      },
      { label: 'Leave her to the sea', outcomes: [{ weight: 1, effect: { text: 'Some other scavenger will have her.' } }] },
    ],
  },
  {
    id: 'becalmed',
    title: 'Becalmed',
    text: 'The wind dies to nothing. The sails hang slack and the pitch bubbles in the deck seams.',
    choices: [
      { label: 'Wait for the wind', outcomes: [{ weight: 1, effect: { text: 'The crew rest in what shade they can find while the Navy closes the distance.', crewHp: 20, navy: 1 } }] },
      { label: 'Man the sweeps and row', outcomes: [{ weight: 1, effect: { text: 'Hours at the oars under a brutal sun. Backs ache, but you keep your lead.', crewHp: -20 } }] },
    ],
  },
  {
    id: 'storm',
    title: 'Squall Line',
    text: 'A wall of black cloud races across the water toward you.',
    choices: [
      { label: 'Reef sails and ride it out', outcomes: [{ weight: 1, effect: { text: 'The squall batters the hull, but she holds together.', hull: -2 } }] },
      {
        label: 'Run before the wind',
        outcomes: [
          { weight: 1, effect: { text: 'The gale hurls you far ahead of any pursuit.', navy: -1 } },
          { weight: 1, effect: { text: 'A topmast cracks and green water sweeps the deck.', hull: -4, crewHp: -10 } },
        ],
      },
    ],
  },
  {
    id: 'village',
    title: 'Fishing Village',
    text: 'Smoke rises from a little cove where fishing boats are drawn up on the beach.',
    choices: [
      { label: 'Trade for fresh food', cost: 10, outcomes: [{ weight: 1, effect: { text: 'Fresh water, fruit and turtle stew. The crew are new men.', crewHp: 100 } }] },
      { label: 'Raid the village', outcomes: [{ weight: 1, effect: { text: 'Easy pickings, but word of the raid will reach the Navy before nightfall.', gold: 30, navy: 1 } }] },
      { label: 'Leave them in peace', outcomes: [{ weight: 1, effect: { text: 'The fishermen wave as you pass.' } }] },
    ],
  },
  {
    id: 'smugglers',
    title: 'Smugglers’ Cove',
    text: 'A lantern blinks three times from the shore. Smugglers, and they have goods to sell.',
    choices: [
      { label: 'Buy forged Navy papers', cost: 25, outcomes: [{ weight: 1, effect: { text: 'Dispatches send the squadron chasing your shadow up the wrong coast.', navy: -1 } }] },
      { label: 'Buy timber and pitch', cost: 15, outcomes: [{ weight: 1, effect: { text: 'Your carpenter patches the worst of the damage.', hull: 6, repair: true } }] },
      { label: 'Decline', outcomes: [{ weight: 1, effect: { text: 'The lantern goes dark.' } }] },
    ],
  },
  {
    id: 'distress',
    title: 'Distress Signal',
    text: 'A merchantman flying Dutch colours has her ensign upside down. She lies dead in the water.',
    choices: [
      {
        label: 'Close and board her',
        outcomes: [
          { weight: 1, effect: { text: 'A trap! Her gunports fly open and the Dutch flag comes down. Privateers!', battle: 'privateer' } },
          { weight: 1, effect: { text: 'Her captain is only too glad to hand over his strongbox in exchange for his life.', gold: 40 } },
        ],
      },
      { label: 'Keep your distance', outcomes: [{ weight: 1, effect: { text: 'Better safe than hanged.' } }] },
    ],
  },
  {
    id: 'bottle',
    title: 'Message in a Bottle',
    text: 'A bottle knocks against the hull. Inside is a chart with an X scrawled on a nearby key.',
    choices: [
      {
        label: 'Follow the chart',
        outcomes: [
          { weight: 3, effect: { text: 'Under the third palm from the rock: a chest of doubloons!', gold: 45, navy: 0.5 } },
          { weight: 2, effect: { text: 'Nothing but sand, crabs and a wasted afternoon.', navy: 0.5 } },
        ],
      },
      { label: 'Toss it back', outcomes: [{ weight: 1, effect: { text: 'Treasure maps are for fools and storybooks.' } }] },
    ],
  },
  {
    id: 'deserter',
    title: 'Navy Deserter',
    text: 'A jolly boat with one exhausted sailor in Navy slops. He begs to join you.',
    choices: [
      { label: 'Take him aboard', outcomes: [{ weight: 1, effect: { text: 'He knows the squadron’s orders, and you alter course to slip past them.', recruit: 1, navy: -0.5 } }] },
      { label: 'Leave him adrift', outcomes: [{ weight: 1, effect: { text: 'His curses follow you over the water.' } }] },
    ],
  },
  {
    id: 'fever',
    title: 'Fever Below Decks',
    text: 'Yellow jack. Three men are down with it already and the rest are frightened.',
    choices: [
      { label: 'Buy quinine from a passing trader', cost: 20, outcomes: [{ weight: 1, effect: { text: 'The fever breaks within the day.' } }] },
      {
        label: 'Let it run its course',
        outcomes: [
          { weight: 2, effect: { text: 'The fever burns through the crew. They will be weak for days.', crewHp: -35 } },
          { weight: 1, effect: { text: 'The fever claims one of your best before it passes.', crewHp: -20, loseCrew: 1 } },
        ],
      },
    ],
  },
  {
    id: 'picket',
    title: 'Navy Picket',
    text: 'A Navy cutter is shadowing you from the horizon, no doubt signalling the fleet.',
    choices: [
      { label: 'Turn and fight her', outcomes: [{ weight: 1, effect: { text: 'You come about and run out the guns.', battle: 'cutter' } }] },
      { label: 'Lose her in the night', outcomes: [{ weight: 1, effect: { text: 'You douse every lantern and slip away, but it costs you time.', navy: 0.5 } }] },
    ],
  },
];

export function seaEvent(id: string): SeaEventDef {
  const e = SEA_EVENTS.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown event: ${id}`);
  return e;
}
