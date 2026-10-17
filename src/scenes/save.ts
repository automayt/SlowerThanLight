import { weapon } from '../data/weapons';
import { Run } from '../sim/Run';
import { Ship } from '../sim/Ship';

const KEY = 'slower-than-light.voyage.v1';

let writable = true;

/** Dev sandboxes (the ?battle= shortcut) call this so they never touch the player's real voyage or records. */
export function disableSaving(): void {
  writable = false;
}

/** Remember the voyage in this browser so it can be continued later. Finished voyages are forgotten. */
export function saveRun(run: Run): void {
  if (!writable) return;
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

/** Throws if a loaded voyage refers to anything the current game data no longer has. */
function checkRun(run: Run): void {
  void run.node.col;
  if (run.status === 'battle') run.currentEnemy();
  if (run.status === 'event') run.currentEvent();
  for (const id of run.prize?.guns ?? []) weapon(id);
  new Ship(run.ship, 'player', run.condition);
}

export function clearSave(): void {
  if (!writable) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
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
}

export function profile(): Profile {
  const fresh: Profile = { voyages: 0, wins: 0, captures: 0 };
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Profile>) : {};
    return { voyages: Number(p.voyages) || 0, wins: Number(p.wins) || 0, captures: Number(p.captures) || 0 };
  } catch {
    return fresh;
  }
}

export function bumpProfile(key: keyof Profile): void {
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
