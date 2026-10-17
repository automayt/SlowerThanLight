import type { SeaEventDef } from '../../sim/types';

/**
 * Rare and legendary events, story chains and once-a-voyage meetings.
 * Pages with pool 'chain' are only reached through another event's `next`.
 */
export const LEGEND_EVENTS: SeaEventDef[] = [
  // --- The King's Pardon: an alternative ending ----------------------------------
  {
    id: 'pardon',
    title: 'The King’s Pardon',
    rarity: 'legendary',
    unique: true,
    needs: { minCol: 4 },
    text: 'A sloop under a flag of truce brings a printed proclamation. His Majesty King George offers a full pardon to any pirate who surrenders to a royal governor before the year is out. No questions asked about past plunder.',
    choices: [
      {
        label: 'Accept, and retire on your gold',
        needs: { gold: 100 },
        outcomes: [{ weight: 1, effect: { text: 'You sail into Nassau under a white flag, sign the Governor’s book, and buy the best tavern on the waterfront. The crew drink there free for life.', ending: 'The King’s Pardon' } }],
      },
      {
        label: 'Accept, though your pockets are light',
        outcomes: [{ weight: 1, effect: { text: 'You take the pardon and a berth as mate on a logwood trader. It is honest work. You hate every minute of it.', ending: 'Pardoned and Penniless' } }],
      },
      { label: 'Tear it up in front of the crew', outcomes: [{ weight: 1, effect: { text: 'The crew roar their approval. No king owns this ship.', crewHp: 20, standing: { brethren: 10, crown: -10 } } }] },
    ],
  },

  // --- Blackbeard -------------------------------------------------------------------
  {
    id: 'blackbeard',
    title: 'Queen Anne’s Revenge',
    rarity: 'legendary',
    unique: true,
    text: 'A great black-hulled ship, forty guns, flying a flag with a horned skeleton spearing a heart. Blackbeard himself. He signals you to come aboard for supper.',
    choices: [
      { label: 'Accept the invitation', outcomes: [{ weight: 1, effect: { text: 'You are rowed across with {crew} at your side.', next: 'blackbeard-supper' } }] },
      { label: 'Make sail and pretend you did not see', outcomes: [{ weight: 1, effect: { text: 'He lets you go, laughing. Nobody refuses Blackbeard twice, but once is allowed.' } }] },
    ],
  },
  {
    id: 'blackbeard-supper',
    title: 'Supper with Blackbeard',
    pool: 'chain',
    unique: true,
    text: 'Slow-match smoulders in his braided beard. Halfway through the rum he blows out the candle, and in the dark you hear two pistols being cocked under the table.',
    choices: [
      {
        label: 'Keep drinking as if nothing happened',
        outcomes: [
          { weight: 1, effect: { text: 'He fires. The ball takes {crew} in the knee. "If I did not now and then kill one of you," he says, "you would forget who I am." Then he gives you a gun as an apology.', actorHp: -60, gun: 'pdr18' } },
          { weight: 1, effect: { text: 'The candle is relit. He grins. "You have nerve." He sends you back with a fine 18-pounder and his compliments.', gun: 'pdr18' } },
        ],
      },
      { label: 'Offer him a share of your plunder', cost: 30, outcomes: [{ weight: 1, effect: { text: 'He laughs and pockets it. "I will lead the King’s ships a merry dance for you." He does.', navy: -2, flag: 'blackbeard', standing: { brethren: 10 } } }] },
      { label: 'Find an excuse to leave', outcomes: [{ weight: 1, effect: { text: 'You back out of the cabin and row hard. Behind you he is roaring with laughter.' } }] },
    ],
  },

  // --- Calico Jack's crew -------------------------------------------------------------
  {
    id: 'calico',
    title: 'Calico Jack’s Sloop',
    rarity: 'rare',
    unique: true,
    needs: { minCol: 2 },
    text: 'Calico Jack Rackham’s sloop lies at anchor, her crew dead drunk on looted rum. Two of them are not drunk at all: they are women, cutlass in hand, and furious with their captain.',
    choices: [
      { label: 'Invite them to sail with you', outcomes: [{ weight: 1, effect: { text: 'Anne Bonny will not leave Jack. But Mary Read spits over the side and climbs down into your boat.', recruitName: 'Mary Read' } }] },
      { label: 'Warn them the Navy is coming', outcomes: [{ weight: 1, effect: { text: 'They thank you, and Jack sends over a cask of his best in gratitude.', crewHp: 15 } }] },
    ],
  },

  // --- The Flying Dutchman ----------------------------------------------------------
  {
    id: 'dutchman',
    title: 'A Ship Out of Time',
    rarity: 'legendary',
    unique: true,
    text: 'At midnight, in a flat calm, a ship comes up under full sail with no wind to drive her. Her rig is a hundred years out of fashion. A pale light burns at her stern.',
    choices: [
      { label: 'Hail her', outcomes: [{ weight: 1, effect: { text: 'A voice like the bottom of a well answers you.', next: 'dutchman-hail' } }] },
      { label: 'Douse every light and pray', outcomes: [{ weight: 1, effect: { text: 'She passes a pistol-shot away, and then she is simply gone. Nobody sleeps that night.', crewHp: -20 } }] },
    ],
  },
  {
    id: 'dutchman-hail',
    title: 'Letters for the Dead',
    pool: 'chain',
    unique: true,
    text: 'Her captain asks you to carry a packet of letters home to Amsterdam. The addresses are to people a century dead. His crew watch you with eyes like old coins.',
    choices: [
      { label: 'Take the letters', outcomes: [{ weight: 1, effect: { text: 'The packet is cold as ice. From that night on, a fog follows the ship whenever the Navy draws near.', navy: -1.5, flag: 'dutchman', crewHp: -10 } }] },
      { label: 'Refuse him', outcomes: [{ weight: 1, effect: { text: 'He bows, and his ship fades like breath on a glass. Something of her chill stays aboard.', crewHp: -25, flag: 'cursed' } }] },
      { label: 'Ask what he will pay', outcomes: [{ weight: 1, effect: { text: 'He tosses across a purse. The coins are Spanish, minted in 1600, and perfectly real.', gold: 60, flag: 'cursed' } }] },
    ],
  },

  // --- Something below ---------------------------------------------------------------
  {
    id: 'kraken',
    title: 'Something Below',
    rarity: 'legendary',
    unique: true,
    needs: { minCol: 2 },
    text: 'The ship shudders to a stop in open water. Then arms as thick as a mast come up over the rail, suckered and grey, and one of them closes around {crew}.',
    choices: [
      {
        label: 'Axes! Hack it loose!',
        outcomes: [
          { weight: 2, effect: { text: 'Severed arms flop on the deck. It lets go and sinks away, and {crew} is pulled free, crushed and gasping.', actorHp: -50, hull: -2 } },
          { weight: 1, effect: { text: 'It drags {crew} over the side before anyone can reach them.', loseActor: true, hull: -2 } },
        ],
      },
      {
        label: 'Depress the guns and fire into the water',
        outcomes: [
          { weight: 1, effect: { text: 'The broadside churns the sea white. It lets go, and a great lump of ambergris floats up in the slick.', gold: 60, actorHp: -30, damage: { guns: 1 } } },
          { weight: 1, effect: { text: 'The recoil splits two carriages, but the thing lets go and is gone.', actorHp: -30, damage: { guns: 2 } } },
        ],
      },
    ],
  },

  // --- The Governor's daughter ----------------------------------------------------------
  {
    id: 'governor',
    title: 'The Governor’s Daughter',
    rarity: 'rare',
    unique: true,
    needs: { minCol: 2 },
    text: 'A pleasure barge drifts with a broken rudder. Aboard is Lady Arabella Fairfax, daughter of the Governor of Jamaica, with a parasol and a remarkably steady gaze.',
    choices: [
      { label: 'Hold her for ransom', outcomes: [{ weight: 1, effect: { text: 'The Governor pays, and then sends every ship he has after you.', gold: 80, navy: 1.5, standing: { crown: -15 } } }] },
      { label: 'Return her with your compliments', outcomes: [{ weight: 1, effect: { text: 'The Governor, mortified and grateful, finds reasons to keep the squadron in port for a week.', navy: -1.5, flag: 'gallant', standing: { crown: 15 } } }] },
      { label: 'Ask what she wants', outcomes: [{ weight: 1, effect: { text: 'She closes the parasol. "What I want, Captain, is to never go back."', next: 'governor-wish' } }] },
    ],
  },
  {
    id: 'governor-wish',
    title: 'Lady Arabella’s Request',
    pool: 'chain',
    unique: true,
    text: 'She can navigate by the stars, keep accounts, and fire a pistol, and she would rather hang than marry the old admiral her father has chosen for her.',
    choices: [
      { label: 'Sign her on', outcomes: [{ weight: 1, effect: { text: 'She signs the articles in a neat hand. The Governor will be apoplectic, and the Navy doubly keen.', recruitName: 'Arabella Fairfax', navy: 1, standing: { crown: -10 } } }] },
      { label: 'Take her home anyway', outcomes: [{ weight: 1, effect: { text: 'She does not speak to you again. Her father, however, is grateful.', navy: -1, standing: { crown: 10 } } }] },
    ],
  },

  // --- A letter of marque -----------------------------------------------------------------
  {
    id: 'marque',
    title: 'A French Commission',
    rarity: 'rare',
    unique: true,
    text: 'A French agent with a lace cravat comes aboard from a fishing boat. France will issue you a letter of marque against English shipping. You would be a privateer, not a pirate.',
    choices: [
      { label: 'Accept the commission', outcomes: [{ weight: 1, effect: { text: 'Navy captains hesitate to hang a man with French papers. The squadron’s orders are suddenly less clear.', navy: -1.5, flag: 'marque', standing: { france: 30, crown: -10 } } }] },
      { label: 'Decline politely', outcomes: [{ weight: 1, effect: { text: 'He shrugs in a very French way and leaves you a bottle of brandy.', crewHp: 5 } }] },
    ],
  },

  // --- The midshipman ---------------------------------------------------------------------
  {
    id: 'midshipman',
    title: 'The Admiral’s Nephew',
    rarity: 'rare',
    unique: true,
    text: 'You pull a half-drowned boy of fourteen out of the sea, still clinging to a spar. His uniform says midshipman. He tells you, proudly, that his uncle is an admiral.',
    choices: [
      { label: 'Ransom him', outcomes: [{ weight: 1, effect: { text: 'The admiral pays handsomely, and swears to see you hang.', gold: 50, navy: 1, standing: { crown: -10 } } }] },
      { label: 'Put him ashore near a Navy station', outcomes: [{ weight: 1, effect: { text: 'He salutes you from the beach. His report, you hear later, is very confused about your heading.', navy: -1, flag: 'gallant', standing: { crown: 10 } } }] },
      { label: 'Teach him a real sailor’s trade', outcomes: [{ weight: 1, effect: { text: 'He takes to piracy like a duck to water.', recruitName: 'Midshipman Pell' } }] },
    ],
  },

  // --- The treasure map: three meetings across the voyage ---------------------------------
  {
    id: 'torn-map',
    title: 'Half a Map',
    rarity: 'rare',
    needs: { noFlag: 'map-half', maxCol: 4 },
    unique: true,
    text: 'A dead man in a drifting jolly boat, a knife in his back and a scrap of chart clutched in his fist. It is torn neatly in half.',
    choices: [
      { label: 'Take the half chart', outcomes: [{ weight: 1, effect: { text: 'An island, an anchorage, and half a set of bearings. Somebody has the other half.', flag: 'map-half' } }] },
      { label: 'Give him a sailor’s burial', outcomes: [{ weight: 1, effect: { text: 'You sew him into his hammock with a round shot at his feet.' } }] },
    ],
  },
  {
    id: 'cartographer',
    title: 'The Old Cartographer',
    rarity: 'uncommon',
    unique: true,
    needs: { flag: 'map-half', noFlag: 'map-whole' },
    text: 'On a cay with a single hut lives a half-blind map-maker. When you show him your scrap, he laughs and takes its twin from his sea chest.',
    choices: [
      { label: 'Buy his half', cost: 25, outcomes: [{ weight: 1, effect: { text: 'The halves match perfectly. Now you know where to dig.', flag: 'map-whole', clearFlag: 'map-half' } }] },
      {
        label: 'Take it from him',
        outcomes: [
          { weight: 1, effect: { text: 'You snatch it and run for the boat, with the old man’s curses and a fowling piece behind you.', flag: 'map-whole', clearFlag: 'map-half', actorHp: -25 } },
          { weight: 1, effect: { text: 'He throws it in the fire rather than let you have it.', clearFlag: 'map-half' } },
        ],
      },
    ],
  },
  {
    id: 'treasure-island',
    title: 'The Island on the Map',
    rarity: 'common',
    unique: true,
    needs: { flag: 'map-whole' },
    text: 'There it is: the anchorage, the split rock, the three palms. Exactly as the map said.',
    choices: [
      { label: 'Row ashore and dig', outcomes: [{ weight: 1, effect: { text: 'Shovels bite into the sand beneath the split rock.', next: 'treasure-dig' } }] },
      { label: 'Mark it and come back when the Navy is gone', outcomes: [{ weight: 1, effect: { text: 'Some day.' } }] },
    ],
  },
  {
    id: 'treasure-dig',
    title: 'X Marks the Spot',
    pool: 'chain',
    unique: true,
    text: 'Six feet down, a shovel rings on iron. A chest, bound and padlocked, and beside it a skeleton with its jaw hanging open as if surprised.',
    choices: [
      {
        label: 'Break it open',
        outcomes: [
          { weight: 3, effect: { text: 'Doubloons, pieces of eight, a jewelled crucifix. A king’s ransom, or near enough.', gold: 130, navy: 0.5, flag: 'treasure', clearFlag: 'map-whole' } },
          { weight: 1, effect: { text: 'Half the chest is lead shot, the old thief’s joke. The other half is gold.', gold: 70, navy: 0.5, flag: 'treasure', clearFlag: 'map-whole' } },
        ],
      },
    ],
  },
];
