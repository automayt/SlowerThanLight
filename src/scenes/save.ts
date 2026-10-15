import { Run } from '../sim/Run';

const KEY = 'slower-than-light.voyage.v1';

/** Remember the voyage in this browser so it can be continued later. Finished voyages are forgotten. */
export function saveRun(run: Run): void {
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
    return run.over ? null : run;
  } catch {
    return null;
  }
}

export function clearSave(): void {
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
