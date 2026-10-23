/**
 * Pacing and reward audit, run with `npx tsx scripts/audit.ts [voyages per ship] [style]`:
 * whole AI voyages with every purchase, port, fight and quiet day logged, then a "free item" experiment that hands
 * each fitting (and each gun) to a ship at the start, to see which ones change the odds and which do nothing.
 * Pass `items` as the second argument to run only the experiment, or `pace` for only the logs.
 */
import { FITTING_IDS } from '../src/data/fittings';
import { PLAYER_SHIPS } from '../src/data/ships';
import { WEAPONS } from '../src/data/weapons';
import { autoRun, type AutoRunOptions } from '../src/sim/autoRun';
import { MAX_GUNS, Run } from '../src/sim/Run';

const N = Number(process.argv[2] ?? 40);
const MODE = process.argv[3] ?? 'all';
const STYLES: [string, AutoRunOptions][] = [
  ['spread', {}],
  ['focus guns', { focus: 'guns' }],
  ['boarder', { focus: 'guns', boardWith: 2 }],
  ['diplomat', { focus: 'guns', diplomacy: true }],
];
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f1 = (x: number) => x.toFixed(1);
const pct = (n: number, of: number) => `${Math.round((100 * n) / Math.max(1, of))}%`;

interface Log {
  won: boolean;
  jumps: number;
  sector: number;
  battles: number;
  battleTime: number[];
  ports: number;
  events: number;
  quiet: number;
  longestQuiet: number;
  /** Gold when entering each sector (index = sector) and at each port. */
  goldAtSector: number[];
  goldAtPort: number[];
  /** Jump of the first purchase that wasn't food or a repair. */
  firstBuy: number;
  bought: Record<string, number>;
  offered: Record<string, number>;
  plunder: number;
  renown: number;
  goldLeft: number;
}

function logVoyage(shipId: string, seed: number, opts: AutoRunOptions, setup?: (run: Run) => void): Log {
  const run = new Run(shipId, seed);
  setup?.(run);
  const log: Log = { won: false, jumps: 0, sector: 0, battles: 0, battleTime: [], ports: 0, events: 0, quiet: 0, longestQuiet: 0, goldAtSector: [run.gold], goldAtPort: [], firstBuy: -1, bought: {}, offered: {}, plunder: 0, renown: 0, goldLeft: 0 };
  const bump = (rec: Record<string, number>, k: string) => (rec[k] = (rec[k] ?? 0) + 1);
  let quietRun = 0;
  const jump = run.jump.bind(run);
  run.jump = (id: number) => {
    const before = run.sector;
    const enc = jump(id);
    if (run.sector !== before) log.goldAtSector[run.sector] = run.gold;
    if (enc.kind === 'empty' && run.sector === before) {
      log.quiet++;
      quietRun++;
      log.longestQuiet = Math.max(log.longestQuiet, quietRun);
    } else quietRun = 0;
    if (enc.kind === 'event') log.events++;
    if (enc.kind === 'port') {
      log.ports++;
      log.goldAtPort.push(run.gold);
      for (const g of enc.stock) bump(log.offered, `gun:${g}`);
      for (const f of enc.fittings ?? []) bump(log.offered, `fit:${f}`);
    }
    return enc;
  };
  const buyGun = run.buyGun.bind(run);
  run.buyGun = (id: string) => {
    const ok = buyGun(id);
    if (ok) {
      bump(log.bought, `gun:${id}`);
      if (log.firstBuy < 0) log.firstBuy = run.jumps;
    }
    return ok;
  };
  const buyFitting = run.buyFitting.bind(run);
  run.buyFitting = (id: string) => {
    const ok = buyFitting(id);
    if (ok) {
      bump(log.bought, `fit:${id}`);
      if (log.firstBuy < 0) log.firstBuy = run.jumps;
    }
    return ok;
  };
  const buyUpgrade = run.buyUpgrade.bind(run);
  run.buyUpgrade = (id) => {
    const ok = buyUpgrade(id);
    if (ok) {
      bump(log.bought, `up:${id}`);
      if (log.firstBuy < 0) log.firstBuy = run.jumps;
    }
    return ok;
  };
  const startBattle = run.startBattle.bind(run);
  run.startBattle = (o) => {
    const b = startBattle(o);
    const runToEnd = b.runToEnd.bind(b);
    b.runToEnd = (limit?: number) => {
      const r = runToEnd(limit);
      log.battleTime.push(b.time);
      return r;
    };
    return b;
  };
  const { battles } = autoRun(run, opts);
  log.won = run.status === 'won';
  log.jumps = run.jumps;
  log.sector = run.sector;
  log.battles = battles.length;
  log.plunder = run.plunderTaken;
  log.renown = run.renown;
  log.goldLeft = run.gold;
  return log;
}

if (MODE !== 'items') {
  const all: Log[] = [];
  console.log(`== Pacing: ${N} voyages per ship per style ==`);
  for (const [label, opts] of STYLES) {
    for (const def of PLAYER_SHIPS) {
      const logs = Array.from({ length: N }, (_, i) => logVoyage(def.id, i + 1, opts));
      all.push(...logs);
      const won = logs.filter((l) => l.won).length;
      console.log(
        `${label.padEnd(10)} ${def.name.padEnd(16)} win ${pct(won, N).padStart(4)}  jumps ${f1(avg(logs.map((l) => l.jumps)))}  fights ${f1(avg(logs.map((l) => l.battles)))}  ports ${f1(avg(logs.map((l) => l.ports)))}  events ${f1(avg(logs.map((l) => l.events)))}  quiet ${f1(avg(logs.map((l) => l.quiet)))} (longest ${f1(avg(logs.map((l) => l.longestQuiet)))})  fight ${avg(logs.flatMap((l) => l.battleTime)).toFixed(0)}s  renown ${avg(logs.map((l) => l.renown)).toFixed(0)}`,
      );
    }
  }
  const sectors = Math.max(...all.map((l) => l.goldAtSector.length));
  console.log('\nGold on entering each sector (avg over voyages that got there):');
  for (let s = 0; s < sectors; s++) {
    const xs = all.map((l) => l.goldAtSector[s]).filter((x) => x !== undefined);
    console.log(`  sector ${s + 1}: ${avg(xs).toFixed(0)} gold (${pct(xs.length, all.length)} of voyages)`);
  }
  const portGold = all.flatMap((l) => l.goldAtPort);
  console.log(`Gold on entering a port: avg ${avg(portGold).toFixed(0)}, median ${portGold.sort((a, b) => a - b)[Math.floor(portGold.length / 2)]}`);
  const buys = all.filter((l) => l.firstBuy >= 0).map((l) => l.firstBuy);
  console.log(`First purchase (not food/repair) at jump: avg ${f1(avg(buys))}; ${pct(all.length - buys.length, all.length)} of voyages never buy anything`);
  console.log(`Voyage length in jumps: won ${f1(avg(all.filter((l) => l.won).map((l) => l.jumps)))}, lost ${f1(avg(all.filter((l) => !l.won).map((l) => l.jumps)))}`);
  console.log(`Plunder ${avg(all.map((l) => l.plunder)).toFixed(0)}, gold left at the end ${avg(all.map((l) => l.goldLeft)).toFixed(0)}`);
  const sum = (k: 'bought' | 'offered') => all.reduce<Record<string, number>>((acc, l) => {
    for (const [id, n] of Object.entries(l[k])) acc[id] = (acc[id] ?? 0) + n;
    return acc;
  }, {});
  const bought = sum('bought');
  const offered = sum('offered');
  console.log('\nPurchases per 100 voyages (and share of offers taken):');
  for (const id of [...new Set([...Object.keys(bought), ...Object.keys(offered)])].sort()) {
    console.log(`  ${id.padEnd(16)} ${((100 * (bought[id] ?? 0)) / all.length).toFixed(0).padStart(4)}   ${offered[id] ? pct(bought[id] ?? 0, offered[id]) : '-'}`);
  }
}

if (MODE !== 'pace') {
  // The free-item experiment: the same seeds with and without each item from the first day.
  const M = Math.max(20, N);
  const base = (setup?: (run: Run) => void) => {
    let won = 0;
    let n = 0;
    for (const def of PLAYER_SHIPS)
      for (const [, opts] of STYLES)
        for (let seed = 1; seed <= M; seed++) {
          n++;
          if (logVoyage(def.id, 1000 + seed, opts, setup).won) won++;
        }
    return (100 * won) / n;
  };
  const b = base();
  console.log(`\n== Free item at the start (${M} voyages x ${PLAYER_SHIPS.length} ships x ${STYLES.length} styles) ==`);
  console.log(`baseline win ${b.toFixed(1)}%`);
  for (const id of FITTING_IDS) {
    const w = base((run) => run.fittings.push(id));
    console.log(`  fitting ${id.padEnd(12)} ${w.toFixed(1)}%  (${w >= b ? '+' : ''}${(w - b).toFixed(1)})`);
  }
  for (const id of Object.keys(WEAPONS)) {
    const w = base((run) => {
      if (run.fit.guns.length < MAX_GUNS) run.fit.guns.push({ weapon: id });
    });
    console.log(`  gun ${id.padEnd(16)} ${w.toFixed(1)}%  (${w >= b ? '+' : ''}${(w - b).toFixed(1)})`);
  }
}
