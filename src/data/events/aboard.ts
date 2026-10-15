import type { SeaEventDef } from '../../sim/types';

/** Life aboard: sickness, accidents, quarrels and the ship herself. These turn up while crossing open sea. */
export const ABOARD_EVENTS: SeaEventDef[] = [
  // --- Sickness and injury ----------------------------------------------------
  {
    id: 'fever',
    title: 'Fever Below Decks',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { crew: 3 },
    text: 'Yellow jack. {crew} is burning up in a hammock, and two more are shivering beside them. The rest are frightened.',
    choices: [
      { label: 'Buy quinine from a passing trader', cost: 20, outcomes: [{ weight: 1, effect: { text: 'The fever breaks within the day.', actorHp: 10 } }] },
      {
        label: 'Let it run its course',
        outcomes: [
          { weight: 3, effect: { text: 'The fever burns through the crew. They will be weak for days.', crewHp: -35 } },
          { weight: 1, effect: { text: 'The fever takes {crew} before it passes. You bury them at sea at dawn.', crewHp: -20, loseActor: true } },
        ],
      },
    ],
  },
  {
    id: 'scurvy',
    title: 'Scurvy',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { minCol: 3 },
    text: 'Too long at sea on salt pork and hard tack. {crew} shows you bleeding gums and old scars opening again.',
    choices: [
      { label: 'Break out the lime juice', cost: 15, outcomes: [{ weight: 1, effect: { text: 'Sour faces all round, but the sickness retreats.', crewHp: 15 } }] },
      { label: 'Put in at the next green island', outcomes: [{ weight: 1, effect: { text: 'Fresh fruit works its miracle, but the detour costs you time.', crewHp: 30, navy: 0.5 } }] },
      { label: 'Press on and pray for landfall', outcomes: [{ weight: 1, effect: { text: 'The scurvy spreads. Men stagger at their stations.', crewHp: -25 } }] },
    ],
  },
  {
    id: 'fall',
    title: 'Fall from the Rigging',
    pool: 'incident',
    text: 'A cry from aloft. {crew} has slipped from the topsail yard and lies crumpled on the deck.',
    variants: [
      'A block parts high on the mainmast and {crew} comes down with it, hitting the deck like a sack of shot.',
      'A sudden lurch in a cross-sea throws {crew} off the yard. They land hard among the guns.',
    ],
    choices: [
      {
        label: 'Carry them below to the surgeon',
        outcomes: [
          { weight: 4, effect: { text: 'A broken arm and a cracked head. {crew} will mend, slowly.', actorHp: -50 } },
          { weight: 1, effect: { text: 'Nothing the surgeon can do. {crew} dies before the watch changes.', loseActor: true } },
          { weight: 1, effect: { text: 'A miracle: {crew} landed on a coil of rope and walks away with bruises.', actorHp: -10 } },
        ],
      },
    ],
  },
  {
    id: 'cook',
    title: 'The Cook’s Chowder',
    pool: 'incident',
    text: 'Something was wrong with the fish in the chowder. Half the crew are hanging over the rail, and they blame {crew}, who made it.',
    variants: [
      '{crew}’s salt-pork stew has disagreed with everyone who ate it, which is everyone.',
    ],
    choices: [
      { label: 'Make {crew} eat a bowl of it', outcomes: [{ weight: 1, effect: { text: 'Justice is served, along with the rest of the chowder.', actorHp: -30, crewHp: -5 } }] },
      { label: 'Throw the pot overboard', outcomes: [{ weight: 1, effect: { text: 'The fish get their revenge. The crew are sick for a day.', crewHp: -15 } }] },
    ],
  },
  {
    id: 'barber',
    title: 'The Ship’s Barber',
    pool: 'incident',
    needs: { hurt: true },
    text: '{crew} used to cut hair in Wapping and swears they can stitch a wound as well as any surgeon.',
    choices: [
      {
        label: 'Let them try',
        outcomes: [
          { weight: 2, effect: { text: 'Neat stitches and clean dressings. The wounded mend faster.', crewHp: 25 } },
          { weight: 1, effect: { text: 'The stitches fester. Barbering is not surgery after all.', crewHp: -10 } },
        ],
      },
      { label: 'Heave to and rest the wounded', outcomes: [{ weight: 1, effect: { text: 'A quiet day at anchor does more than any needle.', crewHp: 30, navy: 0.5 } }] },
    ],
  },

  // --- Crew --------------------------------------------------------------------
  {
    id: 'brawl',
    title: 'Brawl in the Forecastle',
    pool: 'incident',
    needs: { crew: 3 },
    text: '{crew} and {crew2} have come to blows over a game of cards. A ring of sailors is cheering them on.',
    variants: [
      'Shouts from the forecastle: {crew} has accused {crew2} of stealing their tobacco, and fists are flying.',
      '{crew2} has made a joke about {crew}’s mother. It was not a good joke. Blood is being spilled.',
    ],
    choices: [
      { label: 'Let them fight it out', outcomes: [{ weight: 1, effect: { text: 'Black eyes and loosened teeth, then they share a bottle. Sailors.', actorHp: -25, actor2Hp: -25 } }] },
      { label: 'Flog them both', outcomes: [{ weight: 1, effect: { text: 'A dozen lashes each. Order is kept, and nobody plays cards for a while.', actorHp: -20, actor2Hp: -20 } }] },
      { label: 'Stop the rum for a week', outcomes: [{ weight: 1, effect: { text: 'The whole crew pays for two fools. They grumble at you, not at them.', crewHp: -10 } }] },
    ],
  },
  {
    id: 'duel',
    title: 'An Affair of Honour',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { crew: 4 },
    text: '{crew} has called {crew2} a liar and a coward. By the ship’s articles, quarrels are settled ashore, with pistols.',
    choices: [
      {
        label: 'Allow the duel on the next beach',
        outcomes: [
          { weight: 2, effect: { text: 'Both miss. Honour is satisfied and they go back to work as if nothing happened.' } },
          { weight: 2, effect: { text: '{crew2} takes a ball in the shoulder.', actor2Hp: -50 } },
          { weight: 1, effect: { text: '{crew2} falls on the sand and does not rise.', loseActor2: true } },
        ],
      },
      { label: 'Forbid it', outcomes: [{ weight: 1, effect: { text: 'They glare at each other for days, and the whole ship feels it.', crewHp: -10 } }] },
      { label: 'Make them share a watch until they settle it', outcomes: [{ weight: 1, effect: { text: 'By the third night they are laughing together at your expense.', crewHp: 5 } }] },
    ],
  },
  {
    id: 'stowaway',
    title: 'Stowaway',
    pool: 'incident',
    text: 'A thin, frightened youngster is dragged up from the cable tier, where they have been living on stolen biscuit since Tortuga.',
    variants: [
      '{crew} hauls a skinny figure out of a water cask in the hold, coughing and blinking. A stowaway.',
    ],
    choices: [
      { label: 'Sign them on', outcomes: [{ weight: 1, effect: { text: 'They swear on the articles, wide-eyed. Another pair of hands.', recruit: 1 } }] },
      { label: 'Put them ashore at the next island', outcomes: [{ weight: 1, effect: { text: 'You leave them on a beach with a knife and a cask of water.' } }] },
    ],
  },
  {
    id: 'dice',
    title: 'Dice Below Decks',
    pool: 'incident',
    needs: { crew: 3 },
    text: '{crew} has won the whole crew’s share of the last prize at dice. The losers are muttering about loaded bones.',
    variants: [
      'A dice game in the cable tier has got out of hand. {crew} has won everything, including other men’s boots.',
    ],
    choices: [
      { label: 'Order the winnings shared out', outcomes: [{ weight: 1, effect: { text: 'Peace returns. {crew} sulks.', actorHp: -5, crewHp: 5 } }] },
      { label: 'Confiscate the winnings for the ship', outcomes: [{ weight: 1, effect: { text: 'Into the ship’s chest it goes. Nobody is happy, but nobody is cheated.', gold: 12, crewHp: -10 } }] },
      { label: 'Inspect the dice', outcomes: [
        { weight: 1, effect: { text: 'Loaded, as everyone said. {crew} is flogged and the money returned.', actorHp: -30, crewHp: 5 } },
        { weight: 1, effect: { text: 'Honest dice. {crew} was simply lucky, and the grumblers are shamed.', crewHp: 5 } },
      ] },
    ],
  },
  {
    id: 'rumstore',
    title: 'The Rum Store Broken Into',
    pool: 'incident',
    text: 'Someone has prised the lock off the spirit room. A cask is missing and half the watch is giggling.',
    variants: [
      'The purser reports a cask of rum gone from the spirit room, and the middle watch can barely stand.',
      'Someone has bored a hole in the rum cask and been drinking from it with a straw. Half the crew smell of it.',
    ],
    choices: [
      { label: 'Find the culprit', outcomes: [{ weight: 1, effect: { text: 'It was {crew}, of course. Twenty lashes.', actorHp: -25 } }] },
      { label: 'Let it pass', outcomes: [{ weight: 1, effect: { text: 'A ship full of sore heads the next morning.', crewHp: -10 } }] },
      { label: 'Fit a stronger lock', cost: 5, outcomes: [{ weight: 1, effect: { text: 'A good brass lock. The giggling stops.' } }] },
    ],
  },
  {
    id: 'asleep',
    title: 'Asleep on Watch',
    pool: 'incident',
    text: 'You find {crew} snoring against the binnacle in the middle watch, with the ship drifting off course.',
    variants: [
      'The ship yaws off course in the dark. At the wheel you find {crew}, chin on chest, snoring.',
    ],
    choices: [
      { label: 'Flog them', outcomes: [{ weight: 1, effect: { text: 'Fair punishment by any articles. Nobody sleeps on watch for a while.', actorHp: -20 } }] },
      { label: 'Let them off with a warning', outcomes: [
        { weight: 1, effect: { text: '{crew} is so grateful they stand double watches for a week.' } },
        { weight: 1, effect: { text: 'They do it again two nights later, and you lose half a day.', navy: 0.5 } },
      ] },
    ],
  },
  {
    id: 'overboard',
    title: 'Man Overboard!',
    pool: 'incident',
    rarity: 'uncommon',
    text: 'A green sea sweeps the waist and {crew} is gone over the side, arms flailing in the wake.',
    choices: [
      {
        label: 'Heave to and lower a boat',
        outcomes: [
          { weight: 4, effect: { text: 'They haul {crew} back aboard, half drowned and furious. It costs you time.', actorHp: -20, navy: 0.5 } },
          { weight: 1, effect: { text: 'The boat searches until dark. Nothing.', loseActor: true, navy: 0.5 } },
        ],
      },
      {
        label: 'Throw a line and keep sailing',
        outcomes: [
          { weight: 1, effect: { text: '{crew} catches the line and is dragged aboard, skinned raw.', actorHp: -35 } },
          { weight: 1, effect: { text: 'The line falls short. {crew} is lost astern.', loseActor: true } },
        ],
      },
    ],
  },
  {
    id: 'mutiny',
    title: 'Grumbling Below',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { crew: 3, minCol: 3 },
    text: 'The crew mutter that the voyage has made the captain rich and them sore. {crew} leads a deputation to the mainmast.',
    choices: [
      { label: 'Pay out a share now', cost: 20, outcomes: [{ weight: 1, effect: { text: 'Coin and a double tot of rum. Spirits soar.', crewHp: 25 } }] },
      {
        label: 'Flog the ringleader',
        outcomes: [
          { weight: 1, effect: { text: 'The muttering stops, but nobody meets your eye.', actorHp: -30, crewHp: -10 } },
          { weight: 1, effect: { text: '{crew} jumps ship at the next landfall, and good riddance.', loseActor: true } },
        ],
      },
      {
        label: 'Promise riches at voyage’s end',
        outcomes: [
          { weight: 1, effect: { text: 'They believe you. For now.' } },
          { weight: 1, effect: { text: 'Fine words fill no bellies. The crew work sullenly.', crewHp: -20 } },
        ],
      },
    ],
  },
  {
    id: 'birthday',
    title: 'A Sailor’s Birthday',
    pool: 'incident',
    text: '{crew} turns forty today, which in this trade makes them something of a marvel.',
    variants: [
      'The crew have discovered it is {crew}’s birthday, and are dropping heavy hints about the rum.',
    ],
    choices: [
      { label: 'Double rum ration for all', cost: 5, outcomes: [{ weight: 1, effect: { text: 'Songs, a hornpipe, and a very happy {crew}.', crewHp: 15 } }] },
      { label: 'A song and a slap on the back', outcomes: [{ weight: 1, effect: { text: '{crew} pretends not to be disappointed.', crewHp: 5 } }] },
    ],
  },
  {
    id: 'shanty',
    title: 'A New Shanty',
    pool: 'incident',
    text: '{crew} has made up a shanty about the voyage. It is rude about the Navy, ruder about you, and the whole crew knows it by nightfall.',
    variants: [
      '{crew} has a fine voice and a new song about the Navy’s commodore. It does not flatter him.',
    ],
    choices: [
      { label: 'Join in the chorus', outcomes: [{ weight: 1, effect: { text: 'The capstan has never turned so fast.', crewHp: 10 } }] },
      { label: 'Ban the verse about you', outcomes: [{ weight: 1, effect: { text: 'Now they only hum that verse, loudly, whenever you pass.' } }] },
    ],
  },
  {
    id: 'kittens',
    title: 'Kittens in the Sail Locker',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { noFlag: 'cat' },
    text: 'The ship’s cat has had four kittens in a nest of old canvas. Hardened cutthroats are cooing at them.',
    choices: [
      { label: 'Keep them all', outcomes: [{ weight: 1, effect: { text: 'Ratcatchers for the next ten years, and the crew are soft as butter.', crewHp: 10, flag: 'cat' } }] },
      { label: 'Give them away at the next port', outcomes: [{ weight: 1, effect: { text: 'You are, the crew agree, a heartless monster.', crewHp: -5 } }] },
    ],
  },
  {
    id: 'rats',
    title: 'Rats in the Bread Room',
    pool: 'incident',
    text: 'The biscuit is crawling with weevils and the rats have eaten through two sacks of peas.',
    variants: [
      'A rat the size of a cat runs across the captain’s table at supper. The bread room, it turns out, is theirs now.',
    ],
    choices: [
      {
        label: 'Set the cats on them',
        needs: { flag: 'cat' },
        outcomes: [{ weight: 1, effect: { text: 'The cats feast for a week. The stores are saved.', crewHp: 5 } }],
      },
      { label: 'Throw out the spoiled stores and buy more', cost: 10, outcomes: [{ weight: 1, effect: { text: 'Expensive, but nobody starves.' } }] },
      { label: 'Eat around the weevils', outcomes: [{ weight: 1, effect: { text: 'Short rations and bellyaches.', crewHp: -15 } }] },
    ],
  },
  {
    id: 'luckycoin',
    title: 'The Doubloon in the Fish',
    pool: 'incident',
    rarity: 'rare',
    text: '{crew}, gutting a grouper for supper, holds up something gold. A Spanish doubloon, in the fish’s belly.',
    choices: [
      { label: 'A sign of fortune! Nail it to the mast', outcomes: [{ weight: 1, effect: { text: 'Every sailor touches it for luck on their way past.', crewHp: 15, flag: 'lucky' } }] },
      { label: 'Into the ship’s chest', outcomes: [{ weight: 1, effect: { text: 'Gold is gold.', gold: 15 } }] },
    ],
  },
  {
    id: 'albatross',
    title: 'An Albatross',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { noFlag: 'cursed' },
    text: 'A great albatross has followed the ship for three days, riding the wind above the mainmast. {crew} has a musket loaded.',
    choices: [
      { label: 'Leave it be', outcomes: [{ weight: 1, effect: { text: 'The crew take it as a good omen and work with a will.', crewHp: 10 } }] },
      { label: 'Shoot it for the pot', outcomes: [{ weight: 1, effect: { text: 'It falls into the sea. The old hands go very quiet.', flag: 'cursed', crewHp: -10 } }] },
    ],
  },
  {
    id: 'omens',
    title: 'Ill Omens',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { flag: 'cursed' },
    text: 'Ever since the albatross, the ship has been unlucky. Blocks fall, lines part, milk curdles. {crew} says the ship is cursed, and the crew believe it.',
    choices: [
      { label: 'Nail a horseshoe to the mainmast', cost: 5, outcomes: [{ weight: 1, effect: { text: 'Superstition answers superstition. The crew breathe easier.', clearFlag: 'cursed' } }] },
      { label: 'Laugh it off', outcomes: [{ weight: 1, effect: { text: 'That night a block falls from aloft and splits the mainmast cap.', damage: { sails: 1 } } }] },
    ],
  },

  // --- The ship ------------------------------------------------------------------
  {
    id: 'galleyfire',
    title: 'Fire in the Galley',
    pool: 'incident',
    rarity: 'uncommon',
    text: 'Fat in the galley stove has caught. Smoke pours up the companionway, and {crew} is beating at the flames with a wet sail.',
    choices: [
      {
        label: 'Form a bucket chain',
        outcomes: [
          { weight: 2, effect: { text: 'Out in minutes. Scorched planking and a singed {crew}.', actorHp: -20, hull: -1 } },
          { weight: 1, effect: { text: 'It spreads into the surgeon’s stores before it is out.', actorHp: -25, damage: { surgeon: 1 } } },
        ],
      },
    ],
  },
  {
    id: 'damppowder',
    title: 'Damp Powder',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { minCol: 2 },
    text: 'Seawater has got into the magazine. Half the powder has caked into lumps.',
    choices: [
      { label: 'Dry it on deck in the sun', outcomes: [{ weight: 1, effect: { text: 'A day hove to with powder spread on sailcloth, everybody terrified of a spark.', navy: 0.5 } }] },
      { label: 'Use it as it is', outcomes: [{ weight: 1, effect: { text: 'The guns will hang fire until the gunners can sort good from bad.', damage: { guns: 1 } } }] },
      { label: 'Buy fresh powder off a trader', cost: 15, outcomes: [{ weight: 1, effect: { text: 'Fine-corned powder, dry as a bone.' } }] },
    ],
  },
  {
    id: 'sprungmast',
    title: 'Sprung Topmast',
    pool: 'incident',
    rarity: 'uncommon',
    text: 'A crack like a gunshot aloft: the fore-topmast has sprung in the gusts.',
    choices: [
      { label: 'Fish it with spare spars', outcomes: [{ weight: 1, effect: { text: 'Hours of work aloft, but she carries sail again.', navy: 0.5 } }] },
      { label: 'Carry on under reduced sail', outcomes: [{ weight: 1, effect: { text: 'You limp on with the rig weakened.', damage: { sails: 1 } } }] },
    ],
  },
  {
    id: 'pumpjam',
    title: 'The Pumps Choke',
    pool: 'incident',
    text: 'The chain pump has jammed solid with gravel ballast, and water is rising in the well.',
    variants: [
      'The pumps clank, cough and stop. The carpenter sounds the well: two feet of water, and rising.',
    ],
    choices: [
      { label: 'Send {crew} down into the bilge to clear it', outcomes: [
        { weight: 2, effect: { text: '{crew} comes up black with filth, holding a fistful of stones. The pumps clank back to life.', actorHp: -10 } },
        { weight: 1, effect: { text: '{crew} clears it, but cuts a hand to the bone on the chain.', actorHp: -35 } },
      ] },
      { label: 'Bail with buckets until there is time', outcomes: [{ weight: 1, effect: { text: 'You stay afloat, but the pump will need a proper repair.', damage: { pumps: 1 } } }] },
    ],
  },
  {
    id: 'rot',
    title: 'Rot in the Timbers',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { minCol: 2 },
    text: '{crew}, sounding the well, pushes a marlinspike straight through a futtock. The wood is soft as cheese.',
    choices: [
      { label: 'Cut out the rot and patch it', outcomes: [{ weight: 1, effect: { text: 'She is weaker for it, but sound.', hull: -2 } }] },
      {
        label: 'Pitch over it and hope',
        outcomes: [
          { weight: 1, effect: { text: 'Out of sight, out of mind.' } },
          { weight: 1, effect: { text: 'The rot was deeper than it looked. A whole strake gives way in the next blow.', hull: -5 } },
        ],
      },
    ],
  },
  {
    id: 'barnacles',
    title: 'A Foul Bottom',
    pool: 'incident',
    rarity: 'uncommon',
    needs: { minCol: 3 },
    text: 'Weed and barnacles trail from her bottom in green beards. She sails like a haystack.',
    choices: [
      { label: 'Careen her on the next beach', outcomes: [{ weight: 1, effect: { text: 'Two days on her side, scraping and paying the seams. She flies again.', navy: 1, hull: 4 } }] },
      { label: 'Sail on, slower', outcomes: [{ weight: 1, effect: { text: 'The Navy’s ships have copper bottoms. Yours does not.', navy: 0.5 } }] },
    ],
  },
];
