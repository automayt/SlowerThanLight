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
