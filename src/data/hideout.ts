import type { Run } from '../sim/Run';
import type { GunMount, PowerId } from '../sim/types';
import { weapon } from './weapons';

/**
 * The pirates' hideout between voyages (scenes/HarbourScene.ts). It grows with lifetime renown: each milestone is
 * purely for show. A few renown unlocks are offered too, all optional: colours to fly (cosmetic) and alternate
 * starting guns for a ship (side-grades, checked with scripts/balance-hub.ts).
 */
export interface MilestoneDef {
  id: 'lanterns' | 'jetty' | 'careening' | 'colours' | 'beacon';
  renown: number;
  name: string;
  /** Said at the dock when it is first reached. */
  text: string;
}

export const MILESTONES: MilestoneDef[] = [
  { id: 'lanterns', renown: 20, name: 'Lanterns on the quay', text: 'Word of your name gets round: more hands drift in, and lanterns are strung along the quay.' },
  { id: 'jetty', renown: 50, name: 'A second jetty', text: 'The brethren drive new pilings: a second jetty reaches out into the cove.' },
  { id: 'careening', renown: 90, name: 'A careening yard', text: 'A careening yard on the beach: a hull hove down, a tar-pot fire and caulkers at work.' },
  { id: 'colours', renown: 140, name: 'Allied colours', text: 'A flagstaff on the headland flies the colours of every power that ever called you friend.' },
  { id: 'beacon', renown: 220, name: 'The beacon fire', text: 'A beacon burns on the headland: every rover in the Caribbean knows where your cove lies.' },
];

/** Colours a captain may fly from the ensign staff. The id is the Ensign the ship art paints (render/ShipArt.ts). */
export interface ColoursDef {
  id: 'pirate' | 'cutlasses' | 'hourglass';
  name: string;
  blurb: string;
  renown: number;
}

export const COLOURS: ColoursDef[] = [
  { id: 'pirate', name: 'The Jolly Roger', blurb: 'Skull and crossed bones on a black field: the old colours of the brethren.', renown: 0 },
  { id: 'cutlasses', name: 'Crossed Cutlasses', blurb: 'A grinning skull over two crossed blades, as Calico Jack flew.', renown: 40 },
  { id: 'hourglass', name: 'The Hourglass', blurb: 'A skeleton’s hourglass on black: your time is running out.', renown: 120 },
];

/** A ship's alternate starting guns, offered once enough renown is earned. Purely a different choice, not a better one. */
export interface LoadoutDef {
  id: string;
  ship: string;
  name: string;
  blurb: string;
  renown: number;
  guns: GunMount[];
}

export const LOADOUTS: LoadoutDef[] = [
  {
    id: 'wren-chaser',
    ship: 'wren',
    name: 'Chaser rig',
    blurb: 'Her 6-pounder swapped for a bow chaser: as quick to load, and twice as quick at a ship that runs.',
    renown: 30,
    guns: [{ weapon: 'pdr9' }, { weapon: 'pdr9' }, { weapon: 'chaser' }],
  },
  {
    id: 'gull-smasher',
    ship: 'gull',
    name: 'Smasher rig',
    blurb: 'Her 12-pounder traded for a short 24: one heavy ball instead of two, and some go wide.',
    renown: 70,
    guns: [{ weapon: 'carronade' }, { weapon: 'pdr9' }, { weapon: 'pdr9' }],
  },
  {
    id: 'maw-mortar',
    ship: 'maw',
    name: 'Bomb battery',
    blurb: 'Her short 24 traded for a sea mortar, lobbing shells over the bulwarks: slow, and it misses more, but no wall stops it.',
    renown: 160,
    guns: [{ weapon: 'pdr12' }, { weapon: 'pdr12' }, { weapon: 'mortar' }, { weapon: 'pdr6' }],
  },
];

/** The other powers' flags fly over the hideout once you have ended a voyage allied with them. */
export const ALLY_POWERS: PowerId[] = ['crown', 'spain', 'france', 'brethren', 'trade'];

export const milestonesAt = (renown: number): MilestoneDef[] => MILESTONES.filter((m) => m.renown <= renown);
export const reachedMilestone = (renown: number, id: MilestoneDef['id']): boolean => milestonesAt(renown).some((m) => m.id === id);
export const coloursAt = (renown: number): ColoursDef[] => COLOURS.filter((c) => c.renown <= renown);
export const loadoutsFor = (shipId: string, renown: number): LoadoutDef[] => LOADOUTS.filter((l) => l.ship === shipId && l.renown <= renown);

export function loadout(id: string): LoadoutDef | undefined {
  return LOADOUTS.find((l) => l.id === id);
}

/** The next thing renown will bring to the hideout, for "N renown to go" on the dock. */
export function nextMilestone(renown: number): { name: string; renown: number } | null {
  const all = [...MILESTONES, ...COLOURS.filter((c) => c.renown > 0), ...LOADOUTS].filter((m) => m.renown > renown);
  all.sort((a, b) => a.renown - b.renown);
  return all[0] ? { name: all[0].name, renown: all[0].renown } : null;
}

/** Everything renown brought between two totals: shown arriving at the dock after a voyage. */
export function arrivals(before: number, after: number): { milestones: MilestoneDef[]; colours: ColoursDef[]; loadouts: LoadoutDef[] } {
  const between = <T extends { renown: number }>(xs: T[]) => xs.filter((x) => x.renown > before && x.renown <= after);
  return { milestones: between(MILESTONES), colours: between(COLOURS), loadouts: between(LOADOUTS) };
}

/**
 * Fit a fresh voyage's ship with an alternate starting battery. Her gun station keeps at least the bars its crews
 * need. A loadout for another ship is ignored. Called once, before the first jump; the fit is saved with the voyage.
 */
export function applyLoadout(run: Run, id: string | null | undefined): boolean {
  const l = id ? loadout(id) : undefined;
  if (!l || l.ship !== run.def.id) return false;
  run.fit.guns = l.guns.map((g) => ({ ...g }));
  const hands = l.guns.reduce((n, g) => n + weapon(g.weapon).hands, 0);
  run.fit.systems.guns = Math.max(run.fit.systems.guns ?? 0, hands);
  return true;
}
