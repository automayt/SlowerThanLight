import { enemy } from '../data/enemies';
import { fitting } from '../data/fittings';
import { weapon } from '../data/weapons';
import { seaEvent } from '../data/voyage';
import { Run } from '../sim/Run';
import { coop } from '../net/CoopClient';
import { Ship } from '../sim/Ship';
import { CAPTAINS, type CaptainDef } from '../data/captains';

const KEY = 'slower-than-light.voyage.v1';

let writable = true;

/** Dev sandboxes (the ?battle= shortcut) call this so they never touch the player's real voyage or records. */
export function disableSaving(): void {
  writable = false;
}

/** Remember the voyage in this browser so it can be continued later. Finished voyages are forgotten. */
export function saveRun(run: Run): void {
  // A co-op voyage lives on the server; this browser's own voyage is left as it was.
  if (!writable || coop()) return;
  try {
    if (run.over) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(run.toSave()));
  } catch {
    // Storage can be unavailable (private windows, blocked site data); the game works without it.
  }
}

export function loadRun(): Run | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const run = Run.fromSave(JSON.parse(raw));
    if (run.over) return null;
    checkRun(run);
    return run;
  } catch {
    // Corrupt, or written by a version whose ships, events or enemies no longer exist: start afresh.
    clearSave();
    return null;
  }
}

const RESUMABLE = ['chart', 'hail', 'battle', 'event', 'port'];

/**
 * Throws if a loaded voyage is damaged or refers to anything the current game data no longer has, including
 * enemies and wares further along the chart that would otherwise only crash the game when reached.
 */
function checkRun(run: Run): void {
  if (!RESUMABLE.includes(run.status)) throw new Error(`Cannot resume a voyage in status ${run.status}`);
  const numbers = [run.gold, run.navy, run.provisions, run.jumps, run.condition.hull, ...run.condition.crew.map((c) => c.hp)];
  if (!numbers.every(Number.isFinite)) throw new Error('Save has a broken number');
  void run.node.col;
  if (run.status === 'battle' || run.status === 'hail') run.currentEnemy();
  if (!Object.values(run.standing).every(Number.isFinite)) throw new Error('Save has a broken standing');
  if (run.status === 'event') run.currentEvent();
  for (const id of run.prize?.guns ?? []) weapon(id);
  for (const node of run.chart.nodes) {
    if (node.enemy) enemy(node.enemy);
    for (const id of node.stock ?? []) weapon(id);
    if (node.story) seaEvent(node.story);
    if (node.rumour) seaEvent(node.rumour);
  }
  if (run.encounter.kind === 'port') {
    for (const id of run.encounter.stock) weapon(id);
    for (const id of run.encounter.fittings ?? []) fitting(id);
  }
  for (const id of run.fittings) fitting(id);
  new Ship(run.ship, 'player', run.condition);
}

export function clearSave(): void {
  if (!writable || coop()) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

const RECENT_KEY = 'slower-than-light.recent.v1';
/** How many past voyages count as recent: their events turn up less often in the next. */
const RECENT_VOYAGES = 3;

/** Events met in this browser's last few voyages. */
export function recentEvents(): string[] {
  try {
    const voyages = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[][];
    return [...new Set(voyages.flat())];
  } catch {
    return [];
  }
}

/** Remember a finished voyage's events (once per voyage, by its seed). */
export function recordVoyage(run: Run): void {
  if (!writable) return;
  try {
    const voyages = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[][];
    const key = `seed:${run.seed}`;
    if (voyages.some((v) => v[0] === key)) return;
    voyages.push([key, ...run.seenEvents]);
    localStorage.setItem(RECENT_KEY, JSON.stringify(voyages.slice(-RECENT_VOYAGES)));
  } catch {
    // Without storage every voyage simply starts fresh.
  }
}

const LOGBOOK_KEY = 'slower-than-light.logbook.v1';

/** Event ids met on any voyage in this browser. */
export function discovered(): Set<string> {
  try {
    const raw = localStorage.getItem(LOGBOOK_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Write an event into the lifetime logbook. */
export function recordDiscovery(id: string): void {
  if (!writable) return;
  try {
    const seen = discovered();
    if (seen.has(id)) return;
    seen.add(id);
    localStorage.setItem(LOGBOOK_KEY, JSON.stringify([...seen]));
  } catch {
    // The logbook is a nicety; ignore storage failures.
  }
}

const PROFILE_KEY = 'slower-than-light.profile.v1';

/** Lifetime record across voyages in this browser. */
export interface Profile {
  voyages: number;
  wins: number;
  captures: number;
  /** Renown earned over every voyage: it unlocks captains (data/captains.ts). */
  renown: number;
  /** Voyages (by seed) whose renown has been counted, so a voyage is only counted once. */
  counted?: number[];
}

export function profile(): Profile {
  const fresh: Profile = { voyages: 0, wins: 0, captures: 0, renown: 0 };
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Profile>) : {};
    return { voyages: Number(p.voyages) || 0, wins: Number(p.wins) || 0, captures: Number(p.captures) || 0, renown: Number(p.renown) || 0, counted: Array.isArray(p.counted) ? p.counted : [] };
  } catch {
    return fresh;
  }
}

/** Captains whose renown is earned. */
export function unlockedCaptains(): CaptainDef[] {
  const r = profile().renown;
  return CAPTAINS.filter((c) => c.renown <= r);
}

/**
 * Add a finished voyage's renown to the lifetime total (once per voyage), and say which captains it unlocked.
 * Dev sandboxes and co-op voyages count nothing.
 */
export function awardRenown(run: Run): { earned: number; total: number; unlocked: CaptainDef[] } {
  const p = profile();
  const earned = run.renown;
  if (!writable || coop() || p.counted?.includes(run.seed)) return { earned, total: p.renown, unlocked: [] };
  const before = p.renown;
  p.renown += earned;
  p.counted = [...(p.counted ?? []), run.seed].slice(-20);
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // Without storage, renown is kept for this visit only.
  }
  return { earned, total: p.renown, unlocked: CAPTAINS.filter((c) => c.renown > before && c.renown <= p.renown) };
}

export function bumpProfile(key: 'voyages' | 'wins' | 'captures'): void {
  if (!writable) return;
  try {
    const p = profile();
    p[key]++;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // The profile is a nicety; ignore storage failures.
  }
}

/** The scene a voyage should resume in. */
export function sceneFor(run: Run): string {
  switch (run.status) {
    case 'battle':
      return 'Battle';
    case 'hail':
      return 'Hail';
    case 'event':
      return 'Event';
    case 'port':
      return 'Port';
    case 'chart':
      return 'SeaMap';
    default:
      return 'RunEnd';
  }
}
