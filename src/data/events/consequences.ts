import type { SeaEventDef } from '../../sim/types';

/**
 * Echoes of earlier choices (events that need a story flag) and stories about particular crew members.
 * Flags: gallant (you spared or helped the Navy), marque (French papers), blackbeard (paid him off),
 * dutchman (carried the ghost's letters), cursed (shot the albatross, refused the ghost), lucky (doubloon on the mast),
 * treasure (dug up the hoard).
 */
export const CONSEQUENCE_EVENTS: SeaEventDef[] = [
  // --- Echoes ------------------------------------------------------------------
  {
    id: 'gallant-debt',
    title: 'A Gentleman’s Debt',
    rarity: 'uncommon',
    unique: true,
    needs: { flag: 'gallant', minCol: 3 },
    text: 'A Navy cutter closes under a white flag. Her captain once owed you his life, and he has come to repay it, quietly.',
    choices: [
      { label: 'Hear him out', outcomes: [{ weight: 1, effect: { text: '"The squadron sails north at dawn. I never told you." He salutes and sheers off.', navy: -1.5 } }] },
    ],
  },
  {
    id: 'marque-frigate',
    title: 'Under French Colours',
    rarity: 'uncommon',
    unique: true,
    needs: { flag: 'marque', minCol: 3 },
    text: 'A French frigate comes up fast. Then her captain sees the commission flying at your masthead and dips his ensign in salute.',
    choices: [
      { label: 'Ask for an escort', outcomes: [{ weight: 1, effect: { text: 'For two days she shadows you, and no English ship comes near.', navy: -1 } }] },
      { label: 'Ask for powder and shot', outcomes: [{ weight: 1, effect: { text: 'French powder, French shot, and a French gunner who says your gun deck is a disgrace and fixes it.', upgrade: 'guns' } }] },
    ],
  },
  {
    id: 'blackbeard-diversion',
    title: 'News of Blackbeard',
    rarity: 'uncommon',
    unique: true,
    needs: { flag: 'blackbeard' },
    text: 'A fishing boat brings astonishing news: Blackbeard has blockaded Charles Town and is holding the whole city to ransom.',
    choices: [
      { label: 'Raise a glass to the old devil', outcomes: [{ weight: 1, effect: { text: 'Half the squadron has been sent north to deal with him. He kept his word.', navy: -1.5, crewHp: 10 } }] },
    ],
  },
  {
    id: 'dutchman-fog',
    title: 'The Fog Returns',
    rarity: 'uncommon',
    needs: { flag: 'dutchman' },
    text: 'Topsails on the horizon: the Navy. And then, out of a clear sky, a cold fog rises off the sea and wraps the ship like a shroud. The packet of letters is wet with dew.',
    choices: [{ label: 'Slip away in the fog', outcomes: [{ weight: 1, effect: { text: 'When it lifts, the sea is empty. Nobody aboard says a word about it.', navy: -1 } }] }],
  },
  {
    id: 'drowned',
    title: 'The Drowned Sailor',
    rarity: 'rare',
    unique: true,
    needs: { flag: 'cursed', crew: 2 },
    text: 'In the middle watch {crew} swears a dripping figure stood at the foot of their hammock, pointing at the sea. Now {crew2} says they saw it too.',
    choices: [
      { label: 'Give the dead a proper burial service', outcomes: [{ weight: 1, effect: { text: 'Prayers are read over the side for every sailor lost at sea. The figure does not return.', clearFlag: 'cursed', crewHp: 10 } }] },
      {
        label: 'Double the watch and say nothing',
        outcomes: [
          { weight: 1, effect: { text: 'The next night, {crew} walks off the bowsprit in their sleep.', loseActor: true } },
          { weight: 2, effect: { text: 'Nothing more is seen. Everyone sleeps badly.', crewHp: -15 } },
        ],
      },
    ],
  },
  {
    id: 'coin-lost',
    title: 'The Lucky Doubloon',
    rarity: 'uncommon',
    unique: true,
    needs: { flag: 'lucky', minCol: 3 },
    text: 'A heavy sea shakes the doubloon loose from the mainmast. It rolls across the deck toward the scupper. {crew} dives for it.',
    choices: [
      {
        label: 'Watch',
        outcomes: [
          { weight: 1, effect: { text: '{crew} catches it on the very edge of the scupper. The crew cheer like they have won a battle.', crewHp: 20 } },
          { weight: 1, effect: { text: 'It is gone into the sea. The crew are sure the luck has gone with it.', crewHp: -15, clearFlag: 'lucky' } },
        ],
      },
    ],
  },
  {
    id: 'treasure-rumour',
    title: 'Word Gets Around',
    rarity: 'uncommon',
    unique: true,
    needs: { flag: 'treasure' },
    text: 'Somebody talked. A pirate brig closes with you, and her captain shouts across that he will have half your buried gold, or all of it.',
    choices: [
      { label: 'Pay him to go away', cost: 40, outcomes: [{ weight: 1, effect: { text: 'He counts it twice and leaves, grinning.' } }] },
      { label: 'Let him try', outcomes: [{ weight: 1, effect: { text: 'Run out the guns!', battle: 'privateer' } }] },
    ],
  },

  // --- Crew stories --------------------------------------------------------------
  {
    id: 'gangrene',
    title: 'Gangrene',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { hurt: true, minCol: 2 },
    text: '{crew}’s wound has gone green and stinking. The surgeon says the leg must come off, or {crew} will not see the week out.',
    choices: [
      { label: 'Amputate', outcomes: [{ weight: 1, effect: { text: 'The saw, the tar, the screaming. {crew} lives, and will stump about the deck on a peg.', actorHp: -30 } }] },
      {
        label: 'Trust to rum and prayer',
        outcomes: [
          { weight: 1, effect: { text: 'Against all reason, the fever breaks and the wound begins to heal.', actorHp: 20 } },
          { weight: 1, effect: { text: '{crew} dies in the night, raving.', loseActor: true } },
        ],
      },
    ],
  },
  {
    id: 'talent',
    title: 'A Hidden Talent',
    pool: 'incident',
    rarity: 'uncommon',
    text: '{crew} has been quiet since signing on. Today you learn what they did before they went to sea.',
    choices: [
      {
        label: 'Ask about it',
        outcomes: [
          { weight: 1, effect: { text: '{crew} was a shipwright’s apprentice in Deptford, and spends a week improving your hull.', upgrade: 'hull' } },
          { weight: 1, effect: { text: '{crew} served the guns on a ship of the line, and drills your gunners until they are twice as quick.', upgrade: 'guns' } },
          { weight: 1, effect: { text: '{crew} studied physic in Leiden before a scandal. The sick bay has never been so clean.', crewHp: 40 } },
          { weight: 1, effect: { text: '{crew} was a sailmaker. Your canvas is recut and sets like a racing yacht’s.', upgrade: 'sails' } },
        ],
      },
    ],
  },
  {
    id: 'homesick',
    title: 'Homesick',
    pool: 'incident',
    needs: { crew: 4 },
    text: '{crew} asks to be put ashore at the next island with a boat. They have a family in Kingston and they have had enough of the sea.',
    choices: [
      { label: 'Let them go, with their share', cost: 10, outcomes: [{ weight: 1, effect: { text: 'You shake hands at the water’s edge. The crew think well of you for it.', loseActor: true, crewHp: 10 } }] },
      { label: 'Persuade them to stay', outcomes: [
        { weight: 1, effect: { text: 'A promise of a bigger share does it. For now.' } },
        { weight: 1, effect: { text: '{crew} slips over the side one night and swims for shore.', loseActor: true } },
      ] },
      { label: 'Refuse: they signed the articles', outcomes: [{ weight: 1, effect: { text: '{crew} stays, sullen, and the rest notice.', crewHp: -10, actorHp: -10 } }] },
    ],
  },
  {
    id: 'brother',
    title: 'A Familiar Face',
    rarity: 'uncommon',
    text: 'As you pass a battered trading sloop, {crew} gives a shout. Leaning on her rail is the brother they have not seen in nine years.',
    choices: [
      { label: 'Heave to so they can meet', outcomes: [{ weight: 1, effect: { text: 'A tearful reunion, a long night of rum, and the brother asks to stay.', recruit: 1, navy: 0.5, crewHp: 5 } }] },
      { label: 'No time', outcomes: [{ weight: 1, effect: { text: '{crew} waves until the sloop is hull-down, and does not speak to you for a day.', actorHp: -10 } }] },
    ],
  },
  {
    id: 'lastlandfall',
    title: 'The Last Landfall',
    rarity: 'uncommon',
    unique: true,
    needs: { minCol: 6 },
    text: 'Beyond this island lies the channel, and the Navy’s blockade. It is the last friendly beach you will see before the open ocean, one way or another.',
    choices: [
      { label: 'One last night ashore', outcomes: [{ weight: 1, effect: { text: 'Bonfires, turtle, rum and songs. Whatever happens tomorrow, the crew are ready.', crewHp: 50, navy: 0.5 } }] },
      { label: 'Spend the day drilling the guns', outcomes: [{ weight: 1, effect: { text: 'From dawn till dusk the gun deck thunders. Tired, but sharp.', upgrade: 'guns', crewHp: -10 } }] },
      { label: 'Sail straight on', outcomes: [{ weight: 1, effect: { text: 'No sense waiting for the Navy to come to you.' } }] },
    ],
  },
];
