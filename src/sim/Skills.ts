import type { BattleEvent } from './events';
import type { Crew } from './Ship';

/** What a sailor can get better at. */
export type Skill = 'gunnery' | 'seamanship' | 'repair' | 'combat';
export type SkillXp = Partial<Record<Skill, number>>;

export const SKILLS: Skill[] = ['gunnery', 'seamanship', 'repair', 'combat'];

/** Experience needed for each rank: Veteran, then Expert. */
export const RANK_XP = [0, 50, 120];
export const RANK_NAMES = ['', 'Veteran', 'Expert'];

export const SKILL_LABEL: Record<Skill, string> = { gunnery: 'gunner', seamanship: 'helmsman', repair: 'carpenter', combat: 'brawler' };

/** What each rank is worth. */
export const GUNNERY_RELOAD = 0.1; // extra loading speed per rank for the gunner manning the gun deck
export const SEAMANSHIP_EVASION = 3; // evasion % per rank for the helmsman
export const REPAIR_BONUS = 0.25; // extra repair speed per rank
export const COMBAT_BONUS = 0.15; // extra hand-to-hand damage per rank

/** 0, 1 (Veteran) or 2 (Expert). */
export function rank(crew: Crew | undefined, skill: Skill): number {
  const xp = crew?.xp[skill] ?? 0;
  return xp >= RANK_XP[2] ? 2 : xp >= RANK_XP[1] ? 1 : 0;
}

/** Add experience; announces a promotion. */
export function train(crew: Crew, skill: Skill, amount: number, events?: BattleEvent[]): void {
  if (amount <= 0 || crew.side !== 'player') return;
  const before = rank(crew, skill);
  crew.xp[skill] = (crew.xp[skill] ?? 0) + amount;
  const after = rank(crew, skill);
  if (after > before) events?.push({ t: 'log', side: crew.side, text: `${crew.name} is now ${after === 2 ? 'an Expert' : 'a Veteran'} ${SKILL_LABEL[skill]}!` });
}

/** Short badge for a crew list: e.g. "G2 S1" for an expert gunner and veteran helmsman. */
export function badges(crew: { xp?: SkillXp }): string {
  return SKILLS.map((s) => {
    const xp = crew.xp?.[s] ?? 0;
    const r = xp >= RANK_XP[2] ? 2 : xp >= RANK_XP[1] ? 1 : 0;
    return r ? `${'★'.repeat(r)}${s[0].toUpperCase()}` : '';
  })
    .filter(Boolean)
    .join(' ');
}
