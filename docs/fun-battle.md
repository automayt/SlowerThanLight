# Battle fun: what is dull, and what to do about it

Played headless (`scripts/tactics.ts`, `scripts/balance.ts`, event logs of single fights) and read through
`Battle`, `Combat`, `EnemyAI` and `Boarding`.

## What feels dull or samey

- **Set up, then watch.** Once guns are aimed and hands placed, a fight mostly runs itself. Guns fire the moment
  they load. The only live choices are fixing what breaks and the odd retarget.
- **Every enemy fights the same way.** Every enemy captain runs the same AI: spread fire, chain at the bulwarks,
  board at 12 s if the odds allow. A Navy cutter and a pirate corsair differ only in stats.
- **No spikes.** Damage is a steady trickle of 1 to 3 hull per ball. Nothing makes you sit up: no lucky shot, no
  disaster, no swing late in a losing fight.
- **Boarding is a numbers check.** Two blobs of hit points grind down. You have no way to tip a close melee.
- **The enemy's loaded guns are shown but you cannot act on them.** You can see her broadside about to land,
  and you can do nothing about it.

## Recommendations (ranked)

| # | Idea | Why it is fun | Cost |
|---|------|---------------|------|
| 1 | **Captain's orders on a cooldown**: *Rake her!* (the next volley hits harder and truer, cannot glance off, and lands more critical hits), *Crowd on sail!* (a burst of evasion and escape speed, but slower loading), *Cold steel!* (your crew fight half as hard again in melee). Both ships use them. | Turns watching into timing. Fire *Rake* into a held broadside. Dodge with *Crowd on sail* when her guns are loaded and laid on you, as the threat marks already show. Swing a close melee with *Cold steel*. Each order has one obvious use and one clever use. | Medium. 3 commands (one per co-op role), state in the snapshot, AI use, HUD buttons. |
| 2 | **Enemy captain tempers**: Steady, Born Boarder (closes and boards early and often), Long Gun (keeps the range, aims true at your helm), Faint-heart (runs and strikes early), Firebrand (hot shot into your gun deck and sails). Picked per encounter from a pool for each ship. | The same ship plays differently from one fight to the next, and the HUD and her captain's hail tell you which captain you face, so you can plan. | Low to medium. AI branches, a pool table, a HUD line. |
| 3 | **Critical hits**: magazine explosions, a falling mast (kills a runner's escape), a struck-down helmsman, bulwarks stove in, holes below the waterline, splinters. *Rake* doubles the chance. Screen shake, a burst, big floating text, a log line and a crew bark. | Spikes and stories ("we were losing, then her magazine went up"). Comebacks: a crit can stop a fleeing prize dead. The magazine becomes a target worth choosing. | Low. One roll in `applyHit` plus FX. |
| 4 | **Crew barks**: short shouts above the crew when orders are given, crits land, boarders come over the side, and fires start. Her captain hails you at the start, in the voice of his temper. | Personality at almost no cost. It sells the orders and tempers. | Low. Render only, no sim state. |
| 5 | **Morale and striking colours**: a nerve bar for her crew that drops with crew deaths, crits and hull loss. She strikes when it breaks, instead of on one hull-threshold roll. | It rewards grape and boarding as ways to win, and makes a lopsided fight end sooner. | Medium. It rewrites surrender, so balance must be re-tuned across all enemies and plunder shares. |
| 6 | **Weather mid-battle**: a squall (fires doused, high evasion), fog (both sides firing blind), or a calm (nobody can make sail). | Changes the plan halfway. | High. Needs new sea, rain and fog rendering, and touches escape balance everywhere. |

Built: 1 to 4. Not built: 5 and 6. They are listed in order of value.

## Notes on what was built

- Everything in the sim uses the battle's seeded `Rng`. The temper comes from a stream derived from the battle seed,
  so a co-op client builds the same captain the server has. Order state travels in the `BattleSnapshot`.
- The orders are the battle commands `{ t: 'order', order }`: *Rake* is the gunner's, *Crowd on sail* the
  captain's, and *Cold steel* the bosun's. Hotkeys: Z, X and C.
- The AI uses the orders for both ships, so headless balance numbers include them. An AI mate in co-op uses
  only the orders for its own duties (*Rake* with the guns duty, *Cold steel* with the crew duty), never the
  captain's.

## Balance check

| | Before | After |
|---|---|---|
| Whole voyages, mean of 20 ship/captain rows (60 each) | 50.9% (range 28–73%) | 50.5% (range 23–75%) |
| Single battles, mean win (`balance.ts 60 battles`) | 77.4%, 102 s long | 78.0%, 83 s long |
| Tests | 642 | 659 (+17 in `tests/sim/fun.test.ts`) |

The first temper pass made voyages much harder, with a mean win rate of 36%. Two things caused it: a long gun
laying a gun on your helm, and a boarder sending parties at long odds. Both were toned down, so each temper now
changes how a fight plays more than how hard it is. The privateer, at sector 1 in `tactics.ts`, is still harder
than before.
