import { FITTINGS } from '../data/fittings';

/**
 * The ship's log: the moments of a voyage worth retelling, written as they happen (Run.note) and saved with it.
 * Pure data, so the end of a voyage can pick out its highlights.
 */
export interface LogEntry {
  /** Jump it happened on, and the sector (0-based). */
  jump: number;
  sector: number;
  kind: 'battle' | 'prize' | 'buy' | 'sector';
  text: string;
  /** Battles: her name, how it ended, gold taken, your hull left as a share, hull damage your guns dealt, seconds. */
  name?: string;
  outcome?: string;
  won?: boolean;
  gold?: number;
  hullLeft?: number;
  dealt?: number;
  time?: number;
  boss?: boolean;
  /** Purchases: what was bought (a weapon or fitting id). */
  item?: string;
}

/** Entries kept: a voyage is about 15 jumps, so this is never reached in play, only guards a runaway save. */
export const LOG_LIMIT = 120;

export interface Highlight {
  label: string;
  text: string;
}

const OUTCOME_VERB: Record<string, string> = {
  surrender: 'struck to you',
  captured: 'carried by boarding',
  victory: 'beaten',
  enemySunk: 'sent to the bottom',
};

/** How a won battle ended, in a few words ("carried by boarding"). */
export function outcomeVerb(kind: string): string {
  return OUTCOME_VERB[kind] ?? 'beaten';
}

/** The best stories in a voyage's log, at most `max` of them, most memorable first. */
export function highlights(log: readonly LogEntry[], max = 6): Highlight[] {
  const out: Highlight[] = [];
  const won = log.filter((e) => e.kind === 'battle' && e.won);
  const best = <T>(xs: T[], score: (x: T) => number) => xs.reduce<T | undefined>((b, x) => (b === undefined || score(x) > score(b) ? x : b), undefined);
  const boss = won.find((e) => e.boss);
  if (boss) out.push({ label: 'The blockade', text: `${boss.name} ${outcomeVerb(boss.outcome ?? '')}, with ${pct(boss.hullLeft)} of your hull left.` });
  const rich = best(won.filter((e) => (e.gold ?? 0) > 0), (e) => e.gold ?? 0);
  if (rich) out.push({ label: 'Richest prize', text: `${rich.name}, ${outcomeVerb(rich.outcome ?? '')}: ${rich.gold} gold.` });
  const close = best(won.filter((e) => e !== boss), (e) => -(e.hullLeft ?? 1));
  if (close && (close.hullLeft ?? 1) < 0.5) out.push({ label: 'Closest call', text: `Beat ${close.name} with ${pct(close.hullLeft)} of your hull left.` });
  const gunnery = best(log.filter((e) => e.kind === 'battle'), (e) => e.dealt ?? 0);
  if (gunnery && (gunnery.dealt ?? 0) > 0) out.push({ label: 'Hottest broadsides', text: `${gunnery.dealt} hull smashed in ${gunnery.name}${gunnery.time ? ` in ${Math.round(gunnery.time)} seconds` : ''}.` });
  const long = best(log.filter((e) => e.kind === 'battle'), (e) => e.time ?? 0);
  if (long && long !== gunnery && (long.time ?? 0) >= 120) out.push({ label: 'Longest fight', text: `${Math.round((long.time ?? 0) / 60)} minutes yardarm to yardarm with ${long.name}.` });
  const prizes = log.filter((e) => e.kind === 'prize');
  if (prizes.length) out.push({ label: prizes.length > 1 ? 'Prizes in company' : 'Prize in company', text: prizes.map((e) => e.name).join(', ') });
  const rare = log.filter((e) => e.kind === 'buy' && e.item && FITTINGS[e.item]?.rare);
  if (rare.length) out.push({ label: 'Rare finds', text: rare.map((e) => FITTINGS[e.item!].name).join(', ') });
  const record = log.filter((e) => e.kind === 'battle');
  if (record.length) out.push({ label: 'Battle record', text: `${won.length} won of ${record.length} fought` });
  return out.slice(0, max);
}

function pct(share: number | undefined): string {
  return `${Math.round(100 * Math.max(0, share ?? 0))}%`;
}
