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
  /** `side` is the side sending boarders. */
  | { t: 'board'; side: Side; count: number; room: string };
