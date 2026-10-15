import { canGrapple } from './Boarding';
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
  /** Send boarding parties of this many crew when the ships can grapple. 0 or unset: never board. */
  boardWith?: number;
}

/** What the battle lets a captain do with boarders. */
export interface BoardingActions {
  board(crew: Crew[], room: string): number;
  recall(crew: Crew): boolean;
  inTransit(): boolean;
}

/** Seconds before a captain first thinks about boarding, and between parties. */
const FIRST_BOARDING = 12;
const BOARDING_COOLDOWN = 40;
/** Boarders come home below this HP. */
const BOARDER_RETREAT_HP = 40;
/** Which systems boarders go for first. */
const SABOTAGE_ORDER: SystemId[] = ['guns', 'helm', 'sails', 'pumps', 'surgeon'];

export type AIDecision = 'none' | 'escape' | 'surrender';

const TARGET_WEIGHT: Partial<Record<SystemId, number>> = { guns: 3, helm: 2, sails: 2, pumps: 1, surgeon: 1 };

/** Simple captain that runs one ship: hands, crew, targeting, fleeing and surrender. */
export class ShipAI {
  fleeing = false;
  private think = 0;
  private surrenderRolled = false;
  private boardCooldown = FIRST_BOARDING;

  constructor(
    readonly ship: Ship,
    readonly opponent: Ship,
    readonly rng: Rng,
    readonly opts: AIOptions,
    readonly actions?: BoardingActions,
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
    this.boardCooldown -= dt;
    if (this.think > 0) return 'none';
    this.think = 0.5;
    this.manageHands();
    this.manageGuns();
    this.manageCrew();
    this.manageBoarding();
    return 'none';
  }

  private manageHands(): void {
    const ship = this.ship;
    const leaking = [...ship.rooms.values()].some((r) => r.breach || r.water > 5);
    const hurt = ship.own().some((c) => c.hp < 70);

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
    const alive = ship.own();
    if (!alive.length) return;

    // Keep someone's station at the helm.
    const helm = ship.system('helm')?.room;
    if (helm && !alive.some((c) => c.home === helm)) {
      const spare = alive.find((c) => c.home !== ship.system('guns')?.room) ?? alive[0];
      spare.home = helm;
    }

    // Rooms that need people, most urgent first: boarders to repel, then fires, leaks and damage.
    const intruders = new Map<string, number>();
    for (const b of ship.boarders()) intruders.set(destination(b), (intruders.get(destination(b)) ?? 0) + 1);
    const work = [...ship.rooms.values()]
      .map((r) => {
        const sys = r.def.system ? ship.system(r.def.system) : undefined;
        const need = intruders.get(r.def.id) ?? 0;
        const urgency = need ? -1 : r.fire > 0 ? 0 : r.breach ? 1 : sys && sys.damage > 0 ? 2 : -9;
        return { id: r.def.id, urgency, want: need ? need + 1 : 1 };
      })
      .filter((w) => w.urgency > -9)
      .sort((a, b) => a.urgency - b.urgency);
    const workIds = new Set(work.map((w) => w.id));

    const assigned = new Map<string, number>();
    for (const c of alive) if (workIds.has(destination(c))) assigned.set(destination(c), (assigned.get(destination(c)) ?? 0) + 1);

    const free = (c: Crew) => !workIds.has(destination(c)) && c.hp > 30;
    for (const w of work) {
      const candidates = alive.filter(free).sort((a, b) => this.distance(a, w.id) - this.distance(b, w.id));
      for (const c of candidates) {
        if ((assigned.get(w.id) ?? 0) >= w.want) break;
        if (orderMove(ship, c, w.id)) assigned.set(w.id, (assigned.get(w.id) ?? 0) + 1);
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

  private distance(c: Crew, roomId: string, ship: Ship = this.ship): number {
    return findRoute(ship.doors, c.room, roomId)?.length ?? 99;
  }

  /** Launch boarding parties, and steer our boarders through the opponent's ship. */
  private manageBoarding(): void {
    const actions = this.actions;
    if (!actions) return;
    const foe = this.opponent;
    const abroad = foe.crew.filter((c) => c.side === this.ship.side);

    for (const c of abroad) {
      if (c.hp < BOARDER_RETREAT_HP || this.fleeing) {
        actions.recall(c);
        continue;
      }
      if (c.waypoints.length || c.task === 'fight' || c.task === 'sabotage') continue;
      const next = this.sabotageTarget(c);
      if (next) orderMove(foe, c, next);
    }

    const size = this.opts.boardWith ?? 0;
    if (!size || this.fleeing || abroad.length || actions.inTransit() || this.boardCooldown > 0) return;
    if (!canGrapple(this.ship, foe)) return;
    const own = this.ship.own();
    if (own.length < size + 3) return;
    const helm = this.ship.system('helm')?.room;
    const party = own
      .filter((c) => c.home !== helm && c.hp > 60)
      .sort((a, b) => b.hp - a.hp)
      .slice(0, size);
    if (party.length < size) return;
    const target = SABOTAGE_ORDER.map((id) => foe.system(id)?.room).find((r) => r !== undefined);
    if (!target) return;
    if (actions.board(party, target)) this.boardCooldown = BOARDING_COOLDOWN;
  }

  /** The nearest opponent system room still worth wrecking. */
  private sabotageTarget(c: Crew): string | null {
    const foe = this.opponent;
    const rooms = SABOTAGE_ORDER.map((id) => foe.system(id))
      .filter((s) => s && s.damage < s.max)
      .map((s) => s!.room);
    if (!rooms.length) return null;
    if (rooms.includes(c.room)) return c.room;
    return rooms.sort((a, b) => this.distance(c, a, foe) - this.distance(c, b, foe))[0];
  }
}
