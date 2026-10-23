/**
 * Captain's orders: a signature move for each part of the ship, each good for a few seconds and then on a cooldown.
 * Both ships have them; the player gives them as battle commands, an AI captain by the rules in EnemyAI.
 */

export type OrderId = 'rake' | 'sail' | 'steel';
export const ORDER_IDS: OrderId[] = ['rake', 'sail', 'steel'];

export interface OrderDef {
  name: string;
  /** What the officer bellows when it is given (the crew bark shown over the ship). */
  shout: string;
  blurb: string;
  /** Seconds it lasts. */
  duration: number;
  /** Seconds from giving it until it can be given again. */
  cooldown: number;
  /** Hotkey shown on its button. */
  key: string;
}

/** Rake her: balls fired while it lasts aim truer, hit one harder, never glance off, and crit more often. */
export const RAKE_ACCURACY = 20;
export const RAKE_DAMAGE = 1;
export const RAKE_CRIT = 2;
/** Crowd on sail: evasion added (and its new ceiling), escape charged faster, guns loaded slower while hands are aloft. */
export const SAIL_EVASION = 20;
export const SAIL_EVASION_CAP = 75;
export const SAIL_ESCAPE = 2;
export const SAIL_RELOAD = 0.6;
/** Cold steel: how much harder her people fight hand to hand. */
export const STEEL_MELEE = 1.5;

export const ORDERS: Record<OrderId, OrderDef> = {
  rake: {
    name: 'Rake her!',
    shout: 'Rake her, lads!',
    blurb: `For 5s every ball fired aims ${RAKE_ACCURACY}% truer, hits +${RAKE_DAMAGE} harder, never glances off, and is twice as likely to land a critical hit. Give it as a broadside goes off.`,
    duration: 5,
    cooldown: 40,
    key: 'Z',
  },
  sail: {
    name: 'Crowd on sail!',
    shout: 'All hands aloft! Crowd on sail!',
    blurb: `For 6s: +${SAIL_EVASION}% evasion and twice the speed making sail, but the guns load slower with hands aloft. Give it when her loaded guns are laid on you. Not while grappled.`,
    duration: 6,
    cooldown: 35,
    key: 'X',
  },
  steel: {
    name: 'Cold steel!',
    shout: 'Cold steel, boys! At them!',
    blurb: `For 10s your crew fight hand to hand ${STEEL_MELEE}× as hard, aboard either ship. Only once the ships are grappled.`,
    duration: 10,
    cooldown: 45,
    key: 'C',
  },
};

export interface OrderState {
  /** Seconds the order still has to run (0 when not in force). */
  active: number;
  /** Seconds until it can be given again. */
  cooldown: number;
}

export type ShipOrders = Record<OrderId, OrderState>;

export function freshOrders(): ShipOrders {
  return { rake: { active: 0, cooldown: 0 }, sail: { active: 0, cooldown: 0 }, steel: { active: 0, cooldown: 0 } };
}

/** Run every order's clock down. */
export function tickOrders(orders: ShipOrders, dt: number): void {
  for (const id of ORDER_IDS) {
    const o = orders[id];
    o.active = Math.max(0, o.active - dt);
    o.cooldown = Math.max(0, o.cooldown - dt);
  }
}
