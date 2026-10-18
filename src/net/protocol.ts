import type { BattleCommand, Role, VoyageCommand } from '../sim/commands';
import type { BattleEvent } from '../sim/events';
import type { BattleReport, BattleSetup, Difficulty, RunSave } from '../sim/Run';
import type { BattleSnapshot } from '../sim/snapshot';

/**
 * Messages between co-op players and the server, as JSON over a WebSocket at /ws. The server runs the voyage and
 * every battle; players send commands, and see the voyage replayed command by command and battles as snapshots.
 */

/** Default port of `npm run server` (the Vite dev server proxies /ws to it). */
export const COOP_PORT = 8140;
export const PROTOCOL_VERSION = 1;

export interface Member {
  id: string;
  name: string;
  roles: Role[];
  online: boolean;
}

/** A crew as the lobby lists it. */
export interface CrewSummary {
  code: string;
  captain: string;
  ship: string;
  players: number;
  online: number;
  /** Whether the voyage is under way (joiners land in it), or the crew is still gathering. */
  sailing: boolean;
}

/** One crew as its members see it. */
export interface CrewState {
  code: string;
  members: Member[];
  ship: string;
  difficulty: Difficulty;
  phase: 'lobby' | 'voyage' | 'over';
}

export type ClientMessage =
  | { t: 'hello'; version: number; name: string; token?: string }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'roles'; roles: Role[] }
  | { t: 'setup'; ship: string; difficulty: Difficulty }
  | { t: 'start' }
  | { t: 'voyage'; cmd: VoyageCommand }
  | { t: 'suggest'; label: string }
  | { t: 'battle'; cmd: BattleCommand }
  | { t: 'sync' };

export type ServerMessage =
  | { t: 'welcome'; id: string; token: string; name: string }
  | { t: 'crews'; crews: CrewSummary[] }
  | { t: 'crew'; crew: CrewState | null }
  /** The whole voyage, when you join or after a battle, or whenever a copy has drifted. */
  | { t: 'voyageSync'; save: RunSave; report?: BattleReport }
  /** One voyage command, replayed on every copy; `check` is the server's fingerprint after it. */
  | { t: 'voyage'; cmd: VoyageCommand; by: string; check: string }
  | { t: 'battleStart'; setup: BattleSetup }
  | { t: 'battle'; snap: BattleSnapshot; events: BattleEvent[] }
  | { t: 'battleEnd'; report: BattleReport; save: RunSave }
  | { t: 'suggest'; by: string; label: string }
  | { t: 'notice'; text: string }
  | { t: 'error'; text: string };
