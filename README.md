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
| `npm test` | Run the simulation unit tests |
| `npm run build` | Type-check and build to `dist/` |
| `npm run balance [runs] [battles\|voyages]` | Simulate AI-vs-AI battles against every enemy and whole voyages, and print win rates |

If the game seems frozen in an embedded browser that throttles `requestAnimationFrame`, open it with `?timer` (e.g. http://localhost:5173/?timer).

## How to play

### The voyage

- **The chart:** sail left to right, one node per jump, from Tortuga to the blockade. Nodes are battles (*Sail sighted*), events (*Unknown*), ports and open sea.
- **The Navy fleet** (the red tide) gains a little on you every jump, and more when you dawdle: resting in port, raiding villages, letting a ship escape to raise the alarm. Nodes it overruns become Navy ambushes; a red ring warns you before you sail there. Sinking an ambusher pushes the fleet back.
- **Your ship carries its wounds:** hull, crew wounds and losses, and system damage carry between nodes. Each jump the crew heal a little and mend one point of system damage.
- **Plunder:** win a fight for gold. A surrender or a captured ship gives you her whole hold; a ship that breaks apart or founders takes most of it down with her. The merchant brig runs from the first shot, so cripple her sails or helm. A Spanish treasure galleon is the richest prize, if you can silence her 12-pounders.
- **Ports** have a harbour (hull repairs, new crew, or rest and refit at the cost of time), a shipwright (oak planking for more hull, extra deckhands, more bars on any system) and an armoury that stocks two guns, heavier ones later in the voyage. You have four gun ports; sell a gun back for half its price.
- **Events:** over a hundred of them. "Unknown" nodes bring encounters (castaways, convoys, smugglers, the Spanish coastguard); crossing open sea often brings an incident aboard (fever, scurvy, falls from the rigging, brawls, duels, storms, waterspouts). Events name your actual crew, and can wound or kill them. Some are rare or legendary and happen at most once a voyage: Blackbeard's invitation to supper, a ship out of time, something huge below the keel, a three-part treasure map, and the King's Pardon, which offers a different way to end the voyage. Earlier choices echo later: shoot the albatross and the ship is cursed; spare a Navy captain and he may repay you.
- **Logbook:** every event you discover is kept in a lifetime logbook on the title screen, by rarity.
- **Saving:** the voyage is saved in your browser as you play. *Continue Voyage* on the title screen picks it up again; a battle in progress restarts from its first broadside.
- **The blockade:** HMS Relentless, a Navy frigate. There is no running from her. Sink her to win.

### Battles

- **Space** pauses. You can give orders while paused.
- **Crew:** click a crew member (or their name on the left), then click a room to send them there. Crew automatically fight fires, patch leaks, repair damage and man stations in the room they are in.
- **Hands:** your deckhands are the ship's power. Use the **+ / −** buttons to put hands on Sails, Pumps and the Surgeon. Guns take hands when you power them.
- **Guns:** man a gun with its ⏻ button, choose a shot type, then click the gun card and click an enemy room to aim. Number keys 1–4 select guns.
- **Shot types:** Round (hull + systems), Chain (wrecks systems and sails, no hull damage), Grape (shreds crew), Hot (sets fires).
- **Escape:** once *Make Sail* is fully charged you can flee the fight.

## Code layout

- `src/sim/` — pure TypeScript simulation (no Phaser), unit tested in `tests/sim/`
- `src/data/` — ships, weapons, enemies and voyage events as data
- `src/render/` — Phaser drawing for ships and the HUD
- `src/sim/Run.ts` — the voyage: chart, fleet, gold, events, ports (`SeaChart.ts` builds the chart, `autoRun.ts` plays voyages headless)
- `src/scenes/` — Preload, Title, Ship Select, Sea Map, Event, Port, Battle, Result, Run End
- `public/art/` — painted illustrations made with ComfyUI, listed in `manifest.json`; the game runs without them
- `scripts/balance.ts` — headless balance report
