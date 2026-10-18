import type { Battle } from './Battle';
import type { Duty } from './EnemyAI';
import type { EventResult, HailId, HailResult, Run, UpgradeId } from './Run';
import type { ShotType, Side, SystemId } from './types';

/**
 * Everything a player can do, as plain data: so a co-op server can check who sent it and apply it, and every
 * client can replay it. Single-player applies the same commands directly.
 */

/** The jobs aboard a shared ship. The captain also decides the voyage. */
export type Role = 'captain' | 'gunner' | 'bosun';
export const ROLES: Role[] = ['captain', 'gunner', 'bosun'];

export const ROLE_NAMES: Record<Role, string> = { captain: 'Captain', gunner: 'Master Gunner', bosun: 'Bosun' };
export const ROLE_BLURBS: Record<Role, string> = {
  captain: 'Chooses the course, answers hails and events, spends the purse, calls the speed and when to run.',
  gunner: 'Aims the guns, chooses the shot and calls the broadside.',
  bosun: 'Sets the deckhands and gun crews, sends the crew about the ship, and leads boarders.',
};

/** What an AI mate does for a role nobody holds. The captain's role is never left to the AI. */
const ROLE_DUTIES: Record<Role, Duty[]> = { captain: [], gunner: ['guns'], bosun: ['hands', 'crew'] };

/** The duties an AI mate takes on when only these roles are held by players. */
export function mateDuties(held: Iterable<Role>): Partial<Record<Duty, boolean>> {
  const have = new Set(held);
  const out: Partial<Record<Duty, boolean>> = {};
  for (const r of ROLES) if (!have.has(r)) for (const d of ROLE_DUTIES[r]) out[d] = true;
  return out;
}

export type BattleCommand =
  | { t: 'crew'; ids: number[]; room: string; ship: Side }
  | { t: 'aim'; gun: number; room: string | null }
  | { t: 'shot'; gun: number; shot: ShotType }
  | { t: 'gunPower'; gun: number }
  | { t: 'hands'; system: SystemId; delta: number }
  | { t: 'broadside'; on: boolean }
  | { t: 'escape' }
  | { t: 'pause'; on: boolean }
  | { t: 'speed'; speed: number };

/** Who may give each battle order. Pausing is anyone's: a friend who needs a moment gets one. */
export function battleRole(cmd: BattleCommand): Role | null {
  switch (cmd.t) {
    case 'aim':
    case 'shot':
    case 'broadside':
      return 'gunner';
    case 'crew':
    case 'hands':
    case 'gunPower':
      return 'bosun';
    case 'escape':
    case 'speed':
      return 'captain';
    case 'pause':
      return null;
  }
}

/** Carry out a battle order. Returns whether it did anything. */
export function applyBattle(b: Battle, cmd: BattleCommand): boolean {
  switch (cmd.t) {
    case 'crew':
      return b.orderCrew(cmd.ids, cmd.room, cmd.ship) > 0;
    case 'aim':
      b.aimGun(cmd.gun, cmd.room);
      return true;
    case 'shot':
      b.setShot(cmd.gun, cmd.shot);
      return true;
    case 'gunPower':
      return b.toggleGun(cmd.gun);
    case 'hands':
      return b.addHands(cmd.system, cmd.delta);
    case 'broadside':
      b.setBroadside(cmd.on);
      return true;
    case 'escape':
      return b.escape();
    case 'pause':
      b.paused = cmd.on;
      return true;
    case 'speed':
      b.speed = cmd.speed === 2 ? 2 : 1;
      return true;
  }
}

export type VoyageCommand =
  | { t: 'jump'; node: number }
  | { t: 'hail'; id: HailId }
  | { t: 'choose'; index: number }
  | { t: 'rest' }
  | { t: 'repairHull'; points: number }
  | { t: 'hire'; pick?: number }
  | { t: 'provisions'; n: number }
  | { t: 'fitting'; id: string }
  | { t: 'upgrade'; id: UpgradeId }
  | { t: 'buyGun'; weapon: string }
  | { t: 'sellGun'; index: number }
  | { t: 'gift' }
  | { t: 'commission' }
  | { t: 'leavePort' }
  | { t: 'prizeGun'; weapon: string }
  | { t: 'pressCrew' };

/** What a voyage command produced, for the screen that shows it. */
export type VoyageResult =
  | { t: 'event'; result: EventResult }
  | { t: 'hail'; result: HailResult }
  | { t: 'text'; text: string | null }
  | { t: 'ok'; ok: boolean };

/** Whether a command can be carried out right now (a server checks before applying and relaying it). */
export function voyageAllowed(run: Run, cmd: VoyageCommand): boolean {
  switch (cmd.t) {
    case 'jump':
      return run.status === 'chart' && run.reachable().some((n) => n.id === cmd.node);
    case 'hail':
      return run.status === 'hail' && run.hailOptions().some((o) => o.id === cmd.id && o.available);
    case 'choose':
      return run.status === 'event' && run.canChoose(cmd.index);
    case 'prizeGun':
    case 'pressCrew':
      return !!run.prize && !run.prize.taken;
    default:
      return run.status === 'port';
  }
}

/** Carry out a voyage command on a run. Every client and the server run the same commands in the same order. */
export function applyVoyage(run: Run, cmd: VoyageCommand): VoyageResult {
  switch (cmd.t) {
    case 'jump':
      run.jump(cmd.node);
      return { t: 'ok', ok: true };
    case 'hail':
      return { t: 'hail', result: run.hail(cmd.id) };
    case 'choose':
      return { t: 'event', result: run.chooseEvent(cmd.index) };
    case 'rest':
      return { t: 'ok', ok: run.rest() };
    case 'repairHull':
      return { t: 'ok', ok: run.repairHull(cmd.points) };
    case 'hire':
      return { t: 'text', text: run.hireCrew(cmd.pick) };
    case 'provisions':
      return { t: 'ok', ok: run.buyProvisions(cmd.n) };
    case 'fitting':
      return { t: 'ok', ok: run.buyFitting(cmd.id) };
    case 'upgrade':
      return { t: 'ok', ok: run.buyUpgrade(cmd.id) };
    case 'buyGun':
      return { t: 'ok', ok: run.buyGun(cmd.weapon) };
    case 'sellGun':
      return { t: 'ok', ok: run.sellGun(cmd.index) };
    case 'gift':
      return { t: 'text', text: run.gift().join(' ') || null };
    case 'commission':
      return { t: 'ok', ok: run.takeCommission() };
    case 'leavePort':
      run.leavePort();
      return { t: 'ok', ok: true };
    case 'prizeGun':
      return { t: 'text', text: run.takePrizeGun(cmd.weapon) };
    case 'pressCrew':
      return { t: 'text', text: run.pressPrizeCrew() };
  }
}

/** A short fingerprint of a voyage, so clients can tell when their copy has drifted from the server's. */
export function voyageCheck(run: Run): string {
  return [run.rng.position, run.status, run.nodeId, run.gold, run.provisions, run.condition.hull, run.condition.crew.length, run.jumps].join(':');
}
