import { canGrapple } from './Boarding';
import { changeShot } from './Combat';
import { destination, orderMove } from './Crew';
import type { OrderId } from './Orders';
import { findRoute } from './pathfinding';
import { TEMPERS, type TemperDef, type TemperId } from './Temper';
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
  /** Which of the ship's work this captain does (all of it when unset): an AI mate covers only the roles no player holds. */
  duties?: Partial<Record<Duty, boolean>>;
  /** How this captain fights (see Temper.ts): picked from the battle's seed when unset. */
  temper?: TemperId;
}

/** The parts of running a ship: deckhands and gun power, gunnery, crew orders, boarding parties. */
export type Duty = 'hands' | 'guns' | 'crew' | 'boarding';

/** What the battle lets a captain do with boarders. */
export interface BoardingActions {
  board(crew: Crew[], room: string): number;
  recall(crew: Crew): boolean;
  inTransit(): boolean;
  /** Give one of the captain's orders (see Orders.ts), if it can be given now. */
  order?(id: OrderId): boolean;
  canOrder?(id: OrderId): boolean;
}

/** Seconds before a captain first thinks about boarding, and between parties. */
const FIRST_BOARDING = 12;
const BOARDING_COOLDOWN = 40;
/** Boarders come home below this HP. */
const BOARDER_RETREAT_HP = 40;
/** A party must be at least this strong relative to her whole crew before it boards. */
const BOARD_ODDS = 0.6;
/** Which systems boarders go for first. */
const SABOTAGE_ORDER: SystemId[] = ['guns', 'helm', 'bulwarks', 'sails', 'pumps', 'surgeon'];

export type AIDecision = 'none' | 'escape' | 'surrender';

const TARGET_WEIGHT: Partial<Record<SystemId, number>> = { guns: 3, helm: 2, sails: 2, bulwarks: 2, pumps: 1, surgeon: 1 };

/** Fraction loaded at which a gun counts as about to fire (for timing orders). */
const ABOUT_TO_FIRE = 0.85;
/** Weight of balls about to land on her (damage × shots) that makes an AI captain crowd on sail to dodge them. */
const DODGE_THREAT = 4;

/** Simple captain that runs one ship: hands, crew, targeting, fleeing and surrender. */
export class ShipAI {
  fleeing = false;
  private think = 0;
  private surrenderRolled = false;
  private boardCooldown: number;
  readonly temper: TemperDef | undefined;

  constructor(
    readonly ship: Ship,
    readonly opponent: Ship,
    readonly rng: Rng,
    readonly opts: AIOptions,
    readonly actions?: BoardingActions,
  ) {
    this.temper = opts.temper ? TEMPERS[opts.temper] : undefined;
    this.boardCooldown = this.temper?.board?.first ?? FIRST_BOARDING;
  }

  /** Whether this captain does a part of the ship's work (an AI mate does only the duties it was given). */
  private on(duty: Duty): boolean {
    const d = this.opts.duties;
    return d ? !!d[duty] : true;
  }

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
    if (this.on('hands')) this.manageHands();
    if (this.on('guns')) this.manageGuns();
    if (this.on('crew')) this.manageCrew();
    if (this.on('boarding')) this.manageBoarding();
    this.manageOrders();
    return 'none';
  }

  /**
   * The captain's orders: rake her as a volley is about to go off, crowd on sail to dodge one about to land (or to
   * get away), and cold steel once her people are fighting hand to hand. A mate gives only the orders of its duties,
   * never the captain's own (crowding on sail).
   */
  private manageOrders(): void {
    const act = this.actions;
    if (!act?.order || !act.canOrder) return;
    const ship = this.ship;
    const foe = this.opponent;
    const aboutToFire = (from: Ship, at: Ship) => from.guns.filter((g) => g.powered && g.target && at.rooms.has(g.target) && g.charge / g.def.loadTime >= ABOUT_TO_FIRE);
    if (this.on('guns') && act.canOrder('rake')) {
      const aimed = ship.guns.filter((g) => g.powered && g.target && foe.rooms.has(g.target)).length;
      if (aimed && aboutToFire(ship, foe).length >= Math.max(1, Math.ceil(aimed / 2))) act.order('rake');
    }
    if (!this.opts.duties && act.canOrder('sail')) {
      const threat = aboutToFire(foe, ship).reduce((n, g) => n + g.def.damage * g.def.shots, 0);
      if (this.fleeing || threat >= DODGE_THREAT) act.order('sail');
    }
    if (this.on('crew') && act.canOrder('steel')) {
      if ([...ship.crew, ...foe.crew].some((c) => c.side === ship.side && c.task === 'fight')) act.order('steel');
    }
  }

  private manageHands(): void {
    const ship = this.ship;
    const leaking = [...ship.rooms.values()].some((r) => r.breach || r.water > 5);
    const hurt = ship.own().some((c) => c.hp < 70);

    // Target hands per system, filled greedily in priority order.
    const order: SystemId[] = this.fleeing ? ['sails', 'pumps', 'bulwarks', 'surgeon', 'guns'] : ['guns', 'bulwarks', 'pumps', 'sails', 'surgeon'];
    const want: Partial<Record<SystemId, number>> = {
      guns: ship.capacity('guns'),
      bulwarks: ship.capacity('bulwarks'),
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
    // She's making sail to escape: put chain into her rigging with the first gun.
    const sails = this.opponent.system('sails')?.room;
    const chaser = !this.fleeing && sails && this.opponent.escape >= 50 ? this.ship.guns.find((g) => g.powered) : undefined;
    if (chaser && sails) {
      changeShot(chaser, 'chain');
      chaser.target = sails;
    }
    // Against bulwarks: fire together, and put chain into the station that raises them.
    const powered = this.ship.guns.filter((g) => g.powered);
    this.ship.broadside = this.opponent.level('bulwarks') > 0 && powered.length >= 2;
    const bulwarks = this.opponent.system('bulwarks')?.room;
    const breaker = bulwarks && this.opponent.capacity('bulwarks') > 0 && powered.length >= 2 ? powered.find((g) => g !== chaser) : undefined;
    if (breaker && bulwarks) {
      changeShot(breaker, 'chain');
      breaker.target = bulwarks;
    }
    // Her captain's temper: some guns loaded with his favourite shot, and laid on the stations he favours.
    const t = this.temper;
    const free = this.ship.guns.filter((g) => g !== chaser && g !== breaker);
    const shotGuns = t?.shot ? free.filter((x) => !x.def.fixedShot).slice(-t.shot.guns) : [];
    for (const g of shotGuns) changeShot(g, t!.shot!.type);
    const aimers = new Set(t?.aim ? (shotGuns.length ? shotGuns : free.slice(0, t.aimGuns ?? free.length)) : []);
    const favoured = (t?.aim ?? [])
      .map((id) => this.opponent.system(id))
      .filter((s) => s && s.damage < s.max)
      .map((s) => s!.room);
    let k = 0;
    for (const g of free) {
      if (focusRoom) {
        g.target = focusRoom;
        continue;
      }
      if (favoured.length && aimers.has(g)) {
        g.target = favoured[k++ % favoured.length];
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
    const style = this.temper?.board;
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
    // Only board when the party can stand up to her whole crew rallying against it.
    const strength = (cs: Crew[]) => cs.reduce((n, c) => n + c.melee * (c.hp / 100), 0);
    if (strength(party) < (style?.odds ?? BOARD_ODDS) * strength(foe.own())) return;
    const target = SABOTAGE_ORDER.map((id) => foe.system(id)?.room).find((r) => r !== undefined);
    if (!target) return;
    if (actions.board(party, target)) this.boardCooldown = style?.every ?? BOARDING_COOLDOWN;
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
