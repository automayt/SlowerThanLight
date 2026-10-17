import { STEP, type Battle } from './Battle';
import { Run, type BattleReport, type HailId, type UpgradeId } from './Run';
import type { SystemId } from './types';

export interface AutoRunOptions {
  /** Player AI gun focus in battles. */
  focus?: SystemId;
  /** Simulated seconds before a battle counts as a stalemate. */
  battleLimit?: number;
  /** Spend spare gold in port on guns and upgrades (default true). */
  shop?: boolean;
  /** Send boarding parties of this size in battle. */
  boardWith?: number;
  /** Talk before fighting: buy off or parley with warships, sail with allies, take commissions and court ports. */
  diplomacy?: boolean;
  /** Called after every simulation step of every battle (for tests that check the fight as it goes). */
  onTick?: (battle: Battle) => void;
}

export interface AutoRunResult {
  run: Run;
  /** Every fight, in order: who, in which sector, whether the fleet's vanguard sprang it, and how it went. */
  battles: { enemy: string; sector: number; ambush: boolean; report: BattleReport }[];
}

/** Decisions a voyage may take before autoRun gives up on it (a voyage is about 25 jumps and their encounters). */
export const MAX_DECISIONS = 100;

/**
 * Play a whole voyage with simple captain's choices: steer clear of the fleet, put into port when hurt,
 * take the first affordable event choice, and let the AI fight every battle.
 */
export function autoRun(run: Run, opts: AutoRunOptions = {}): AutoRunResult {
  const battles: AutoRunResult['battles'] = [];
  for (let guard = 0; guard < MAX_DECISIONS && !run.over; guard++) autoStep(run, opts, battles);
  return { run, battles };
}

/** Make one captain's decision: a jump, a whole battle, an event choice or a visit to port. */
export function autoStep(run: Run, opts: AutoRunOptions = {}, battles: AutoRunResult['battles'] = []): void {
  switch (run.status) {
    case 'chart': {
      const options = run.reachable();
      const hurt = run.condition.hull < run.fit.hull * 0.6;
      const hungry = run.provisions <= 2;
      // Press on rather than explore sideways, unless the detour is a port you need.
      const score = (n: (typeof options)[number]) =>
        (run.willBeOverrun(n) ? -10 : 0) +
        (run.isLateral(n) ? (n.kind === 'port' && (hurt || hungry) ? 1 : -4) : 0) +
        (n.kind === 'port' && (hurt || hungry) ? 5 : 0) +
        (n.kind === 'battle' && hurt ? -2 : 0) +
        run.rng.next();
      const pick = [...options].sort((a, b) => score(b) - score(a))[0];
      run.jump(pick.id);
      break;
    }
    case 'battle': {
      const enemy = run.currentEnemy().id;
      const { sector } = run;
      const ambush = run.encounter.kind === 'battle' && run.encounter.ambush;
      const battle = run.startBattle({ autoPlayer: true, playerFocus: opts.focus, playerBoardWith: opts.boardWith });
      const limit = opts.battleLimit ?? 900;
      if (opts.onTick) {
        while (!battle.outcome && battle.time < limit) {
          battle.step(STEP);
          opts.onTick(battle);
        }
      } else battle.runToEnd(limit);
      if (!battle.outcome) {
        run.concede('The battle dragged on to a stalemate.');
        break;
      }
      battles.push({ enemy, sector, ambush, report: run.finishBattle(battle) });
      // Spoils: a hand if short-crewed, else her best gun.
      const prize = run.prize;
      if (prize && !prize.taken) {
        if (prize.recruits && run.condition.crew.length < run.def.crew.length) run.pressPrizeCrew();
        else if (prize.guns.length) run.takePrizeGun(prize.guns[prize.guns.length - 1]);
      }
      break;
    }
    case 'hail':
      run.hail(hailChoice(run, opts));
      break;
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
      // Victuals first: enough for the rest of the sector and a little over.
      while (run.provisions < 10 && run.buyProvisions(1));
      if (opts.diplomacy) {
        run.takeCommission();
        if (run.gold > 120) run.gift();
      }
      if (opts.shop !== false) shop(run);
      run.leavePort();
      break;
    }
  }
}

/**
 * What to say to a sighted ship. A plain captain fights anything that isn't a friend, as before diplomacy;
 * a diplomat sails with allies, pays off warships when the purse allows and parleys when the odds are fair.
 */
function hailChoice(run: Run, opts: AutoRunOptions): HailId {
  const options = run.hailOptions().filter((o) => o.available);
  const has = (id: HailId) => options.some((o) => o.id === id);
  if (has('pardon')) return opts.diplomacy ? 'pardon' : 'attack';
  if (has('news') || has('escort')) {
    if (opts.diplomacy && has('escort')) return 'escort';
    return opts.diplomacy && has('news') ? 'news' : 'pass';
  }
  if (!opts.diplomacy || has('tribute')) return 'attack';
  if (has('bribe') && run.gold >= run.bribePrice() + 40) return 'bribe';
  if (has('parley') && run.parleyChance() >= 0.4) return 'parley';
  return 'attack';
}

/** Fittings a simple captain values, best first. */
const FITTING_PRIORITY = ['drill', 'careened', 'chest', 'spars', 'nets', 'casks'];

/** Spend spare gold: the biggest affordable gun if a port is free, often a fitting, then upgrades in a sensible order. */
function shop(run: Run): void {
  const gun = run
    .gunOffers()
    .filter((o) => o.available)
    .sort((a, b) => b.price - a.price)[0];
  if (gun) run.buyGun(gun.weapon.id);
  // Now and then the chandler gets first call on the purse, so voyages exercise fittings too.
  const fit = run
    .fittingOffers()
    .filter((o) => o.available)
    .sort((a, b) => FITTING_PRIORITY.indexOf(a.fitting.id) - FITTING_PRIORITY.indexOf(b.fitting.id))[0];
  if (fit && run.rng.chance(0.5)) run.buyFitting(fit.fitting.id);
  const priority: UpgradeId[] = ['guns', 'hull', 'hands', 'bulwarks', 'sails', 'pumps', 'helm', 'surgeon'];
  for (const id of priority) while (run.buyUpgrade(id));
  for (const o of run.fittingOffers()) if (o.available) run.buyFitting(o.fitting.id);
}
