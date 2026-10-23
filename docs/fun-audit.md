# Fun audit: pacing, rewards and items

The numbers come from headless AI voyages. `npx tsx scripts/audit.ts 30` gives 480 voyages: 4 ships × 4 captain styles × 30 seeds. The free-item experiment uses 320 voyages per item on the same seeds, each with one item given from the first day. `npm run balance 200 voyages` gives 50 voyages per ship and style.

## What the numbers say

| Finding | Number |
|---|---|
| Voyages are short and dense: hardly a quiet day | 11–15 jumps; 4–5 fights, 2–3 ports and 3–4 events per voyage; 0.6–1.1 quiet jumps per voyage, never two in a row |
| The early purse is thin: you start with 30 gold, and the cheapest fitting costs 30–80 | Gold on entering sector 2 is 69, and sector 3 is 89. The first real purchase comes at jump 5.4 of about 13. **20% of voyages never buy a gun or fitting at all.** |
| Gold is left unspent at the end, and it is worth nothing | 78 gold average left in the hold at the end (win or lose). Renown ignores it. |
| **Swivel guns dominate.** They need no hands, and grape kills crew. | A free swivel takes the win rate from 38% to **64% (+26)**. The Sea Wolf, which starts with one, is the best ship (76% for the boarder style). |
| **The sea mortar is a trap.** It needs 2 hands, loads in 20 s, and hits 55% of the time. | A free mortar takes the win rate from 38% to **24% (−14)**. The 18-pdr is −6 and the carronade −3: heavier guns starve the deck of hands. |
| Gun Drill is the only fitting that matters, with the careened hull a little behind | Drill +15.6; careened +9.4; copper +6.9; marines +5.6 |
| Several fittings do nothing | Spars +0.3, lockers +0.6, casks −0.3, flags +0.3. Figurehead offers were taken 0% of the time, and marines 1%. |
| Nothing defines a build | No fitting combines with a gun or shot. Every fitting is a flat +5% or +10%. |
| Runs blur together | The end screen has 8 ledger rows and no story: no named prizes, no best fight, no closest call. |
| Meta-progression is thin | Renown only unlocks 4 captains (30–150 renown at about 70–110 per voyage). After that there is nothing to chase. |

## Recommendations, ranked

1. **Fix the dominant and dead items.** *Fun:* every armoury and chandler choice should be a real choice, with no autopick and no trap. *Cost:* data only, cheap. *Changes:*
   - Swivels: slower and dearer (load 6 s → 8 s, 30 → 40 gold).
   - Mortar: buffed to 1 hand and a 16 s load.
   - Carronade: loads a little faster (12 s → 10 s).
   - Spars: also mend 1 hull per jump.
   - Lockers: give 30% instead of 20%, and are cheaper.
   - Gun Drill: price 70 → 85.
2. **Rare fittings with a drawback, and build-defining synergies.** *Fun:* the FTL thrill of a rare find in a shop, and a build to plan around: a hot-shot fire ship, an oak-sided brawler, or a no-quarter boarding crew. *Cost:* new data, plus hooks in `Run.ship` and `Run.battleSetup` that use battle options which already exist (armour, evasion, shot rates, reload, AI surrender). No battle code changes.
3. **Challenge flags at ship select for bonus renown.** *Fun:* replay goals once the captains are unlocked, and a choice of risk against reward. *Cost:* a new data file, a constructor option on Run (saved, and replayed by co-op through RunSave), and a toggle panel on ship select. The default voyage is unchanged.
4. **A ship's log and highlights at voyage end.** *Fun:* runs become stories. "Took the *Santa Rosa* with 6 hull left" is what players retell. *Cost:* a small `log` on Run (saved), and a two-column end screen.
5. **Make leftover gold count, and ease the first port.** *Fun:* 78 unspent gold is a wasted feeling, and a fifth of voyages buy nothing. Turn the gold in the hold into renown on a win, and consider a cheap first-sector fitting. *Cost:* tiny, but it moves renown pacing, so it should be weighed after items 1–4.
6. **A fifth ship as a late renown unlock.** *Fun:* a long-term goal. *Cost:* high, because it needs portrait art, a layout and balance passes. Deferred.

Items 1–4 are implemented on branch `fun-audit`. Before-and-after numbers are at the end of this file.
