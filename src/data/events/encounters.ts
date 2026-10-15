import type { SeaEventDef } from '../../sim/types';

/** People, ships and places met at "Unknown" nodes on the chart. */
export const ENCOUNTER_EVENTS: SeaEventDef[] = [
  // --- People in trouble ------------------------------------------------------
  {
    id: 'castaway',
    title: 'Castaway',
    text: 'A ragged figure on a sandbar waves a shirt on a stick. Your lookout swears there is no one else on the island.',
    choices: [
      {
        label: 'Send a boat',
        outcomes: [
          { weight: 3, effect: { text: 'A sailmaker marooned for cheating at cards. They sign the articles gladly.', recruit: 1 } },
          { weight: 1, effect: { text: 'A Navy lookout on the dune fires a signal rocket as your boat pulls away. They know where you are.', navy: 1 } },
        ],
      },
      { label: 'Sail on', outcomes: [{ weight: 1, effect: { text: 'You leave the poor soul to the gulls.' } }] },
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
    id: 'fishermen',
    title: 'Fishermen in Distress',
    text: 'A fishing smack is foundering in a short sea, her crew bailing with their hats.',
    choices: [
      {
        label: 'Take them off',
        outcomes: [
          { weight: 1, effect: { text: 'They pay you in the only coin they have: a bag of river pearls.', gold: 15, navy: 0.5 } },
          { weight: 1, effect: { text: 'Their boat is lost, and the youngest of them asks to stay aboard yours.', recruit: 1, navy: 0.5 } },
        ],
      },
      { label: 'Sail past', outcomes: [{ weight: 1, effect: { text: 'Your crew watch them go down in silence. Some of them were fishermen once.', crewHp: -10 } }] },
    ],
  },
  {
    id: 'mutineers',
    title: 'Mutineers’ Longboat',
    rarity: 'uncommon',
    text: 'A longboat crammed with sunburnt men pulls toward you. They have mutinied from a Navy sloop and set her officers adrift. Now they want to go on the account.',
    choices: [
      { label: 'Welcome them aboard', outcomes: [{ weight: 1, effect: { text: 'Prime seamen, every one, and now the Navy wants them as badly as it wants you.', recruit: 2, navy: 0.5 } }] },
      { label: 'Turn them in for the bounty', outcomes: [{ weight: 1, effect: { text: 'You collect at the next port. Your own crew look at you differently afterwards.', gold: 35, crewHp: -15 } }] },
      { label: 'Give them water and point them west', outcomes: [{ weight: 1, effect: { text: 'They row away cheering.' } }] },
    ],
  },
  {
    id: 'plagueboat',
    title: 'A Silent Ship',
    rarity: 'uncommon',
    text: 'A trading sloop drifts with her sails in rags. No one answers your hail. There are shapes lying on her deck.',
    choices: [
      {
        label: 'Board and search her',
        outcomes: [
          { weight: 1, effect: { text: 'Plague dead, all of them, but her strongbox is full.', gold: 35 } },
          { weight: 1, effect: { text: 'Whatever killed them comes back aboard with your boarders.', gold: 15, crewHp: -35 } },
        ],
      },
      { label: 'Burn her and stand off', outcomes: [{ weight: 1, effect: { text: 'She burns to the waterline. Better safe.' } }] },
    ],
  },

  // --- Salvage and treasure ----------------------------------------------------
  {
    id: 'wreck',
    title: 'Drifting Wreck',
    text: 'Spars and barrels bob around a half-sunk merchantman. Her stern cabin is still above water.',
    choices: [
      {
        label: 'Salvage what you can',
        outcomes: [
          { weight: 3, effect: { text: 'Your men pry open a strongbox in the captain’s cabin. Silver!', gold: 25 } },
          { weight: 2, effect: { text: 'A powder keg goes up as the hatch gives way. A handful of coins, and {crew} badly burned.', gold: 8, actorHp: -40 } },
        ],
      },
      { label: 'Leave her to the sea', outcomes: [{ weight: 1, effect: { text: 'Some other scavenger will have her.' } }] },
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
    id: 'battery',
    title: 'Abandoned Battery',
    rarity: 'uncommon',
    text: 'On a jungle headland stands a ruined Spanish battery. One great gun still sits on its rotting carriage, staring out to sea.',
    choices: [
      {
        label: 'Haul the gun down to the boats',
        outcomes: [
          { weight: 3, effect: { text: 'A day of sweat, block and tackle, and she is yours.', gun: 'pdr12', crewHp: -10 } },
          { weight: 1, effect: { text: 'The carriage gives way halfway down the slope. The gun is lost in the surf, and {crew} is crushed beneath it.', actorHp: -60 } },
        ],
      },
      { label: 'Leave it to the jungle', outcomes: [{ weight: 1, effect: { text: 'The old gun keeps its lonely watch.' } }] },
    ],
  },
  {
    id: 'pearls',
    title: 'Pearl Divers’ Lagoon',
    rarity: 'uncommon',
    text: 'A lagoon where divers bring up oysters by the basketful. They offer to trade, or you could try your own luck.',
    choices: [
      {
        label: 'Trade for a pouch of pearls',
        cost: 20,
        outcomes: [
          { weight: 2, effect: { text: 'Fine, round, and worth twice what you paid in any port.', gold: 45 } },
          { weight: 1, effect: { text: 'Paste and fish scales. You have been had.' } },
        ],
      },
      {
        label: 'Send {crew} diving',
        outcomes: [
          { weight: 2, effect: { text: '{crew} surfaces grinning, a fistful of pearls in each hand.', gold: 25, actorHp: -10 } },
          { weight: 1, effect: { text: 'A shark. {crew} is dragged out of the water torn and bleeding.', actorHp: -55 } },
        ],
      },
    ],
  },
  {
    id: 'shallowwreck',
    title: 'Wreck on the Shallows',
    rarity: 'rare',
    needs: { crew: 3 },
    text: 'In three fathoms of clear water lies an old galleon’s skeleton, her ribs furred with coral. Something glints among the ballast stones.',
    choices: [
      {
        label: 'Dive for silver',
        outcomes: [
          { weight: 3, effect: { text: 'Pieces of eight, black with age, by the bucketload.', gold: 55, crewHp: -10 } },
          { weight: 1, effect: { text: 'A bronze swivel gun, perfectly preserved, and a few coins.', gun: 'pdr6', gold: 15 } },
          { weight: 1, effect: { text: '{crew} goes down and does not come up. A moray, or the cold, or something else.', loseActor: true, gold: 20 } },
        ],
      },
      { label: 'Leave the dead in peace', outcomes: [{ weight: 1, effect: { text: 'Some of the old hands nod approvingly.' } }] },
    ],
  },

  // --- Places --------------------------------------------------------------------
  {
    id: 'village',
    title: 'Fishing Village',
    text: 'Smoke rises from a little cove where fishing boats are drawn up on the beach.',
    choices: [
      { label: 'Trade for fresh food', cost: 10, outcomes: [{ weight: 1, effect: { text: 'Fresh water, fruit and turtle stew. The crew are new men.', crewHp: 100 } }] },
      { label: 'Raid the village', outcomes: [{ weight: 1, effect: { text: 'Easy pickings, but word of the raid will reach the Navy before nightfall.', gold: 30, navy: 1, crewHp: -5 } }] },
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
    id: 'cove',
    title: 'Hidden Cove',
    text: 'A deep, hidden cove with a sloping beach and a freshwater stream: a pirate’s dream of a careening ground.',
    choices: [
      { label: 'Careen her and scrape her clean', outcomes: [{ weight: 1, effect: { text: 'Two days’ hard work. She comes off the beach tight and fast.', hull: 6, repair: true, navy: 1 } }] },
      { label: 'Fill the water casks and go', outcomes: [{ weight: 1, effect: { text: 'Sweet water, and an afternoon swim for the watch below.', crewHp: 15 } }] },
    ],
  },
  {
    id: 'turtles',
    title: 'Turtle Beach',
    text: 'The beach is crawling with green turtles come ashore to lay. Fresh meat that keeps alive in the hold for weeks.',
    choices: [
      { label: 'Stock the hold', outcomes: [{ weight: 1, effect: { text: 'Turtle soup every night. Nobody will get scurvy on this ship.', crewHp: 25, navy: 0.5 } }] },
      { label: 'Take a few and sail on', outcomes: [{ weight: 1, effect: { text: 'A feast tonight, at least.', crewHp: 10 } }] },
    ],
  },
  {
    id: 'volcano',
    title: 'The Smoking Island',
    rarity: 'rare',
    needs: { minCol: 2 },
    text: 'A cone-shaped island rumbles and smokes. Yellow crusts of sulphur cake the rocks along the shore.',
    choices: [
      { label: 'Gather sulphur for better powder', outcomes: [{ weight: 1, effect: { text: 'Choking, scalding work. Your gunner mixes powder fiercer than anything the Navy has.', upgrade: 'guns', crewHp: -20 } }] },
      { label: 'Stand off and watch it', outcomes: [{ weight: 1, effect: { text: 'That night the mountain lights the sky red. Nobody aboard will forget it.', crewHp: 5 } }] },
    ],
  },
  {
    id: 'hermit',
    title: 'The Hermit of the Cays',
    rarity: 'rare',
    unique: true,
    text: 'A white-bearded old man in goatskins hails you from a cay. He was a buccaneer with Morgan, he says, marooned thirty years ago for a quarrel he no longer remembers.',
    choices: [
      { label: 'Bring him aboard', outcomes: [{ weight: 1, effect: { text: 'Old Ben knows a channel through the reefs that is on no Navy chart.', recruitName: 'Old Ben Gorse', navy: -1 } }] },
      { label: 'Leave him your spare tobacco', outcomes: [{ weight: 1, effect: { text: 'He weeps with joy and tells you where he buried his share in ’71.', gold: 30 } }] },
    ],
  },

  // --- Ships --------------------------------------------------------------------
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
    id: 'picket',
    title: 'Navy Picket',
    text: 'A Navy cutter is shadowing you from the horizon, no doubt signalling the fleet.',
    choices: [
      { label: 'Turn and fight her', outcomes: [{ weight: 1, effect: { text: 'You come about and run out the guns.', battle: 'cutter' } }] },
      { label: 'Lose her in the night', outcomes: [{ weight: 1, effect: { text: 'You douse every lantern and slip away, but it costs you time.', navy: 0.5 } }] },
    ],
  },
  {
    id: 'convoy',
    title: 'Merchant Convoy',
    rarity: 'uncommon',
    text: 'A dozen merchantmen in convoy, shepherded by a single Navy sloop that cannot be everywhere at once.',
    choices: [
      {
        label: 'Cut out a straggler at dusk',
        outcomes: [
          { weight: 2, effect: { text: 'You come down on the last ship in the line before the escort can turn.', battle: 'merchant' } },
          { weight: 1, effect: { text: 'The escort was waiting for exactly that.', battle: 'cutter' } },
        ],
      },
      { label: 'Let them pass', outcomes: [{ weight: 1, effect: { text: 'Not today.' } }] },
    ],
  },
  {
    id: 'dispatch',
    title: 'Navy Dispatch Boat',
    rarity: 'uncommon',
    text: 'A fast little schooner flying the Navy’s pennant, racing to carry orders to the squadron.',
    choices: [
      {
        label: 'Chase her down',
        outcomes: [
          { weight: 1, effect: { text: 'You run her down. Her orders tell you exactly where the squadron means to search.', navy: -1, gold: 10 } },
          { weight: 1, effect: { text: 'She is faster than you. Now the squadron knows your position too.', navy: 0.5 } },
        ],
      },
      { label: 'Let her go', outcomes: [{ weight: 1, effect: { text: 'She vanishes over the horizon.' } }] },
    ],
  },
  {
    id: 'guarda',
    title: 'Guarda Costa',
    rarity: 'uncommon',
    needs: { minCol: 2 },
    text: 'A Spanish coastguard schooner fires a gun to leeward and signals you to heave to and be searched.',
    choices: [
      { label: 'Pay the customary bribe', cost: 20, outcomes: [{ weight: 1, effect: { text: 'The Spanish lieutenant pockets the gold and wishes you a pleasant voyage.' } }] },
      { label: 'Run out the guns', outcomes: [{ weight: 1, effect: { text: 'Spain will have to search you the hard way.', battle: 'guarda' } }] },
      { label: 'Show them your heels', outcomes: [
        { weight: 1, effect: { text: 'You outrun her by dusk.', navy: 0.5 } },
        { weight: 1, effect: { text: 'She is faster than she looks.', battle: 'guarda' } },
      ] },
    ],
  },
  {
    id: 'pressgang',
    title: 'The Press Tender',
    rarity: 'uncommon',
    needs: { minCol: 2 },
    text: 'A Navy press tender lies at anchor, her hold full of fishermen and merchant sailors seized to serve the King.',
    choices: [
      {
        label: 'Board her by night and free them',
        outcomes: [
          { weight: 2, effect: { text: 'Her sleepy guard surrenders without a shot. Two of the freed men ask to stay.', recruit: 2, navy: 0.5 } },
          { weight: 1, effect: { text: 'A sentry fires. Her crew are awake and armed.', battle: 'cutter' } },
        ],
      },
      { label: 'Give her a wide berth', outcomes: [{ weight: 1, effect: { text: 'Not your fight.' } }] },
    ],
  },
  {
    id: 'aground',
    title: 'Navy Sloop Aground',
    rarity: 'uncommon',
    needs: { minCol: 2 },
    text: 'A Navy sloop has run hard onto a reef. Her crew are throwing guns overboard to lighten her.',
    choices: [
      { label: 'Plunder her stores while she is helpless', outcomes: [{ weight: 1, effect: { text: 'Powder, shot, and the purser’s strongbox. The Navy will be furious.', gold: 30, navy: 0.5 } }] },
      { label: 'Help haul her off', outcomes: [{ weight: 1, effect: { text: 'Her captain is speechless. He swears his report will mention a ship that looked nothing like yours.', navy: -1, flag: 'gallant' } }] },
      { label: 'Laugh and sail on', outcomes: [{ weight: 1, effect: { text: 'One less ship hunting you, for a while.', crewHp: 5 } }] },
    ],
  },
  {
    id: 'rivals',
    title: 'Brethren of the Coast',
    text: 'Another pirate sloop heaves to under the black flag and invites your officers across for rum.',
    choices: [
      { label: 'Trade rum for their charts', cost: 10, outcomes: [{ weight: 1, effect: { text: 'Their charts mark every Navy patrol for fifty leagues.', navy: -1 } }] },
      { label: 'Buy out a malcontent', cost: 20, outcomes: [{ weight: 1, effect: { text: 'One of their gunners fancies a change of captain.', recruit: 1 } }] },
      { label: 'Exchange courtesies and part', outcomes: [{ weight: 1, effect: { text: 'Fair winds, brothers.' } }] },
    ],
  },
  {
    id: 'galleon',
    title: 'Treasure Fleet Straggler',
    rarity: 'uncommon',
    needs: { minCol: 2 },
    text: 'A Spanish galleon, separated from the treasure fleet by the last storm, labours alone on the horizon.',
    choices: [
      { label: 'Give chase', outcomes: [{ weight: 1, effect: { text: 'You crowd on sail and close. She runs out her guns.', battle: 'galleon' } }] },
      { label: 'Let her go', outcomes: [{ weight: 1, effect: { text: 'Too big a bite to chew. Probably.' } }] },
    ],
  },
  {
    id: 'trader',
    title: 'Dutch Trader',
    text: 'A fat Dutch fluyt flying a trade flag. Her master will sell anything to anyone, no questions asked.',
    choices: [
      { label: 'Buy medicines', cost: 15, outcomes: [{ weight: 1, effect: { text: 'Laudanum, bark and clean linen.', crewHp: 40 } }] },
      { label: 'Buy timber and cordage', cost: 15, outcomes: [{ weight: 1, effect: { text: 'Enough to patch her properly.', hull: 5 } }] },
      { label: 'Buy his old 6-pounder', cost: 18, needs: { gunPort: true }, outcomes: [{ weight: 1, effect: { text: 'A bit pitted, but she shoots.', gun: 'pdr6' } }] },
      { label: 'Trade news over gin', outcomes: [{ weight: 1, effect: { text: 'He has seen the Navy squadron, and tells you which way it was heading.', navy: -0.5 } }] },
    ],
  },
  {
    id: 'missionary',
    title: 'The Mission Ship',
    rarity: 'uncommon',
    text: 'A small brig carrying missionaries and their stores to the islands. They have seen your flag and are singing hymns very loudly.',
    choices: [
      { label: 'Escort them past the reef', outcomes: [{ weight: 1, effect: { text: 'They bless the ship and every soul aboard. Strangely, the crew feel better.', crewHp: 15, navy: 0.5 } }] },
      { label: 'Relieve them of their silver plate', outcomes: [{ weight: 1, effect: { text: 'Even pirates have scruples, it turns out. The crew do not enjoy it.', gold: 25, crewHp: -15 } }] },
      { label: 'Leave them be', outcomes: [{ weight: 1, effect: { text: 'The hymns fade astern.' } }] },
    ],
  },
  {
    id: 'news',
    title: 'Word from Tortuga',
    rarity: 'uncommon',
    text: 'A sloop from Tortuga crosses your bows with a bundle of letters and a cask of gossip.',
    choices: [
      {
        label: 'Read the letters',
        outcomes: [
          { weight: 1, effect: { text: 'Your old quartermaster has sold your share of the last cargo, and sends the money.', gold: 25 } },
          { weight: 1, effect: { text: 'A warning: the squadron has been reinforced, and its commodore swears to hang you.', navy: 0.5 } },
          { weight: 1, effect: { text: 'Letters from home for {crew}, who reads them in private and is quiet all day.' } },
        ],
      },
    ],
  },
  {
    id: 'wreckers',
    title: 'Wreckers’ Lights',
    rarity: 'uncommon',
    text: 'Lanterns on the shore after dark, set to look like a harbour mouth. But your chart shows only reef there.',
    choices: [
      { label: 'Steer for the lights', outcomes: [{ weight: 1, effect: { text: 'Rocks! You claw off with a gash in the hull, and the wreckers curse from the beach.', hull: -5 } }] },
      { label: 'Hold off until dawn', outcomes: [{ weight: 1, effect: { text: 'Daylight shows the reef plainly. You go round.', navy: 0.5 } }] },
      {
        label: 'Land a party and catch the wreckers',
        needs: { crew: 4 },
        outcomes: [
          { weight: 2, effect: { text: 'Their cave is stuffed with plunder from a dozen ships.', gold: 35, actorHp: -20 } },
          { weight: 1, effect: { text: 'They know the ground better than you do. {crew} comes back with a cutlass wound.', actorHp: -40 } },
        ],
      },
    ],
  },
];
