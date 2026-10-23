import type { SeaEventDef } from '../../sim/types';

/**
 * Tales of Silas Crane (data/nemesis.ts) and of the wrecks tavern rumours mark on the chart.
 * Flags: crane-fled (he got away from you at least once), crane-dead (he is beaten).
 */
export const NEMESIS_EVENTS: SeaEventDef[] = [
  {
    id: 'crane-calling-card',
    title: 'Crane’s Calling Card',
    rarity: 'uncommon',
    unique: true,
    needs: { flag: 'crane-fled', noFlag: 'crane-dead' },
    text: 'A merchant brig adrift and smoking, her people huddled in the waist. A black dog is daubed across her mainsail, and a letter addressed to you is nailed to the mast: "Thinking of you, Captain. S.C."',
    choices: [
      {
        label: 'Take her people aboard',
        outcomes: [{ weight: 1, effect: { text: 'They eat your biscuit and curse Crane’s name. One of them asks to sign on with whoever hunts him down.', recruit: 1, provisions: -2, standing: { trade: 5 } } }],
      },
      { label: 'Strip what Crane left behind', outcomes: [{ weight: 1, effect: { text: 'Crane was in a hurry: a cask of pork and a purse under a loose plank.', provisions: 3, gold: 15 } }] },
      {
        label: 'Read Crane’s course from her log',
        needs: { trait: 'navigator' },
        outcomes: [{ weight: 1, effect: { text: 'Crane steered for the squadron’s cruising ground, to sell your heading. You steer the other way.', navy: -1 } }],
      },
    ],
  },
  {
    id: 'crane-quartermaster',
    title: 'The Black Dog’s Quartermaster',
    rarity: 'uncommon',
    unique: true,
    needs: { flag: 'crane-dead' },
    text: 'A jolly boat with one oarsman: Ezekiel Vane, the Black Dog’s quartermaster, who swam for it when she struck. "Crane buried his share on a cay hereabouts. I have the bearings. What are they worth to you?"',
    choices: [
      {
        label: 'Buy his bearings',
        cost: 30,
        needs: { noFlag: 'treasure' },
        outcomes: [{ weight: 1, effect: { text: 'He scratches the bearings on the back of your chart with a knife point, and pockets your coin.', flag: 'map-whole', clearFlag: 'map-half' } }],
      },
      { label: 'Sign him on', outcomes: [{ weight: 1, effect: { text: 'He keeps the bearings to himself, but he knows the Black Dog’s tricks, and every one of them is yours now.', recruitName: 'Ezekiel Vane' } }] },
      { label: 'Toss him a water cask and row on', outcomes: [{ weight: 1, effect: { text: 'He shouts something about your mother as you go.', provisions: -1 } }] },
    ],
  },
  {
    id: 'rumour-wreck',
    title: 'The Wreck on the Reef',
    pool: 'chain',
    text: 'The wreck the old salt marked lies just where he swore: a Spanish brig on the reef, her stern in two fathoms of clear water and her bow in the deep. Something glints in the sand by her rudder.',
    choices: [
      {
        label: 'Send {crew} down with a line',
        outcomes: [
          { weight: 3, effect: { text: '{crew} comes up gasping with a fistful of pieces of eight, then goes down for more.', gold: 60 } },
          { weight: 1, effect: { text: 'A moray as long as a man comes out of her stern-post. {crew} is hauled up bleeding, with only a few coins.', actorHp: -45, gold: 20 } },
          { weight: 1, effect: { text: 'It was a lure. Boats put out from the cay, and a wreckers’ sloop slips her moorings behind them.', battle: 'smuggler' } },
        ],
      },
      { label: 'Grapple her stern and haul with the boats', outcomes: [{ weight: 1, effect: { text: 'A day of sweating at the capstan drags her stern off the reef, and a strongbox with it.', gold: 35, navy: 0.5 } }] },
      {
        label: 'Warp in alongside on the slack tide',
        needs: { skill: { seamanship: 1 } },
        outcomes: [{ weight: 1, effect: { text: 'You lay her alongside as gently as a lighter at a quay, and empty her hold at leisure.', gold: 80, hull: -1 } }],
      },
      { label: 'Leave her to the fish', outcomes: [{ weight: 1, effect: { text: 'Some other fool can drown for it.' } }] },
    ],
  },
];
