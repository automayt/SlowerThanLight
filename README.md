# Slower Than Light

FTL-style ship combat in the age of sail. Pick a pirate ship and run for the open ocean: raid merchants, fight privateers, put into port for repairs, and stay ahead of the Royal Navy fleet until you break its blockade. Battles are real time with pause.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Run the simulation tests: unit tests, data checks, save/load and determinism, and one fuzzed voyage per ship and difficulty with invariants checked every step |
| `npm run test:fuzz` | The fuzzed voyages again with 12 seeds each (or `FUZZ_SEEDS=n npx vitest run tests/sim/fuzz.test.ts`) |
| `npm run coverage` | Run the tests with V8 coverage of `src/sim`, `src/data` and the save code |
| `npm run build` | Type-check and build to `dist/` |
| `npm run balance [runs] [battles\|voyages]` | Simulate AI-vs-AI battles against every enemy and whole voyages, and print win rates |
| `npm run server` | Start the co-op server on port 8140 (see below) |
| `npm run coop` | Build the game, then start the co-op server, which also serves it |

If the game seems frozen in an embedded browser that throttles `requestAnimationFrame`, open it with `?timer` (e.g. http://localhost:5173/?timer).

## Sail together (co-op)

Two or three friends crew one ship. One machine runs the server; everyone opens the game and chooses **Sail Together** on the title screen.

- **Playing on your network:** run `npm run coop` on the host and have everyone open `http://<host's address>:8140` (the server prints the address). While developing, `npm run dev` plus `npm run server` also works: friends open the dev server (port 5173) and it passes the connection on to the co-op server.
- **Posts:** the **Captain** sets the course, answers hails and events, spends the gold, and calls the speed and the escape. The **Master Gunner** aims the guns, picks the shot and calls broadsides. The **Bosun** sets the deckhands and gun crews, moves the crew and leads boarders. Anyone may pause. Any post nobody holds is worked by the AI first mate, including the posts of a player who drops out.
- **Deciding together:** the captain's choices play out on everyone's screen. Anyone else's clicks on the chart, events, hails and in port reach the captain as suggestions.
- **Saves:** the server keeps each crew's voyage in `saves/coop/`, so a voyage survives a restart, and a player who reconnects goes straight back aboard. Co-op never touches your single-player voyage.

## How to play

### The voyage

- **Three sectors:** the voyage crosses the Windward Isles, the Spanish Main and the King's Waters, each its own chart ending at a passage (») into the next; only the last ends at the blockade. Deeper sectors field better-found ships (10% more hull per sector, a gun a step heavier per sector, and in the King's Waters an extra bar of sail), pay richer plunder, and charge more in port. Passing into a new sector shakes off the fleet, but only so far: a straight run starts each sector with the same lead, while three quarters of any extra ground the fleet made up on you (detours, rests, alarms) follows you through the passage.
- **The chart:** sail left to right, one node per jump. Nodes are battles (*Sail sighted*), events (*Unknown*), ports and open sea. You can also explore *across* a column to an unvisited neighbour along the dotted channels; it costs a jump (and a day's provisions) while the fleet closes in.
- **Provisions:** every jump eats one, and the hold carries 20 (30 with extra water casks). On empty stores the crew go hungry (−25 HP each jump, and no healing that jump) and someone may jump ship. Buy provisions in port (3 gold each, the same in every sector), take them from prizes (merchants carry the most), find them in events (turtle beaches, fishing banks, a careening cove's spring, a Navy victualler) or get lucky fishing on open sea. Events can cost you stores too: weevils, foul water, starving castaways.
- **Who you meet:** merchant brigs and smuggler sloops in the Windward Isles; guarda costas, French corsair luggers and treasure galleons on the Spanish Main (Spanish ships and Spanish events turn up from there on); Navy sloops-of-war and rival pirate brigantines in the King's Waters, with privateers and Navy cutters throughout. Privateers, guarda costas, corsairs, rival brethren, a galleon's soldiers and the frigate's marines will board you; Navy cutters and sloops stand off and fight with their guns.
- **The Navy fleet** (the red tide) gains a little on you every jump, and more when you dawdle: exploring across a column, resting in port, raiding villages, letting a ship escape to raise the alarm. Nodes it overruns become Navy ambushes (cutters, and sloops-of-war in the King's Waters); a red ring warns you before you sail there. Sinking an ambusher pushes the fleet back.
- **Your ship carries its wounds:** hull, crew wounds and losses, and system damage carry between nodes. Each jump the crew heal 15 HP (unless they went hungry) and the carpenter mends one point of system damage.
- **Plunder:** win a fight for gold. A surrender gives you her whole hold and a captured ship a little more; a ship that breaks apart or founders takes most of it down with her. The merchant brig runs from the first shot, so cripple her sails or helm. A Spanish treasure galleon is the richest prize, if you can silence her 12-pounders. Gold found in events also grows a little richer each sector. The blockade pays in freedom, not gold.
- **Ports** have a harbour (hull repairs, new crew, or rest and refit at the cost of time), a chandler (provisions, and two fittings), a shipwright (oak planking for more hull, extra deckhands, more bars on any system) and an armoury that stocks two guns, light ones early in the voyage and heavier ones deeper in. Shipwright, chandler and armoury prices rise 20% each sector; repairs, crew and provisions do not. You have four gun ports; sell a gun back for half its list price.
- **Fittings** last the voyage: *Gun Drill* (guns load 10% faster), *Careened Hull* (+5% evasion, a quicker getaway, and +1 grapple speed for laying alongside faster ships), *Spare Spars* (running repairs mend two systems a jump), *Surgeon's Chest* (crew heal 30 HP a jump instead of 15), *Boarding Nets* (enemy boarders land with −30 HP) and *Water Casks* (the hold carries 30 provisions).
- **Events:** nearly a hundred of them. "Unknown" nodes bring encounters (castaways, convoys, smugglers, the Spanish coastguard); crossing open sea often brings an incident aboard (fever, scurvy, falls from the rigging, brawls, duels, storms, waterspouts). Events name your actual crew, and can wound or kill them. Some are rare or legendary and happen at most once a voyage: Blackbeard's invitation to supper, a ship out of time, something huge below the keel, a three-part treasure map, and the King's Pardon, which offers a different way to end the voyage. Earlier choices echo later: shoot the albatross and the ship is cursed; spare a Navy captain and he may repay you.
- **Logbook:** every event you discover is kept in a lifetime logbook on the title screen, by rarity.
- **Spoils:** a captured ship offers one of her guns (into a free gun port, or sold for scrap); a ship that struck her colours also offers a survivor for your crew. One pick.
- **Crew experience:** your people get better at what they do. Gunners learn by firing, helmsmen by steering under fire, carpenters by repairs, brawlers by boarding fights. Veteran and Expert ranks (stars in the crew list) mean faster reloads, more evasion, quicker repairs and harder blows, and they carry through the voyage.
- **Difficulty:** Easy, Normal or Hard on the ship select screen changes how fast the Navy closes in, starting gold, and how tough and quick-firing enemies are.
- **Unlockable ship:** capture two prizes by boarding (across any voyages) to unlock the Sea Wolf, a corsair xebec with a crew of cutthroats built for boarding.
- **Saving:** the voyage is saved in your browser as you play. *Continue Voyage* on the title screen picks it up again; a battle in progress restarts from its first broadside.
- **The blockade:** HMS Relentless, a Navy frigate, better found than any frigate fresh from the yard. There is no running from her, and once she is down to 40% hull her Commodore rallies the crew (repairs, fires out, faster guns). Sink her to win.

### Battles

- **Space** pauses. You can give orders while paused. Every fight opens paused once the ships are alongside, so you can aim and set your crew first.
- **Crew:** click a crew member (or their name on the left), then click a room to send them there. Crew automatically fight fires, patch leaks, repair damage and man stations in the room they are in.
- **Hands:** your deckhands are the ship's power. Use the **+ / −** buttons to put hands on Bulwarks, Sails, Pumps and the Surgeon. Guns take hands when you power them.
- **Guns:** man a gun with its ⏻ button, choose a shot type, then click the gun card and click an enemy room to aim. Number keys 1–4 select guns. Guns need crew standing in the gun deck: with nobody there they load at 40% speed.
- **Boarding:** select crew and click a room on the enemy ship to send them across (4 seconds on the ropes). You can only grapple a ship that is no faster than you (working sails plus hull speed) or whose helm is unmanned, so chain shot her rigging first. Boarders fight any defenders in the room (defenders have the edge on their own deck; merchant hands fight poorly, marines well) and wreck the system in an undefended room. Kill her whole crew to take her as a prize for her full hold and more. While anyone is aboard the other ship, neither ship can escape. Click one of your own rooms to call boarders home. Privateers, corsairs, rival pirates, the Spanish and the frigate's marines will board you too (see *Who you meet*).
- **Sound:** press M in battle (or use the title screen toggle) to mute.
- **Shot types:** Round (hull + systems), Chain (wrecks systems and sails, ignores stout sides; heavy chain splinters a little hull), Grape (shreds crew: kill her gun crews and her guns crawl), Hot (full hull damage and likely fire, light on systems).
- **Bulwarks:** every ship has a Bulwarks station in her forecastle. Each hand you put on it raises one layer, and each layer stops one incoming ball, then recharges in a few seconds (25% faster while one of your crew stands in the forecastle to man the station). Chain shot flies over bulwarks, so chain into her forecastle strips them.
- **Broadside (B):** hold every aimed gun until all are loaded, then fire together, to swamp her bulwarks.
- **Bringing guns to bear:** a ship whose helm is wrecked or unmanned reloads at half speed, so her helm is as good a target as her gun deck. Round and hot shot striking a gun deck only disable guns half the time; chain wrecks them reliably.
- **Stout sides:** Spanish treasure galleons are built of thick oak: light (1-damage) round and hot shot glances off 40% of the time. Use heavier guns, chain, grape or boarders.
- **Alerts:** the red bar above the gun cards names the most urgent problem aboard and what to do about it.
- **Escape:** once *Make Sail* is fully charged you can flee the fight.

## Code layout

- `src/sim/` — pure TypeScript simulation (no Phaser), unit tested in `tests/sim/`
- `src/data/` — ships, weapons, enemies and voyage events as data
- `src/render/` — Phaser drawing for ships and the HUD
- `src/sim/Run.ts` — the voyage: chart, fleet, gold, events, ports (`SeaChart.ts` builds the chart, `autoRun.ts` plays voyages headless)
- `src/scenes/` — Preload, Title, Ship Select, Sea Map, Event, Port, Battle, Result, Run End
- `public/art/` — painted illustrations made with ComfyUI, listed in `manifest.json`; the game runs without them
- `scripts/balance.ts` — headless balance report
- `server/` — the co-op server (Node + WebSocket): crews, posts, the shared voyage, battles run at 20 ticks a second; `src/net/` is the game's side of it, and `src/sim/commands.ts` and `snapshot.ts` are the orders and battle state they exchange
