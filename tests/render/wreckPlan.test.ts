import { describe, expect, it } from 'vitest';
import { ensignDownAt, FINALE_HOLD, goneAt, LEAP_TIME, leaps, mastFalls, reachTime, TITLE_AT, waterline, type WreckKind } from '../../src/render/wreckPlan';

const KINDS: WreckKind[] = ['sink', 'explode'];

/** A fixed sequence of "random" numbers, so the tests don't wobble. */
function seq(): () => number {
  let i = 0;
  return () => ((i++ * 0.618034) % 1);
}

describe('wreck timetable', () => {
  for (const kind of KINDS) {
    describe(kind, () => {
      it('the sea only ever gains on her, and has all of her by the time she is gone', () => {
        let last = 0;
        for (let t = 0; t <= 6; t += 0.05) {
          const w = waterline(kind, t);
          expect(w).toBeGreaterThanOrEqual(last - 1e-9);
          last = w;
        }
        expect(waterline(kind, 0)).toBeLessThan(0.02);
        expect(waterline(kind, goneAt(kind) - 0.05)).toBeLessThan(1);
        expect(waterline(kind, goneAt(kind))).toBeGreaterThanOrEqual(1 - 1e-6);
      });

      it('reachTime finds when the water gets to a point', () => {
        for (const f of [0.1, 0.3, 0.5, 0.9]) expect(waterline(kind, reachTime(kind, f))).toBeCloseTo(f, 3);
      });

      it('her colours go last, and there is time to see them go before the result', () => {
        expect(ensignDownAt(kind)).toBeGreaterThan(goneAt(kind));
        expect(ensignDownAt(kind) + 0.8).toBeLessThanOrEqual(FINALE_HOLD[kind]);
        expect(FINALE_HOLD[kind]).toBeGreaterThanOrEqual(5);
        expect(FINALE_HOLD[kind]).toBeLessThanOrEqual(6.5);
        // The title fades in over the tail of it, not before she has had time to go.
        expect(TITLE_AT[kind]).toBeGreaterThan(3);
        expect(TITLE_AT[kind]).toBeLessThan(FINALE_HOLD[kind] - 1);
      });

      it('every mast is down before the sea reaches it', () => {
        for (const fracs of [[0.5], [0.2, 0.7], [0.15, 0.45, 0.85], [0.9, 0.1, 0.5]]) {
          const falls = mastFalls(kind, fracs);
          expect(falls.map((f) => f.index).sort()).toEqual(fracs.map((_, i) => i));
          for (const f of falls) {
            expect(f.start).toBeGreaterThanOrEqual(0);
            expect(f.start + f.dur).toBeLessThanOrEqual(reachTime(kind, fracs[f.index]) + 1e-6);
          }
        }
      });

      it('masts go one after another, from the end that goes first', () => {
        const fracs = [0.8, 0.2, 0.5];
        const falls = mastFalls(kind, fracs);
        const start = (i: number) => falls.find((f) => f.index === i)!.start;
        expect(start(1)).toBeLessThan(start(2));
        expect(start(2)).toBeLessThan(start(0));
      });

      it('every hand is over the side before she is gone, and before the water reaches them', () => {
        const fracs = [0.25, 0.4, 0.55, 0.7, 0.85, 0.3, 0.6, 0.95, 0.5, 0.45, 0.35, 0.65];
        const runs = fracs.map((_, i) => 0.5 + (i % 4) * 0.6);
        const plan = leaps(kind, fracs, runs, seq());
        expect(plan).toHaveLength(fracs.length);
        plan.forEach((lp, i) => {
          expect(lp.index).toBe(i);
          expect(lp.run).toBeLessThanOrEqual(lp.jump);
          expect(lp.land).toBeLessThan(goneAt(kind));
          if (!lp.thrown) {
            expect(lp.land - lp.jump).toBeCloseTo(LEAP_TIME, 6);
            expect(lp.jump).toBeLessThanOrEqual(reachTime(kind, fracs[i]));
          }
        });
      });
    });
  }

  it('blown up, those by the break are thrown into the sea at once', () => {
    const plan = leaps('explode', [0.05, 0.6], [1, 1], seq());
    expect(plan[0].thrown).toBe(true);
    expect(plan[0].jump).toBeLessThan(0.1);
    expect(plan[1].thrown).toBe(false);
    expect(leaps('sink', [0.05, 0.6], [1, 1], seq()).some((l) => l.thrown)).toBe(false);
  });

  it('blown up, the mast nearest the blast goes at once', () => {
    const falls = mastFalls('explode', [0.6, 0.1]);
    expect(falls.find((f) => f.index === 1)!.start).toBeLessThan(0.2);
  });
});
