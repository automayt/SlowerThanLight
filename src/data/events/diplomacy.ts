import type { SeaEventDef } from '../../sim/types';

/** Meetings that change how the powers at sea regard you: leagues, envoys, bounties and old grudges settled. */
export const DIPLOMACY_EVENTS: SeaEventDef[] = [
  {
    id: 'council',
    title: 'The Brethren’s Council',
    rarity: 'uncommon',
    unique: true,
    needs: { minCol: 1, standing: { brethren: -20 } },
    text: 'On a sandy cay, the captains of a dozen pirate crews sit in council under a sailcloth awning, a cask of rum for a table. They are talking of a league against the blockade.',
    choices: [
      {
        label: 'Swear to the articles and pay into the common chest',
        cost: 30,
        outcomes: [{ weight: 1, effect: { text: 'The captains drink your health. Wherever the Brethren sail now, you have friends.', standing: { brethren: 30 } } }],
      },
      {
        label: 'Speak against the Crown',
        needs: { crew: 3 },
        outcomes: [{ weight: 1, effect: { text: 'Your speech is repeated in every tavern from Nassau to the Main, and a copy reaches the Governor of Jamaica.', standing: { brethren: 15, crown: -10 } } }],
      },
      {
        label: 'Sell their plans to the Navy',
        outcomes: [{ weight: 1, effect: { text: 'The Navy pays well for names. The Brethren will find out; they always do.', gold: 60, standing: { brethren: -40, crown: 15 } } }],
      },
      { label: 'Keep your own counsel', outcomes: [{ weight: 1, effect: { text: 'You drink their rum, say nothing, and sail on the morning tide.' } }] },
    ],
  },
  {
    id: 'envoy',
    title: 'The Spanish Envoy',
    rarity: 'uncommon',
    unique: true,
    needs: { minSector: 1 },
    text: 'A Spanish pinnace under a flag of truce. A grandee in black velvet would buy news of English patrols, and offers the friendship of the Viceroy in return.',
    choices: [
      {
        label: 'Sell him what you know',
        outcomes: [{ weight: 1, effect: { text: 'He writes down every word. The Viceroy, he promises, does not forget a friend.', gold: 20, standing: { spain: 25, crown: -10 } } }],
      },
      {
        label: 'Hold him for ransom',
        outcomes: [{ weight: 1, effect: { text: 'Spain pays in silver, and then in guarda costas.', gold: 60, standing: { spain: -30 } } }],
      },
      { label: 'Send him on his way', outcomes: [{ weight: 1, effect: { text: 'He bows stiffly. A gentleman, he says, knows another.', standing: { spain: 5 } } }] },
    ],
  },
  {
    id: 'compact',
    title: 'The Merchants’ Compact',
    rarity: 'uncommon',
    unique: true,
    needs: { minCol: 1 },
    text: 'An agent of the Bridgetown merchant houses rows out with a proposition: a captain who lets their ships pass unmolested will find their ports generous and their governors deaf.',
    choices: [
      {
        label: 'Take their money and fly their pennant',
        outcomes: [{ weight: 1, effect: { text: 'A purse and a strip of bunting. Some of the Brethren call you a merchant’s dog.', gold: 30, standing: { trade: 25, brethren: -10 } } }],
      },
      {
        label: 'Tell him what you think of merchants',
        outcomes: [{ weight: 1, effect: { text: 'The crew cheer him all the way back to his boat, mostly with rotten fruit.', crewHp: 5, standing: { trade: -10, brethren: 5 } } }],
      },
    ],
  },
  {
    id: 'bounty',
    title: 'A Price on Your Head',
    rarity: 'uncommon',
    unique: true,
    needs: { standing: { crown: { max: -55 } } },
    text: 'Your face is on a printed bill in every Crown port, and a privateer schooner has been sniffing along your wake for two days. The Crown wants you, alive or otherwise.',
    choices: [
      { label: 'Turn and fight the bounty hunters', outcomes: [{ weight: 1, effect: { text: 'You come about on her. She did not expect that.', battle: 'privateer' } }] },
      {
        label: 'Pay a governor to call off the hunt',
        cost: 50,
        outcomes: [{ weight: 1, effect: { text: 'A quiet word, a heavy purse, and the bills come down from the tavern walls.', standing: { crown: 25 } } }],
      },
      { label: 'Lie low among the cays', outcomes: [{ weight: 1, effect: { text: 'Two days at anchor in a mangrove creek. The hunters go by, and the hunt cools a little.', navy: 0.5, standing: { crown: 5 } } }] },
    ],
  },
  {
    id: 'grudge',
    title: 'An Old Grudge',
    rarity: 'uncommon',
    unique: true,
    needs: { standing: { brethren: { max: -25 } } },
    text: 'A pirate sloop runs down on you with a red flag at the masthead: no quarter. Her captain has a list of what you have done to the Brethren, and has nailed it to the mast.',
    choices: [
      { label: 'Give him the fight he wants', outcomes: [{ weight: 1, effect: { text: 'Then let it be settled.', battle: 'rival' } }] },
      {
        label: 'Pay blood money for the wrongs',
        cost: 40,
        outcomes: [{ weight: 1, effect: { text: 'He counts it twice, spits, and strikes the red flag. Word goes round the coast that you paid your debts.', standing: { brethren: 30 } } }],
      },
      {
        label: 'Challenge him to settle it captain to captain',
        needs: { crew: 3 },
        outcomes: [
          { weight: 1, effect: { text: 'Cutlasses on the beach at dawn. You win, and spare him. The Brethren respect that more than gold.', actorHp: -25, standing: { brethren: 35 } } },
          { weight: 1, effect: { text: 'He is the better blade. {crew} drags you off the sand before he can finish it, and his crew laugh you out of the cove.', actorHp: -40, crewHp: -15, standing: { brethren: 10 } } },
        ],
      },
    ],
  },
  {
    id: 'truce',
    title: 'Under a Flag of Truce',
    rarity: 'rare',
    unique: true,
    needs: { minCol: 3, standing: { france: 20 } },
    text: 'The French corsair captains are gathering to strike at English shipping. Their commodore sends a boat: will you sail with France, as an ally, until the blockade is broken?',
    choices: [
      {
        label: 'Sign the alliance',
        outcomes: [{ weight: 1, effect: { text: 'You sign with a flourish. French squadrons will draw off the King’s ships, and French captains will stand by you.', standing: { france: 40, crown: -15 } } }],
      },
      { label: 'Thank him, and keep your freedom', outcomes: [{ weight: 1, effect: { text: 'He shrugs. The offer, he says, will not be made twice.', standing: { france: -5 } } }] },
    ],
  },
];
