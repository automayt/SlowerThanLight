# Slower Than Light

FTL-style ship combat in the age of sail. Pick a pirate ship, manage your deckhands, crew and cannons, and take on the Navy — in real time with pause.

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
| `npm run balance` | Simulate hundreds of AI-vs-AI battles per ship and print win rates |

If the game seems frozen in an embedded browser that throttles `requestAnimationFrame`, open it with `?timer` (e.g. http://localhost:5173/?timer).

## How to play

- **Space** pauses. You can give orders while paused.
- **Crew:** click a crew member (or their name on the left), then click a room to send them there. Crew automatically fight fires, patch leaks, repair damage and man stations in the room they are in.
- **Hands:** your deckhands are the ship's power. Use the **+ / −** buttons to put hands on Sails, Pumps and the Surgeon. Guns take hands when you power them.
- **Guns:** man a gun with its ⏻ button, choose a shot type, then click the gun card and click an enemy room to aim. Number keys 1–4 select guns.
- **Shot types:** Round (hull + systems), Chain (wrecks systems and sails, no hull damage), Grape (shreds crew), Hot (sets fires).
- **Escape:** once *Make Sail* is fully charged you can flee the fight.

## Code layout

- `src/sim/` — pure TypeScript simulation (no Phaser), unit tested in `tests/sim/`
- `src/data/` — ships, weapons and enemies as data
- `src/render/` — Phaser drawing for ships and the HUD
- `src/scenes/` — Title, Ship Select, Battle, Result
- `scripts/balance.ts` — headless balance report
