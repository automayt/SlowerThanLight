import type { ShotType, Side } from './types';

/** Things that happened during a tick, for the renderer and combat log. `side` is the ship affected. */
export type BattleEvent =
  | { t: 'shot'; side: Side; gun: number; shot: ShotType }
  | { t: 'hit'; side: Side; room: string; hull: number; shot: ShotType }
  | { t: 'miss'; side: Side; room: string }
  | { t: 'fire'; side: Side; room: string }
  | { t: 'breach'; side: Side; room: string }
  | { t: 'death'; side: Side; name: string }
  | { t: 'log'; side: Side; text: string }
  /** `side` is the side sending boarders. */
  | { t: 'board'; side: Side; count: number; room: string };
