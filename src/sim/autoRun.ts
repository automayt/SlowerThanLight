import { Run, type BattleReport, type UpgradeId } from './Run';
import type { SystemId } from './types';

export interface AutoRunOptions {
  /** Player AI gun focus in battles. */
  focus?: SystemId;
  /** Simulated seconds before a battle counts as a stalemate. */
  battleLimit?: number;
  /** Spend spare gold in port on guns and upgrades (default true). */
  shop?: boolean;
}

export interface AutoRunResult {
  run: Run;
  battles: { enemy: string; report: BattleReport }[];
}

/**
 * Play a whole voyage with simple captain's choices: steer clear of the fleet, put into port when hurt,
 * take the first affordable event choice, and let the AI fight every battle.
 */
export function autoRun(run: Run, opts: AutoRunOptions = {}): AutoRunResult {
  const battles: AutoRunResult['battles'] = [];
  for (let guard = 0; guard < 100 && !run.over; guard++) {
    switch (run.status) {
      case 'chart': {
        const options = run.reachable();
        const hurt = run.condition.hull < run.fit.hull * 0.6;
        const score = (n: (typeof options)[number]) =>
          (run.willBeOverrun(n) ? -10 : 0) + (n.kind === 'port' && hurt ? 5 : 0) + (n.kind === 'battle' && hurt ? -2 : 0) + run.rng.next();
        const pick = [...options].sort((a, b) => score(b) - score(a))[0];
        run.jump(pick.id);
        break;
      }
      case 'battle': {
        const enemy = run.currentEnemy().id;
        const battle = run.startBattle({ autoPlayer: true, playerFocus: opts.focus });
        battle.runToEnd(opts.battleLimit ?? 900);
        if (!battle.outcome) {
          run.concede('The battle dragged on to a stalemate.');
          break;
        }
        battles.push({ enemy, report: run.finishBattle(battle) });
        break;
      }
      case 'event': {
        const ev = run.currentEvent();
        const i = ev.choices.findIndex((_, j) => run.canChoose(j));
        run.chooseEvent(i);
        break;
      }
      case 'port': {
        const hurt = run.condition.crew.some((c) => c.hp < 70) || Object.keys(run.condition.damage).length > 0;
        if (hurt) run.rest();
        while (run.repairHull(1));
        if (run.condition.crew.length < run.def.crew.length) run.hireCrew();
        if (opts.shop !== false) shop(run);
        run.leavePort();
        break;
      }
    }
  }
  return { run, battles };
}

/** Spend spare gold: the biggest affordable gun if a port is free, then upgrades in a sensible order. */
function shop(run: Run): void {
  const gun = run
    .gunOffers()
    .filter((o) => o.available)
    .sort((a, b) => b.price - a.price)[0];
  if (gun) run.buyGun(gun.weapon.id);
  const priority: UpgradeId[] = ['guns', 'hull', 'hands', 'sails', 'pumps', 'helm', 'surgeon'];
  for (const id of priority) while (run.buyUpgrade(id));
}
