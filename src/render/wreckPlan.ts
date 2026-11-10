/**
 * The timetable of a ship's last minutes, in seconds from the moment she is lost. Pure numbers, no Phaser, so the
 * order of things can be tested: the masts go by the board before the sea reaches them, every hand is over the side
 * before she is gone, and her colours are the last thing to go under.
 */

export type WreckKind = 'sink' | 'explode';

/** From the moment she is lost to the Result screen, when nobody skips it. */
export const FINALE_HOLD: Record<WreckKind | 'sail', number> = { sink: 6, explode: 6, sail: 3.8 };
/** When the outcome's title starts to fade in over the scene. */
export const TITLE_AT: Record<WreckKind | 'sail', number> = { sink: 3.7, explode: 3.7, sail: 1.4 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/**
 * How much of her length is under water, from the low end (a whole hull) or from the break (each half of one blown
 * in two): 0 to a little over 1. Sinking, she settles slowly by one end, hangs a moment, then plunges; blown apart,
 * the halves fill fast from their broken ends.
 */
export function waterline(kind: WreckKind, t: number): number {
  if (kind === 'sink') return 0.42 * smooth(0.3, 2.9, t) + 0.64 * Math.pow(clamp01((t - 3) / 1.6), 2);
  return 0.2 * smooth(0.1, 1.4, t) + 0.86 * Math.pow(clamp01((t - 1.7) / 2.7), 2);
}

/** When the sea reaches `frac` of her length from the end that goes first. */
export function reachTime(kind: WreckKind, frac: number): number {
  let lo = 0;
  let hi = 8;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (waterline(kind, m) < frac) lo = m;
    else hi = m;
  }
  return hi;
}

/** When the last of her hull is under. */
export function goneAt(kind: WreckKind): number {
  return reachTime(kind, 1);
}

/** Her ensign, last of all, and the burst of air that follows it up. */
export function ensignDownAt(kind: WreckKind): number {
  return goneAt(kind) + 0.4;
}

export interface MastFall {
  /** Index into the masts as given. */
  index: number;
  start: number;
  /** Seconds from the first crack to hitting the water. */
  dur: number;
}

/**
 * When each mast goes by the board, given where it stands as a share of the hull from the end that goes under
 * first: one after another from that end, each down before the water gets to it. Blown up, the nearest the blast
 * goes at once.
 */
export function mastFalls(kind: WreckKind, fracs: number[]): MastFall[] {
  const order = fracs.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
  const first = kind === 'sink' ? 0.85 : 0.1;
  const gap = kind === 'sink' ? 0.8 : 0.7;
  return order.map(({ f, i }, n) => {
    const dur = kind === 'explode' && n === 0 ? 0.6 : 0.9;
    const latest = reachTime(kind, Math.max(0.02, f)) - dur - 0.1;
    return { index: i, start: Math.max(0.05, Math.min(first + n * gap, latest)), dur };
  });
}

export interface Leap {
  index: number;
  /** Leaves her station for the rail. */
  run: number;
  /** Goes over the side. */
  jump: number;
  /** Hits the water. */
  land: number;
  /** Thrown into the sea by the blast rather than jumping. */
  thrown: boolean;
}

/** Seconds in the air going over the side. */
export const LEAP_TIME = 0.45;

/**
 * When each hand runs for the rail and goes over: those nearest the end that goes first, first. `fracs` is where
 * each stands as a share of the hull from that end, `runs` how far each has to go to the rail in tiles. Blown up,
 * those near the break are thrown in by the blast.
 */
export function leaps(kind: WreckKind, fracs: number[], runs: number[], rnd: () => number = Math.random): Leap[] {
  const order = fracs.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
  const spacing = Math.min(0.32, 2 / Math.max(1, order.length));
  const out: Leap[] = [];
  order.forEach(({ f, i }, n) => {
    if (kind === 'explode' && f < 0.22) {
      out.push({ index: i, run: 0.02, jump: 0.02, land: 0.02 + 0.55 + rnd() * 0.3, thrown: true });
      return;
    }
    const runTime = Math.max(0.2, Math.min(0.9, runs[i] / 3));
    let run = (kind === 'sink' ? 0.25 : 0.35) + n * spacing + rnd() * 0.15;
    // Over the side before the water reaches them.
    run = Math.max(0.05, Math.min(run, reachTime(kind, Math.max(0.03, f)) - runTime - LEAP_TIME - 0.1));
    const jump = run + runTime;
    out.push({ index: i, run, jump, land: jump + LEAP_TIME, thrown: false });
  });
  return out.sort((a, b) => a.index - b.index);
}
