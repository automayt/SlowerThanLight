import type { CritKind } from './Crits';
import type { OrderId } from './Orders';
import type { ShotType, Side } from './types';

/** Things that happened during a tick, for the renderer and combat log. `side` is the ship affected. */
export type BattleEvent =
  | { t: 'shot'; side: Side; gun: number; shot: ShotType }
  | { t: 'hit'; side: Side; room: string; hull: number; shot: ShotType; deflected?: boolean }
  | { t: 'miss'; side: Side; room: string }
  /** A ball stopped by the target's bulwarks. */
  | { t: 'block'; side: Side; room: string }
  | { t: 'fire'; side: Side; room: string }
  | { t: 'breach'; side: Side; room: string }
  | { t: 'death'; side: Side; name: string }
  | { t: 'log'; side: Side; text: string }
  /** The boss rallies for her second phase. */
  | { t: 'rally'; side: Side; text: string }
  /** A friendly ship in company fires into the enemy (`side`); the hit follows as its own event. */
  | { t: 'consort'; side: Side; name: string; room: string }
  /** The enemy turns her guns on our consort. */
  | { t: 'consortHit'; side: Side; name: string; hull: number; maxHull: number }
  /** Our consort goes down. */
  | { t: 'consortSunk'; side: Side; name: string }
  /** `side` is the side sending boarders. */
  | { t: 'board'; side: Side; count: number; room: string }
  /** `side` gives one of the captain's orders (see Orders.ts). */
  | { t: 'order'; side: Side; order: OrderId }
  /** A critical hit on `side`'s ship (see Crits.ts); `name` is whoever it struck down, if anyone in particular. */
  | { t: 'crit'; side: Side; room: string; kind: CritKind; name?: string };
