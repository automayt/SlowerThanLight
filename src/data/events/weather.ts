import type { SeaEventDef } from '../../sim/types';

/** Wind, weather and the sea itself. These turn up while crossing open sea. */
export const WEATHER_EVENTS: SeaEventDef[] = [
  {
    id: 'becalmed',
    title: 'Becalmed',
    pool: 'incident',
    text: 'The wind dies to nothing. The sails hang slack and the pitch bubbles in the deck seams.',
    variants: [
      'Not a breath of wind for a day and a night. The sea is a sheet of glass and the ship turns slowly on her own reflection.',
      'The trade wind fails without warning. Sails slat against the masts and the tar runs soft in the heat.',
    ],
    choices: [
      { label: 'Wait for the wind', outcomes: [{ weight: 1, effect: { text: 'The crew rest in what shade they can find while the Navy closes the distance.', crewHp: 20, navy: 1 } }] },
      { label: 'Man the sweeps and row', outcomes: [{ weight: 1, effect: { text: 'Hours at the oars under a brutal sun. Backs ache, but you keep your lead.', crewHp: -20 } }] },
      {
        label: 'Your navigator knows a current that runs even in a calm',
        needs: { trait: 'navigator' },
        outcomes: [{ weight: 1, effect: { text: 'She drifts, then glides, then runs on the current while the sails hang slack.', navy: -0.5 } }],
      },
    ],
  },
  {
    id: 'storm',
    title: 'Squall Line',
    pool: 'incident',
    text: 'A wall of black cloud races across the water toward you.',
    variants: [
      'The sky to windward turns the colour of a bruise. {crew} at the masthead calls down that a squall is coming, and fast.',
      'Lightning flickers on the horizon and the swell lengthens. A squall is racing down on you.',
    ],
    choices: [
      { label: 'Reef sails and ride it out', outcomes: [{ weight: 1, effect: { text: 'The squall batters the hull, but she holds together.', hull: -2 } }] },
      {
        label: 'Run before the wind',
        outcomes: [
          { weight: 1, effect: { text: 'The gale hurls you far ahead of any pursuit.', navy: -1 } },
          { weight: 1, effect: { text: 'A topmast cracks and green water sweeps the deck.', hull: -4, crewHp: -10 } },
        ],
      },
      {
        label: 'Give the helm to your veteran helmsman',
        needs: { skill: { seamanship: 1 } },
        outcomes: [{ weight: 1, effect: { text: 'They read every sea before it comes. She rides it out with hardly a sheet parted.' } }],
      },
    ],
  },
  {
    id: 'tradewind',
    title: 'Fair Trade Wind',
    pool: 'incident',
    text: 'A steady wind out of the east, warm and strong. The kind of wind sailors dream about.',
    variants: [
      'The trade wind comes back strong and true, and the ship heels to it like a horse let off the rein.',
    ],
    choices: [
      { label: 'Crowd on every stitch of sail', outcomes: [{ weight: 1, effect: { text: 'She fairly flies. The Navy falls behind.', navy: -0.5 } }] },
      { label: 'Ease off and rest the watch below', outcomes: [{ weight: 1, effect: { text: 'An easy day of sun and sleep.', crewHp: 20 } }] },
    ],
  },
  {
    id: 'fog',
    title: 'Fog Bank',
    pool: 'incident',
    text: 'A fog bank rolls over the ship, so thick that {crew} at the bow cannot be seen from the helm.',
    variants: [
      'A white wall of fog swallows the ship. You can hear the sea breaking somewhere, but not where.',
      'Dawn brings fog so thick that the bowsprit vanishes into it. {crew} is sent forward with the lead line.',
    ],
    choices: [
      { label: 'Creep through with the lead line', outcomes: [{ weight: 1, effect: { text: 'Slow and safe.', navy: 0.5 } }] },
      {
        label: 'Run blind under full sail',
        outcomes: [
          { weight: 2, effect: { text: 'You burst out of the fog leagues ahead, with no Navy lookout the wiser.', navy: -0.5 } },
          { weight: 1, effect: { text: 'A grinding shudder: coral. You scrape free, leaking.', hull: -4 } },
        ],
      },
      {
        label: 'Let your veteran helmsman feel the way by the swell',
        needs: { skill: { seamanship: 1 } },
        outcomes: [{ weight: 1, effect: { text: 'The fog is no friend, but the swell tells a story to someone who listens. You come out of it miles on.', navy: -0.5 } }],
      },
    ],
  },
  {
    id: 'waterspout',
    title: 'Waterspout',
    pool: 'incident',
    rarity: 'uncommon',
    text: 'A twisting grey column joins sea to sky, and it is walking straight toward you.',
    choices: [
      { label: 'Bear away hard', outcomes: [{ weight: 1, effect: { text: 'It passes a cable’s length astern, roaring. You have lost your heading, but nothing else.', navy: 0.5 } }] },
      {
        label: 'Hold your course and pray',
        outcomes: [
          { weight: 1, effect: { text: 'It veers away at the last moment. The crew cheer like madmen.', crewHp: 10 } },
          { weight: 1, effect: { text: 'It brushes the bow and tears sails from their bolt-ropes.', hull: -3, damage: { sails: 2 } } },
        ],
      },
    ],
  },
  {
    id: 'lightning',
    title: 'Lightning Strike',
    pool: 'incident',
    rarity: 'rare',
    text: 'A white flash and a crack that knocks men off their feet. Lightning has struck the mainmast, and {crew} was standing at its foot.',
    choices: [
      { label: 'Fight the fire aloft', outcomes: [
        { weight: 2, effect: { text: 'The mast is scorched and split, but stands. {crew} is badly burned.', damage: { sails: 2 }, actorHp: -40 } },
        { weight: 1, effect: { text: '{crew} was killed where they stood. The mast still stands, blackened.', damage: { sails: 1 }, loseActor: true } },
      ] },
    ],
  },
  {
    id: 'stelmo',
    title: 'St. Elmo’s Fire',
    pool: 'incident',
    rarity: 'rare',
    text: 'In the night watch, blue fire flickers along the yards and dances on the masthead. Nobody speaks.',
    choices: [
      { label: 'Declare it a blessing', outcomes: [{ weight: 1, effect: { text: 'St. Elmo watches over sailors. The crew believe it, and so, a little, do you.', crewHp: 20, clearFlag: 'cursed' } }] },
      { label: 'Explain that it is only weather', outcomes: [{ weight: 1, effect: { text: 'Nobody believes you.' } }] },
    ],
  },
  {
    id: 'eclipse',
    title: 'The Sun Goes Out',
    pool: 'incident',
    rarity: 'rare',
    unique: true,
    text: 'At noon the sky darkens. Stars come out. A black disc eats the sun while the birds fall silent and the crew drop to their knees.',
    choices: [
      { label: 'Tell them it is a sign of great fortune', outcomes: [
        { weight: 1, effect: { text: 'When the sun returns, they believe you entirely.', crewHp: 25 } },
        { weight: 1, effect: { text: 'They do not believe you. Two days of terrified muttering follow.', crewHp: -20 } },
      ] },
      { label: 'Pour a tot of rum for the sea', cost: 5, outcomes: [{ weight: 1, effect: { text: 'An old custom. The light returns and so does the crew’s nerve.', crewHp: 10 } }] },
    ],
  },
  {
    id: 'hurricane',
    title: 'Hurricane',
    pool: 'incident',
    rarity: 'rare',
    needs: { minCol: 3 },
    text: 'The swell has been building for a day under a coppery sky. Now the gulls are gone and the old hands are stowing everything twice. A hurricane is coming.',
    choices: [
      { label: 'Run for the lee of the nearest island', outcomes: [{ weight: 1, effect: { text: 'You claw into shelter, battered but whole, and lose two days waiting it out.', hull: -3, navy: 1 } }] },
      {
        label: 'Ride it out at sea',
        outcomes: [
          { weight: 1, effect: { text: 'A night of horror. In the morning she is a wreck above decks, and alone on an empty sea.', hull: -8, damage: { sails: 2 }, crewHp: -15 } },
          { weight: 1, effect: { text: 'You ride the edge of it, and the storm wipes out every trace of your wake.', hull: -4, navy: -1.5 } },
        ],
      },
    ],
  },
  {
    id: 'whales',
    title: 'Whales',
    pool: 'incident',
    text: 'A pod of whales surfaces alongside, blowing and rolling, close enough to touch.',
    variants: [
      'A great grey back breaks the surface beside the ship, then another, and another. Whales, dozens of them.',
    ],
    choices: [
      { label: 'Watch them pass', outcomes: [{ weight: 1, effect: { text: 'Even the hardest cutthroat aboard is grinning like a child.', crewHp: 10 } }] },
      {
        label: 'Try for one with a harpoon',
        outcomes: [
          { weight: 1, effect: { text: 'A day’s bloody work yields oil and a lump of ambergris worth its weight in silver.', gold: 30, navy: 0.5 } },
          { weight: 1, effect: { text: 'The whale smashes the boat with its tail. {crew} is hauled out with broken ribs.', actorHp: -40 } },
        ],
      },
      {
        label: 'Your expert gunner takes the harpoon',
        needs: { skill: { gunnery: 2 } },
        outcomes: [{ weight: 1, effect: { text: 'One throw, square behind the head. Oil and meat for weeks.', provisions: 8, gold: 15 } }],
      },
    ],
  },
  {
    id: 'mermaids',
    title: 'Mermaids!',
    pool: 'incident',
    rarity: 'rare',
    text: '{crew} swears blind they have seen mermaids sporting in the shallows off the starboard bow. Half the crew rushes to the rail.',
    choices: [
      { label: 'Have a look', outcomes: [{ weight: 1, effect: { text: 'Sea cows: fat, whiskery, and placid. The crew are disappointed, then delighted.', crewHp: 10 } }] },
      { label: 'Tell everyone back to work', outcomes: [{ weight: 1, effect: { text: '{crew} will tell this story in taverns for the rest of their life regardless.' } }] },
    ],
  },
  {
    id: 'glowsea',
    title: 'The Burning Sea',
    pool: 'incident',
    rarity: 'uncommon',
    text: 'At night the bow wave glows green-white, and every fish leaves a trail of fire. The ship sails through a sea of stars.',
    choices: [{ label: 'Let the watch below come up and see', outcomes: [{ weight: 1, effect: { text: 'Nobody sleeps. Nobody minds.', crewHp: 10 } }] }],
  },
  {
    id: 'flotsam',
    title: 'Flotsam',
    pool: 'incident',
    text: 'Barrels, crates and a broken spar drift past: the leavings of some other ship’s bad luck.',
    variants: [
      'The lookout spots a raft of wreckage: casks, a hatch cover, and a seaman’s chest bobbing in the swell.',
      'Debris from some unlucky ship litters the water for a mile: barrels, planks and a floating crate.',
    ],
    choices: [
      {
        label: 'Fish them out',
        outcomes: [
          { weight: 2, effect: { text: 'A crate of good Bristol pewter. Saleable.', gold: 12 } },
          { weight: 1, effect: { text: 'A cask of Barbados rum, still sealed. The crew are in heaven.', crewHp: 15 } },
          { weight: 1, effect: { text: 'Two casks of ship’s biscuit, tight and dry. Somebody’s loss is your supper.', provisions: 2 } },
          { weight: 1, effect: { text: 'Salt water and rot. Nothing worth keeping.' } },
        ],
      },
      { label: 'Sail on', outcomes: [{ weight: 1, effect: { text: 'Other people’s bad luck can stay theirs.' } }] },
    ],
  },
  {
    id: 'weed',
    title: 'The Weed Sea',
    pool: 'incident',
    rarity: 'uncommon',
    text: 'Golden weed spreads to the horizon, thick enough to slow the ship to a crawl and foul the rudder.',
    choices: [
      { label: 'Go around it', outcomes: [{ weight: 1, effect: { text: 'A long detour.', navy: 0.5 } }] },
      { label: 'Kedge her through with the boats', outcomes: [{ weight: 1, effect: { text: 'A day of rowing anchors ahead and hauling. Exhausting, but quick.', crewHp: -15 } }] },
      {
        label: 'Let your navigator find the channel through it',
        needs: { trait: 'navigator' },
        outcomes: [{ weight: 1, effect: { text: 'A ribbon of clear water winds through the weed, if you know to look for it. You lose no time at all.' } }],
      },
    ],
  },
  {
    id: 'badwater',
    title: 'Foul Water',
    pool: 'incident',
    text: 'The last water casks have gone green and stinking. {crew} retches after a single mouthful.',
    variants: [
      'The water in the scuttlebutt has turned. It is thick, green and alive, and {crew} will not touch it.',
    ],
    choices: [
      { label: 'Put in for fresh water', outcomes: [{ weight: 1, effect: { text: 'A spring above a beach, and every cask filled to the bung. It costs a day.', navy: 0.5, provisions: 2 } }] },
      { label: 'Pour it over the side', outcomes: [{ weight: 1, effect: { text: 'Two days’ water goes into the sea. Better thirsty than poisoned.', provisions: -2 } }] },
      { label: 'Ration the rum instead', outcomes: [{ weight: 1, effect: { text: 'The crew drink grog thin as tea and get thinner themselves.', crewHp: -15 } }] },
      {
        label: 'Let the cook boil it with ginger and a splash of rum',
        needs: { trait: 'cook' },
        outcomes: [{ weight: 1, effect: { text: 'Foul, but safe, and the crew say the rum improves it.' } }],
      },
    ],
  },
  {
    id: 'banks',
    title: 'The Fishing Banks',
    pool: 'incident',
    text: 'The lead finds bottom at twenty fathoms, and the water is boiling with fish. Every idle hand wants a line over the side.',
    variants: [
      'Birds wheel and dive over a patch of green shoal water. {crew} swears the snapper are thick enough to walk on.',
    ],
    choices: [
      {
        label: 'Heave to and fish all day',
        outcomes: [
          { weight: 3, effect: { text: 'Snapper, grouper and a great ugly jewfish. The cook salts down a hold full.', provisions: 4, navy: 0.5 } },
          { weight: 1, effect: { text: 'Sharks find the shoal before you do, and take half of every catch off the hook.', provisions: 2, navy: 0.5 } },
        ],
      },
      { label: 'Trail a few lines and keep sailing', outcomes: [{ weight: 1, effect: { text: 'Enough for a fry-up tonight.', provisions: 1 } }] },
    ],
  },
];
