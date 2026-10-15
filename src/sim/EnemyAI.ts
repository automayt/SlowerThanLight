import { destination, orderMove } from './Crew';
import { findRoute } from './pathfinding';
import type { Rng } from './rng';
import type { Crew, Ship } from './Ship';
import type { SystemId } from './types';
import { HANDS_SYSTEMS } from './types';

export interface AIOptions {
  /** Hull fraction at which the ship turns to flee. 0 disables fleeing. */
  fleeAt: number;
  /** Chance of striking colours the first time hull drops to `surrenderAt`. */
  surrenderChance: number;
  surrenderAt: number;
  /** Aim every gun at this system instead of spreading fire (models a focused human player). */
  focus?: SystemId;
}

export type AIDecision = 'none' | 'escape' | 'surrender';

const TARGET_WEIGHT: Partial<Record<SystemId, number>> = { guns: 3, helm: 2, sails: 2, pumps: 1, surgeon: 1 };

/** Simple captain that runs one ship: hands, crew, targeting, fleeing and surrender. */
export class ShipAI {
  fleeing = false;
  private think = 0;
  private surrenderRolled = false;

  constructor(
    readonly ship: Ship,
    readonly opponent: Ship,
    readonly rng: Rng,
    readonly opts: AIOptions,
  ) {}

  update(dt: number): AIDecision {
    const ship = this.ship;
    const hullFrac = ship.hull / ship.def.hull;

    if (!this.surrenderRolled && this.opts.surrenderChance > 0 && hullFrac <= this.opts.surrenderAt) {
      this.surrenderRolled = true;
      if (this.rng.chance(this.opts.surrenderChance)) return 'surrender';
    }
    if (this.opts.fleeAt > 0 && hullFrac <= this.opts.fleeAt) this.fleeing = true;
    if (this.fleeing && ship.escape >= 100) return 'escape';

    this.think -= dt;
    if (this.think > 0) return 'none';
    this.think = 0.5;
    this.manageHands();
    this.manageGuns();
    this.manageCrew();
    return 'none';
  }

  private manageHands(): void {
    const ship = this.ship;
    const leaking = [...ship.rooms.values()].some((r) => r.breach || r.water > 5);
    const hurt = ship.crew.some((c) => c.hp < 70);

    // Target hands per system, filled greedily in priority order.
    const order: SystemId[] = this.fleeing ? ['sails', 'pumps', 'surgeon', 'guns'] : ['guns', 'pumps', 'sails', 'surgeon'];
    const want: Partial<Record<SystemId, number>> = {
      guns: ship.capacity('guns'),
      sails: ship.capacity('sails'),
      pumps: leaking ? ship.capacity('pumps') : 0,
      surgeon: hurt ? ship.capacity('surgeon') : 0,
    };
    let budget = ship.def.hands;
    const target: Partial<Record<SystemId, number>> = {};
    const gunsOn: boolean[] = ship.guns.map(() => false);
    for (const id of order) {
      if (id === 'guns') {
        let used = 0;
        ship.guns.forEach((g, i) => {
          if (used + g.def.hands <= (want.guns ?? 0) && g.def.hands <= budget) {
            gunsOn[i] = true;
            used += g.def.hands;
            budget -= g.def.hands;
          }
        });
      } else {
        target[id] = Math.min(want[id] ?? 0, budget);
        budget -= target[id]!;
      }
    }

    // Release first, then assign, so hands are free when needed.
    for (const id of HANDS_SYSTEMS) {
      const s = ship.system(id);
      if (s && s.hands > (target[id] ?? 0)) ship.addHands(id, (target[id] ?? 0) - s.hands);
    }
    ship.guns.forEach((g, i) => {
      if (g.powered && !gunsOn[i]) ship.toggleGun(i, false);
    });
    ship.guns.forEach((g, i) => {
      if (!g.powered && gunsOn[i]) ship.toggleGun(i, true);
    });
    for (const id of HANDS_SYSTEMS) {
      const s = ship.system(id);
      if (!s) continue;
      while (s.hands < (target[id] ?? 0) && ship.addHands(id, 1)) {
        /* fill */
      }
    }
  }

  private manageGuns(): void {
    const rooms = [...this.opponent.rooms.values()];
    const focusRoom = this.opts.focus && this.opponent.system(this.opts.focus)?.room;
    for (const g of this.ship.guns) {
      if (focusRoom) {
        g.target = focusRoom;
        continue;
      }
      if (g.target && this.opponent.rooms.has(g.target)) continue;
      g.target = this.rng.weighted(rooms, (r) => (r.def.system ? (TARGET_WEIGHT[r.def.system] ?? 0.5) : 0.5)).def.id;
    }
  }

  private manageCrew(): void {
    const ship = this.ship;
    const alive = ship.crew;
    if (!alive.length) return;

    // Keep someone's station at the helm.
    const helm = ship.system('helm')?.room;
    if (helm && !alive.some((c) => c.home === helm)) {
      const spare = alive.find((c) => c.home !== ship.system('guns')?.room) ?? alive[0];
      spare.home = helm;
    }

    // Rooms that need work, most urgent first.
    const work = [...ship.rooms.values()]
      .map((r) => {
        const sys = r.def.system ? ship.system(r.def.system) : undefined;
        const urgency = r.fire > 0 ? 0 : r.breach ? 1 : sys && sys.damage > 0 ? 2 : -1;
        return { id: r.def.id, urgency };
      })
      .filter((w) => w.urgency >= 0)
      .sort((a, b) => a.urgency - b.urgency);
    const workIds = new Set(work.map((w) => w.id));

    const covered = new Set<string>();
    for (const c of alive) if (workIds.has(destination(c))) covered.add(destination(c));

    const free = (c: Crew) => !workIds.has(destination(c)) && c.hp > 30;
    for (const w of work) {
      if (covered.has(w.id)) continue;
      const candidates = alive.filter(free).sort((a, b) => this.distance(a, w.id) - this.distance(b, w.id));
      for (const c of candidates) {
        if (orderMove(ship, c, w.id)) {
          covered.add(w.id);
          break;
        }
      }
    }

    const surgeon = ship.system('surgeon');
    const surgeonOpen = surgeon && ship.level('surgeon') > 0;
    for (const c of alive) {
      if (workIds.has(destination(c))) continue;
      const wounded = c.hp < 45 || (c.hp < c.maxHp && destination(c) === surgeon?.room);
      const goal = wounded && surgeonOpen ? surgeon!.room : c.home;
      if (destination(c) !== goal) orderMove(ship, c, goal);
    }
  }

  private distance(c: Crew, roomId: string): number {
    return findRoute(this.ship.doors, c.room, roomId)?.length ?? 99;
  }
}
