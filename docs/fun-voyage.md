# Voyage-level fun: what feels flat, and what to do about it

Read from `src/sim/Run.ts`, `SeaChart.ts`, the event data and headless voyages (`scripts/balance.ts`).

What already works: ~100 events with blue "special" choices, story flags that place leads on the chart,
hails with odds, the fleet's tide, wind, provisions and three sectors with a fork.

What feels flat:

- **The chart hides almost everything.** A mark is "Sail sighted", "Unknown", "Port" or "Open sea". You choose by
  icon and the wind, not by what is actually there, so most legs are a coin toss with a fleet timer.
- **No villain.** Every ship is a stranger. Nothing you do in one fight is remembered in the next.
- **No gambling.** Every risk is folded inside an event outcome you never see the odds of. There's no moment where
  you push your luck one more time.
- **Ports are a shop.** Each port differs by one discount. There's nothing to *do* in port that tells a story.
- **Treasure is a rare accident.** The half-map chain only starts if a rare event turns up early.
- **Routes are all the same length.** Speed only comes from wind or from skipping detours. There's no daring route.

## Recommendations, ranked

1. **A recurring nemesis: Silas Crane and the Black Dog.** (Built.) He's your old quartermaster, marooned for
   robbing the common purse. Now he has a ship and a grudge. He's marked on every sector's chart and is an optional,
   tougher fight with a bounty on his head. He runs early rather than strikes. If he gets away, or you run, or you
   pay him off, he comes back in the next sector with more hull and a bigger bounty, and his taunts remember how
   you last met. Two events follow from his fate.
   *Why it's fun:* a face to hate, callbacks, and a "chain-shot his sails before he slips away" goal in battle.
   *Cost:* medium. It needs Run state, a chart mark, hail text and finishBattle hooks. It doesn't touch Battle code.

2. **A tavern in every port: dice and rumours.** (Built.)
   - *Bones:* roll to fifteen against a local captain. Roll two dice, then roll again or stand. Over fifteen and you
     bust. He must beat your total, and a tie is a push. Exactly fifteen pays double, and a broke captain may throw in
     half a treasure map. Best play is about even money, so it's tension without free gold. It allows three hands a
     visit.
   - *Rumours:* buy a round to learn what lies ahead. Sails within three columns show what they are, unknown
     waters show the tale waiting there, and sometimes an old salt marks a wreck on your chart (a treasure dive).
   *Why it's fun:* push-your-luck decisions, ports with something to do, and a chart worth reading.
   *Cost:* medium. It needs a modal UI and two new VoyageCommands.

3. **Reef and shoal shortcuts.** (Built.) A few dashed routes on each chart skip a whole column, which gains a jump
   on the fleet and saves a day's food. The passage is a gamble: a clean run, a scraped hull, or running aground
   (more hull, a damaged mast and lost time). A navigator or a seasoned helmsman improves the odds, and the chart
   shows them.
   *Why it's fun:* a real risk/reward choice on the chart itself.
   *Cost:* low. Chart generation, reachable/jump, and drawing.

4. **Treasure via the tavern and the nemesis.** (Built as hooks into 2 and 1.) A perfect fifteen against a broke
   captain wins half a map, and Crane's quartermaster sells his chart after Crane falls. Both feed the existing
   half-map, cartographer and island chain, so treasure hunting is something you can go after.
   *Cost:* low. Mostly data.

5. **Mutiny pressure.** Not built. When provisions or the purse sit at zero for several jumps, grumbling events
   start: a petition, a ringleader, a vote to replace the captain. You'd answer with a share-out, the lash, or rum.
   *Why it's fun:* turns starvation from a slow HP drain into drama.
   *Cost:* low to medium. It needs a "discontent" counter and a handful of events.

6. **Named crew arcs.** Not built. Each hand who survives three fights gets a backstory event (a debt, a sweetheart
   in port, a past in the Navy) with a callback later.
   *Cost:* medium. It's mostly writing. It needs per-crew flags.

## Notes

- Every new choice is a `VoyageCommand` (`rumour`, `dice`), replays deterministically, and all new state sits in
  optional `RunSave` fields or in the saved chart and port encounter.
- `autoRun` buys rumours, plays a careful hand of Bones, weighs reefs by hull, and fights Crane like any ship.

## Balance (`npx tsx scripts/balance.ts 160 voyages`, 40 voyages per ship and captain)

- Before: mean win 50.4% across ships and captains (range 23–75%).
- After: mean win 48.9% (range 20–75%).
- AutoRun meets Crane in about half of all voyages and usually beats him on the first meeting. He dies with
  about 6% of voyages.
- He runs at 55% hull, but escaping takes him a while, so a determined captain can catch him. He only gets
  heavier guns by escaping (scaled by `min(sector, grudge)`), and +10% hull for each escape.
