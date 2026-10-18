import { enemy } from '../data/enemies';
import { playerShip } from '../data/ships';
import { FITTING_IDS, fitting, type FittingDef } from '../data/fittings';
import { COOK_FORAGE, SURGEON_TRAIT_HEAL, TRAIT_IDS, trait } from '../data/traits';
import { PORT_NAMES, PORT_SPECIALITY, RECRUIT_NAMES, SEA_EVENTS, SECTOR_ROUTE, seaEvent, sectorDef, type PortSpeciality } from '../data/voyage';
import { WEAPONS, weapon } from '../data/weapons';
import { POWER_IDS, portPower, power, relation } from '../data/powers';
import { Battle, type BattleOptions, type OutcomeKind } from './Battle';
import { AGGRESSION, atLeast, BETRAYAL, describeShift, freshStanding, OUTCOME_STANDING, PORT_PRICE, shiftStanding, tierOf, type Standing } from './Diplomacy';
import { Rng } from './rng';
import { generateChart, nodeById, SECTOR_COLUMNS, type SeaChart, type SeaNode } from './SeaChart';
import { Ship, type ShipCondition } from './Ship';
import type { EnemyDef, EventEffect, EventNeeds, EventPool, EventRarity, GunMount, PowerId, SeaEventDef, ShipDef, SystemId, UpgradeId, WeaponDef } from './types';
import { SYSTEM_NAMES } from './types';
import { RANK_XP, SKILL_LABEL, type Skill, type SkillXp } from './Skills';

/** Where the Navy fleet starts, in chart columns (the player starts in column 0). */
export const NAVY_START = -2.5;
/**
 * Share of the ground the fleet has made up on you, beyond what a straight run gives away, that it keeps
 * through a passage into the next sector. Sailing straight on stays safe; detours, rests and alarms follow you.
 */
export const SECTOR_CARRY = 0.75;
/** Columns the fleet advances per jump. A little faster than you, so dawdling catches up with you. */
export const NAVY_SPEED = 1.25;
/** Columns the fleet loses when you sink one of its pickets. */
export const AMBUSH_SETBACK = 1;
/** Columns the fleet gains when a ship you fought gets away to raise the alarm. */
export const ALARM_DELAY = 0.5;
/** Columns the fleet gains while you rest and refit in port. */
export const PORT_REST_DELAY = 0.5;

export const START_GOLD = 30;

export type Difficulty = 'easy' | 'normal' | 'hard';

/** What each difficulty changes: how fast the fleet closes, starting gold, and how tough enemy hulls are. */
export const DIFFICULTY: Record<Difficulty, { label: string; navySpeed: number; startGold: number; provisions: number; enemyHull: number; enemyReload: number; blurb: string }> = {
  easy: { label: 'Easy', navySpeed: 1.0, startGold: 80, provisions: 14, enemyHull: 0.75, enemyReload: 0.8, blurb: 'A slower fleet, a fuller purse, weaker enemies.' },
  normal: { label: 'Normal', navySpeed: NAVY_SPEED, startGold: START_GOLD, provisions: 10, enemyHull: 1.1, enemyReload: 1, blurb: 'The voyage as intended.' },
  hard: { label: 'Hard', navySpeed: 1.5, startGold: 10, provisions: 8, enemyHull: 1.3, enemyReload: 1.15, blurb: 'A faster fleet, an empty purse, deadlier enemies.' },
};

/** Provisions the hold carries (more with extra water casks). */
export const MAX_PROVISIONS = 20;
export const CASK_PROVISIONS = 30;
/** Gold per provision in port. */
export const PROVISION_PRICE = 3;
/** HP every crew member loses for each jump made on empty stores, and the chance someone deserts. */
export const STARVE_HP = 25;
export const DESERT_CHANCE = 0.3;
/** Chance a quiet crossing of open sea brings in a provision (fishing, a turtle, rainwater). */
export const FORAGE_CHANCE = 0.3;
/** Plunder is scaled by this, and by a further share per sector deeper into the voyage. */
export const PLUNDER_MULT = 1.25;
export const SECTOR_PLUNDER = 0.25;
/** Shipwright, chandler and armoury prices rise by this share per sector (hull repairs, crew and food do not). */
export const SECTOR_PRICE = 0.2;
/** Gold found in events rises by this share per sector. */
export const SECTOR_EVENT_GOLD = 0.2;

/** One step heavier for each gun a better-found ship carries. */
const HEAVIER: Record<string, string> = { pdr6: 'pdr9', pdr9: 'pdr12' };

/** Hands needed to crew a set of guns. */
const gunHands = (guns: GunMount[]) => guns.reduce((n, g) => n + weapon(g.weapon).hands, 0);

/**
 * A tougher enemy for deeper sectors: 10% more hull per tier, one gun a step heavier per tier (never the same gun
 * twice), and in the last sector a bar more sail. She gets exactly the hands and gun bars to work it all, so nobody
 * stands idle.
 */
export function scaleEnemy(def: ShipDef, tier: number): ShipDef {
  if (tier <= 0) return def;
  const systems = { ...def.systems };
  const guns = def.guns.map((g) => ({ ...g }));
  const upgraded = new Set<number>();
  for (let t = 0; t < Math.min(tier, 2); t++) {
    // First a 6-pounder becomes a 9; deeper still, another gun goes from a 9 to a 12.
    const order = t === 0 ? ['pdr6', 'pdr9'] : ['pdr9', 'pdr6'];
    const pick = order.map((from) => guns.findIndex((g, i) => !upgraded.has(i) && g.weapon === from)).find((i) => i >= 0);
    if (pick === undefined) break;
    guns[pick].weapon = HEAVIER[guns[pick].weapon];
    upgraded.add(pick);
  }
  const extraGunHands = gunHands(guns) - gunHands(def.guns);
  systems.guns = Math.max(systems.guns ?? 0, gunHands(guns));
  // The last sector's ships also carry more sail, with a hand to work it.
  const sails = tier >= 2 ? 1 : 0;
  systems.sails = (systems.sails ?? 0) + sails;
  return { ...def, hull: Math.round(def.hull * (1 + 0.1 * tier)), hands: def.hands + extraGunHands + sails, systems, guns };
}
/** How well found the blockade frigate is, on scaleEnemy's scale: more hull and a 12-pounder for her long 9. */
export const BOSS_TIER = 1;
export const HULL_PRICE = 3;
export const CREW_PRICE = 30;
/** Hired crew allowed above the ship's starting complement. */
export const EXTRA_CREW = 2;
/** Healing per jump while under way. */
export const JUMP_HEAL = 15;

/** Gun ports on every ship. */
export const MAX_GUNS = 4;
/** Most bars a shipwright can give each system. */
export const SYSTEM_CAP: Record<SystemId, number> = { helm: 3, sails: 6, guns: 8, pumps: 4, surgeon: 3, bulwarks: 4 };
/** Deckhands you can sign on above the ship's own. */
export const EXTRA_HANDS = 3;
/** Max hull added by each round of oak planking, and how many rounds a ship can take. */
export const PLATING = 3;
export const MAX_PLATING = 2;

/** Weapons sold in port armouries, cheapest first. */
export const ARMOURY = Object.values(WEAPONS)
  .sort((a, b) => a.price - b.price)
  .map((w) => w.id);

export type { UpgradeId };

/** How often each rarity is drawn, relative to the others. */
export const RARITY_WEIGHT: Record<EventRarity, number> = { common: 10, uncommon: 5, rare: 2.5, legendary: 1 };
/** Weight of an event met in one of the last few voyages, so each voyage tells more new tales. */
export const RECENT_WEIGHT = 0.35;
/** How a missing story flag is described on a locked choice. */
const FLAG_LACKING: Record<string, string> = { cat: 'no ship’s cat', 'map-half': 'no map', 'map-whole': 'no map', cursed: 'not cursed' };
/** Weight multiplier for events that follow on from a story flag. */
export const STORY_BOOST = 2;
/** What a friendly ship asks for her spare stores, and how many she sells. */
export const HAIL_TRADE_PRICE = 12;
export const HAIL_TRADE_PROVISIONS = 4;
/** Chance a false flag fools her, and what her flag thinks of the trick when it does not. */
export const FALSE_COLOURS_CHANCE = 0.45;
export const FALSE_COLOURS_PENALTY = 8;
/** Columns the fleet loses when a friendly captain tells you where it is searching. */
export const NEWS_SETBACK = 0.5;
/** A consort's broadside: every so many seconds, a ball of this weight into a random room of the enemy. */
export const CONSORT_EVERY = 9;
export const CONSORT_DAMAGE = 2;
/** Gift to a port's masters, before sector prices, and what it buys. */
export const GIFT_PRICE = 30;
export const GIFT_STANDING = 10;
/** A commission's rewards: gold before sector scaling, and the patron's gratitude. */
export const HUNT_REWARD = 45;
export const DISPATCH_REWARD = 25;
export const COMMISSION_STANDING = 15;
/** How much of the blockade frigate's hull the Brethren shoot away when they come to your aid. */
export const BRETHREN_AID = 0.2;

/**
 * The wind on the chart. A leg sailed into it (its heading within 60 degrees of where the wind comes from) is foul:
 * a day lost beating to windward, eating an extra day's provisions while the fleet closes. A leg with the wind astern
 * is fair, and you gain on the fleet. The wind backs and veers by up to 45 degrees each jump.
 */
export const FOUL_FLEET = 0.25;
export const FAIR_FLEET = 0.25;
const WIND_SHIFT = Math.PI / 2;
/** How tall the chart is for its width, so a leg's heading matches what the chart shows (one column across, 0..1 down). */
const CHART_ASPECT = 1.8;

export type PointOfSail = 'foul' | 'beam' | 'fair';

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

/** Chance that crossing open sea brings an incident aboard. */
export const INCIDENT_CHANCE = 0.6;

export interface UpgradeOffer {
  id: UpgradeId;
  label: string;
  detail: string;
  price: number;
  /** Already at its cap; can never be bought again. */
  maxed: boolean;
  available: boolean;
}

export interface GunOffer {
  weapon: WeaponDef;
  price: number;
  available: boolean;
}

/** How the ship is fitted out: starts as built, changed by the shipwright and the armoury. */
export interface ShipFit {
  hull: number;
  hands: number;
  systems: Partial<Record<SystemId, number>>;
  guns: GunMount[];
}

/** Everything needed to pick a voyage back up. */
export interface RunSave {
  version: 1;
  shipId: string;
  seed: number;
  rng: number;
  chart: SeaChart;
  nodeId: number;
  navy: number;
  gold: number;
  condition: ShipCondition;
  fit: ShipFit;
  status: RunStatus;
  encounter: Encounter;
  jumps: number;
  visited: number[];
  battlesWon: number;
  plunderTaken: number;
  ending: string;
  usedNames: string[];
  /** Added after the first saves; optional so older saves still load. */
  endingTitle?: string;
  difficulty?: Difficulty;
  flags?: string[];
  seenEvents?: string[];
  prize?: Prize | null;
  sector?: number;
  provisions?: number;
  fittings?: string[];
  standing?: Standing;
  escort?: Escort | null;
  commission?: Commission | null;
  recent?: string[];
  sectorId?: string;
  wind?: number;
}

/** Share of the enemy's hold you get to keep, by how the fight ended. */
export const PLUNDER_SHARE: Partial<Record<OutcomeKind, number>> = {
  surrender: 1,
  captured: 1.25,
  victory: 0.6,
  enemySunk: 0.4,
};

export type RunStatus = 'chart' | 'hail' | 'battle' | 'event' | 'port' | 'won' | 'lost';

/** What a sighted ship means to do: fight you, keep clear of you, greet you, or (the blockade) hear you out. */
export type Intent = 'hostile' | 'wary' | 'friendly' | 'commodore';

/** A friendly captain sailing in company for your next fight. */
export interface Escort {
  name: string;
  power: PowerId;
}

/** Work for a power: take one of its enemies' ships, or carry its dispatches to the next port. */
export interface Commission {
  patron: PowerId;
  kind: 'hunt' | 'dispatch';
  /** For a hunt: whose ship to take or sink. */
  target?: PowerId;
  /** The port that gave it (a dispatch is delivered at any other). */
  port: string;
  gold: number;
  standing: number;
}

export type HailId = 'attack' | 'parley' | 'bribe' | 'colours' | 'tribute' | 'pass' | 'news' | 'trade' | 'escort' | 'pardon';

export interface HailOption {
  id: HailId;
  label: string;
  detail: string;
  available: boolean;
  /** Why it is not available. */
  blocker?: string;
  /** Odds of it working, when it can fail. */
  chance?: number;
  cost?: number;
  /** Choosing it starts (or may start) a fight. */
  fight: 'yes' | 'maybe' | 'no';
}

export interface HailResult {
  text: string;
  changes: string[];
  fight: boolean;
}

export type Encounter =
  | {
      kind: 'battle';
      enemy: string;
      name: string;
      boss: boolean;
      ambush: boolean;
      text: string;
      /** How she greeted you, when she was hailed first (battle nodes and the blockade). */
      intent?: Intent;
      /** You started it with a ship that would have let you be; `betrayal` if she was a friend. */
      aggressor?: boolean;
      betrayal?: boolean;
    }
  | { kind: 'event'; event: string; actor?: string; actor2?: string; variant?: number }
  | {
      kind: 'port';
      name: string;
      rested: boolean;
      stock: string[];
      fittings?: string[];
      /** Paid our respects to the harbour's masters this visit. */
      gifted?: boolean;
      /** Work the harbour offers (taken or not). */
      commission?: Commission | null;
      /** What happened as you came in, e.g. a dispatch delivered. */
      welcome?: string[];
      /** Sailors in the hiring hall, each with a background (and a price to match). */
      hands?: Candidate[];
    }
  | { kind: 'empty'; text: string; title?: string }
  | { kind: 'start' };

/** Everything needed to build a battle: both ships and the fight's options. */
export interface BattleSetup {
  player: ShipDef;
  enemy: ShipDef;
  options: BattleOptions;
}

/** A sailor looking for a berth. */
export interface Candidate {
  name: string;
  trait: string;
}

export interface BattleReport {
  kind: OutcomeKind;
  won: boolean;
  plunder: number;
  lines: string[];
}

/** What a beaten ship has to offer beyond her gold: one pick, made on the result screen. */
export interface Prize {
  /** Weapon ids of her guns you could take. */
  guns: string[];
  /** Survivors willing to sign on (only when she struck her colours). */
  recruits: number;
  /** Whether the pick has been made. */
  taken: boolean;
}

export interface FittingOffer {
  fitting: FittingDef;
  price: number;
  available: boolean;
}

export interface EventResult {
  effect: EventEffect;
  /** Plain-language summary of what changed. */
  changes: string[];
}

/** One voyage from Tortuga to the blockade. Pure state: scenes read it and call its methods. */
export class Run {
  readonly seed: number;
  readonly rng: Rng;
  readonly def: ShipDef;
  chart: SeaChart;
  fit: ShipFit;
  nodeId = 0;
  /** Column the Navy fleet has reached; nodes at or behind it are overrun. */
  navy = NAVY_START;
  gold: number;
  readonly difficulty: Difficulty;
  condition: ShipCondition;
  status: RunStatus = 'chart';
  encounter: Encounter = { kind: 'start' };
  jumps = 0;
  visited: number[] = [0];
  battlesWon = 0;
  plunderTaken = 0;
  /** Why the run ended, once it has. */
  ending = '';
  /** Title for an unusual ending (set by events); empty for the usual ones. */
  endingTitle = '';
  /** Story flags set by events, for events that follow on from them. */
  flags = new Set<string>();
  /** Events met this voyage, in order. */
  seenEvents: string[] = [];
  /** Events met in this player's last few voyages: drawn less often, so tales stay fresh. */
  recent: string[] = [];
  /** Where the wind blows from, as an angle on the chart (0 from the east, a quarter turn from the south). */
  wind = Math.PI;
  /** Spoils of the last battle, until you sail on. */
  prize: Prize | null = null;
  /** Which stretch of the voyage you are in (0-based). */
  sector = 0;
  /** Food and water; a jump eats one. */
  provisions: number;
  /** Chandler's fittings aboard. */
  fittings: string[] = [];
  /** How each power regards you. */
  standing: Standing = freshStanding();
  /** A friendly ship sailing in company for the next fight. */
  escort: Escort | null = null;
  /** Work taken on for a power, until done. */
  commission: Commission | null = null;
  /** What the last jump cost you on short rations, for the chart to report (not saved). */
  hungerNote = '';
  private usedNames = new Set<string>();

  constructor(shipId: string, seed?: number, difficulty: Difficulty = 'normal') {
    this.difficulty = difficulty;
    this.gold = DIFFICULTY[difficulty].startGold;
    this.provisions = DIFFICULTY[difficulty].provisions;
    this.seed = seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = new Rng(this.seed);
    this.def = playerShip(shipId);
    this.condition = new Ship(this.def, 'player').condition();
    for (const c of this.condition.crew) this.usedNames.add(c.name);
    this.fit = { hull: this.def.hull, hands: this.def.hands, systems: { ...this.def.systems }, guns: this.def.guns.map((g) => ({ ...g })) };
    this.chart = this.makeChart(0);
    this.wind = this.rng.next() * 2 * Math.PI;
  }

  /** How a leg between two marks lies to the wind. */
  pointOfSail(from: SeaNode, to: SeaNode): PointOfSail {
    const heading = Math.atan2((to.y - from.y) * CHART_ASPECT, to.col - from.col);
    const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    if (off(heading, this.wind) < Math.PI / 3) return 'foul';
    if (off(heading, this.wind + Math.PI) < Math.PI / 3) return 'fair';
    return 'beam';
  }

  /** The wind in words: "from the north-east". */
  get windName(): string {
    const i = Math.round(this.wind / (Math.PI / 4));
    return `from the ${COMPASS[((i % 8) + 8) % 8]}`;
  }

  /**
   * The chart for one stage of the voyage: its sector's own enemies, ending at the passages into the next stage
   * (one per sector you could sail on to) or, last of all, at the blockade.
   */
  private makeChart(sector: number, id = SECTOR_ROUTE[sector][0]): SeaChart {
    const def = sectorDef(id);
    const stages = SECTOR_ROUTE.length;
    const onward = SECTOR_ROUTE[sector + 1] ?? [];
    return generateChart(this.rng, {
      depth: [sector / stages, (sector + 1) / stages],
      columns: SECTOR_COLUMNS,
      ports: PORT_NAMES,
      armoury: ARMOURY,
      final: sector === stages - 1,
      startName: sector === 0 ? 'Tortuga' : def.name,
      exits: onward.map((to) => ({ name: sectorDef(to).name, to })),
      enemies: def.enemies,
    });
  }

  /** Which sector the voyage is in now (at a fork, the one you chose). */
  sectorId = SECTOR_ROUTE[0][0];

  get sectorDef() {
    return sectorDef(this.sectorId);
  }

  /** Legs sailed over the whole voyage, and how many there are in all. */
  get legs(): { sailed: number; total: number } {
    if (this.chart.columns !== SECTOR_COLUMNS) return { sailed: this.node.col, total: this.chart.columns - 1 };
    const per = SECTOR_COLUMNS - 1;
    return { sailed: this.sector * per + this.node.col, total: SECTOR_ROUTE.length * per };
  }

  /** Progress through the voyage on the old single-chart scale (0..7), which event conditions are written against. */
  get progressCol(): number {
    const { sailed, total } = this.legs;
    return Math.round((sailed * 7) / total);
  }

  get maxProvisions(): number {
    return this.has('casks') ? CASK_PROVISIONS : MAX_PROVISIONS;
  }

  has(fittingId: string): boolean {
    return this.fittings.includes(fittingId);
  }

  /**
   * Columns the fleet advances per jump: set by difficulty, slowed when the Crown is friendly (admirals look
   * the other way) and by each of Spain and France that counts you an ally (their squadrons draw it off).
   */
  get navySpeed(): number {
    let v = DIFFICULTY[this.difficulty].navySpeed;
    if (atLeast(this.tier('crown'), 'friendly')) v -= 0.1;
    for (const p of ['spain', 'france'] as PowerId[]) if (this.tier(p) === 'allied') v -= 0.1;
    return v;
  }

  // --- Standing ----------------------------------------------------------------

  tier(p: PowerId) {
    return tierOf(this.standing[p]);
  }

  /** Change a power's opinion (and with `ripple`, its friends' and enemies'), and say what changed. */
  shift(p: PowerId, amount: number, ripple: boolean): string[] {
    const before = { ...this.standing };
    return describeShift(before, shiftStanding(this.standing, p, amount, ripple));
  }

  /** The ship as currently fitted out. */
  get ship(): ShipDef {
    const f = this.fit;
    const speedBonus = this.def.speedBonus + (this.has('careened') ? 5 : 0) + (this.has('copper') ? 5 : 0);
    const melee = (this.def.melee ?? 1) * (this.has('marines') ? 1.25 : 1);
    return { ...this.def, hull: f.hull, hands: f.hands, speedBonus, melee, systems: { ...f.systems }, guns: f.guns.map((g) => ({ ...g })) };
  }

  get node(): SeaNode {
    return nodeById(this.chart, this.nodeId);
  }

  get over(): boolean {
    return this.status === 'won' || this.status === 'lost';
  }

  get maxCrew(): number {
    return this.def.crew.length + EXTRA_CREW;
  }

  /** Nodes you can sail to next: onward, or across to an unvisited neighbour in the same column (exploring costs a jump). */
  reachable(): SeaNode[] {
    if (this.status !== 'chart') return [];
    const here = this.node;
    const out = here.next.map((id) => nodeById(this.chart, id));
    if (here.col > 0 && here.kind !== 'exit' && here.kind !== 'boss') {
      const column = this.chart.nodes.filter((n) => n.col === here.col).sort((a, b) => a.y - b.y);
      const i = column.indexOf(here);
      for (const n of [column[i - 1], column[i + 1]]) if (n && !this.visited.includes(n.id)) out.push(n);
    }
    return out;
  }

  /** Whether a reachable node is across in the same column rather than onward. */
  isLateral(node: SeaNode): boolean {
    return node.col === this.node.col;
  }

  /** True if the fleet will have overrun this node by the time you get there. */
  willBeOverrun(node: SeaNode): boolean {
    return node.kind !== 'boss' && node.kind !== 'exit' && node.col <= this.navy + this.navySpeed;
  }

  /** Sail to a neighbouring node. The crew make running repairs and the fleet advances. */
  jump(id: number): Encounter {
    const node = this.reachable().find((n) => n.id === id);
    if (!node) throw new Error(`Cannot sail to node ${id} from ${this.nodeId}`);
    const overrun = this.willBeOverrun(node);
    const sail = this.pointOfSail(this.node, node);
    this.nodeId = id;
    this.jumps++;
    this.visited.push(id);
    this.prize = null;
    // Hungry crews do not mend: eat first, and heal only on a full belly. Beating into a foul wind costs a second day.
    let fed = this.eat();
    const hunger = this.hungerNote;
    if (sail === 'foul') fed = this.eat() && fed;
    this.runningRepairs(fed);
    this.navy += this.navySpeed + (sail === 'foul' ? FOUL_FLEET : sail === 'fair' ? -FAIR_FLEET : 0);
    const windNote = sail === 'foul' ? 'A foul wind: a day lost beating to windward, and a day’s provisions with it.' : '';
    this.hungerNote = [windNote, hunger, this.hungerNote].filter((x, i, all) => x && all.indexOf(x) === i).join(' ');
    this.wind += (this.rng.next() - 0.5) * WIND_SHIFT;

    if (node.kind === 'exit') return this.enterSector(this.sector + 1, node.to);
    if (node.kind === 'boss') {
      const foe = enemy(node.enemy ?? 'frigate');
      const aid = this.tier('brethren') === 'allied' ? ' But the Brethren have kept faith: a swarm of pirate sloops comes down on her flanks, and her hull is already holed when you come in range.' : '';
      // A friend of the Crown may be offered terms before the first gun.
      const intent: Intent | undefined = atLeast(this.tier('crown'), 'friendly') ? 'commodore' : undefined;
      return this.begin({ kind: 'battle', enemy: foe.id, name: this.shipName(foe), boss: true, ambush: false, text: foe.sighting + aid, intent });
    }
    if (overrun) {
      const foe = enemy(this.sectorDef.ambush);
      const text = `The fleet has overrun these waters. A ${foe.ship.className.toLowerCase()} of the vanguard bears down on you!`;
      return this.begin({ kind: 'battle', enemy: foe.id, name: this.shipName(foe), boss: false, ambush: true, text });
    }
    switch (node.kind) {
      case 'battle': {
        const foe = enemy(node.enemy ?? 'cutter');
        const text = this.rng.pick([foe.sighting, ...(foe.sightings ?? [])]);
        return this.begin({ kind: 'battle', enemy: foe.id, name: this.shipName(foe), boss: false, ambush: false, text, intent: this.intentOf(foe) });
      }
      case 'event': {
        // A lead marked on the chart, if its tale can still be told; otherwise whatever the sea brings.
        const lead = node.story ? seaEvent(node.story) : null;
        if (lead && this.unmet(lead.needs) === null && !this.seenEvents.includes(lead.id)) return this.startEvent(lead);
        const ev = this.drawEvent('encounter') ?? this.drawEvent('incident');
        if (ev) return this.startEvent(ev);
        break;
      }
      case 'port':
        return this.enterPort(node.name ?? 'Nassau', [...(node.stock ?? [])]);
    }
    // Open sea: often something happens aboard on the way.
    const incident = this.rng.chance(INCIDENT_CHANCE) ? this.drawEvent('incident') : null;
    if (incident) return this.startEvent(incident);
    if (this.rng.chance(FORAGE_CHANCE + (this.hasTrait('cook') ? COOK_FORAGE : 0)) && this.provisions < this.maxProvisions) {
      this.provisions++;
      return this.begin({ kind: 'empty', text: this.rng.pick(FORAGE_LINES) });
    }
    return this.begin({ kind: 'empty', text: this.rng.pick(QUIET_LINES) });
  }

  /** A jump eats a day's provisions. With none left the crew go hungry, and someone may jump ship. Returns whether they ate. */
  private eat(): boolean {
    this.hungerNote = '';
    if (this.provisions > 0) {
      this.provisions--;
      return true;
    }
    const c = this.condition;
    for (const m of c.crew) m.hp = Math.max(1, m.hp - STARVE_HP);
    const notes = [`Short rations: the crew go hungry (−${STARVE_HP} HP each).`];
    if (c.crew.length > 1 && this.rng.chance(DESERT_CHANCE)) {
      const gone = c.crew.splice(this.rng.int(c.crew.length), 1)[0];
      notes.push(`${gone.name} slips over the side in the night.`);
    }
    this.hungerNote = notes.join(' ');
    return false;
  }

  /**
   * Sail through a passage into the next sector: a fresh chart, and the fleet loses some of your trail.
   * A straight run across a sector gives away (columns - 1) x (fleet speed - 1); whatever else it gained on you,
   * it keeps SECTOR_CARRY of.
   */
  private enterSector(sector: number, id = SECTOR_ROUTE[sector][0]): Encounter {
    const fresh = -NAVY_START;
    const gap = this.node.col - this.navy;
    const straight = (this.chart.columns - 1) * Math.max(0, this.navySpeed - 1);
    const lost = Math.max(0, fresh - gap - straight);
    this.sector = sector;
    this.sectorId = id;
    this.chart = this.makeChart(sector, id);
    this.nodeId = 0;
    this.visited = [0];
    this.navy = NAVY_START + SECTOR_CARRY * lost;
    this.wind = this.rng.next() * 2 * Math.PI;
    this.placeLeads();
    const def = this.sectorDef;
    const fleet = lost >= 1 ? 'The fleet is hard on your heels: its topsails were in sight as you cleared the passage.' : 'The fleet has lost your trail for now. It will find it again.';
    return this.begin({ kind: 'empty', title: def.name, text: `You slip through into ${def.name}. ${def.blurb} ${fleet}` });
  }

  /** Shipwright, chandler and armoury prices in this sector, and in this harbour by how its masters regard you. */
  price(base: number): number {
    return Math.round(base * (1 + SECTOR_PRICE * this.sector) * this.portRate);
  }

  /** What the port you are in is known for (null at sea). */
  get speciality(): PortSpeciality | null {
    return this.encounter.kind === 'port' ? (PORT_SPECIALITY[this.encounter.name] ?? null) : null;
  }

  /** What a hand costs to sign on here. */
  get crewPrice(): number {
    return this.speciality === 'crew' ? Math.round(CREW_PRICE * 2 / 3) : CREW_PRICE;
  }

  /** What a day's provisions cost here. */
  get provisionPrice(): number {
    return this.speciality === 'chandler' ? PROVISION_PRICE - 1 : PROVISION_PRICE;
  }

  /** Who holds the port you are in (null at sea). */
  get portPower(): PowerId | null {
    return this.encounter.kind === 'port' ? portPower(this.encounter.name) : null;
  }

  /** Price multiplier in this harbour. */
  get portRate(): number {
    const p = this.portPower;
    return p ? PORT_PRICE[this.tier(p)] : 1;
  }

  /** A name for the ship you meet: one you have not fought before, if it can be helped. */
  private shipName(foe: EnemyDef): string {
    const fresh = foe.names.filter((n) => !this.usedNames.has(n));
    const name = this.rng.pick(fresh.length ? fresh : foe.names);
    this.usedNames.add(name);
    return name;
  }

  private begin(enc: Encounter): Encounter {
    this.encounter = enc;
    // A ship that was sighted rather than sprung on you is hailed first.
    this.status = enc.kind === 'battle' ? (enc.intent ? 'hail' : 'battle') : enc.kind === 'event' ? 'event' : enc.kind === 'port' ? 'port' : 'chart';
    return enc;
  }

  // --- Hailing a sighted ship ------------------------------------------------------

  /** Whether she means to fight: by how her flag regards you, and merchants never pick a fight. */
  private intentOf(foe: EnemyDef): Intent {
    const tier = this.tier(foe.power);
    if (atLeast(tier, 'friendly')) return 'friendly';
    if (foe.ai.fleeAt >= 1) return 'wary';
    if (tier === 'wary') return this.rng.chance(0.5) ? 'hostile' : 'wary';
    return 'hostile';
  }

  /** The ship being hailed, and how she greeted you. */
  private get hailing(): { foe: EnemyDef; intent: Intent; name: string } {
    if (this.status !== 'hail' || this.encounter.kind !== 'battle' || !this.encounter.intent) throw new Error('No ship to hail');
    return { foe: enemy(this.encounter.enemy), intent: this.encounter.intent, name: this.encounter.name };
  }

  /** How she answers your colours, in a line. */
  hailText(): string {
    const { foe, intent } = this.hailing;
    const flag = power(foe.power);
    switch (intent) {
      case 'hostile':
        return this.tier(foe.power) === 'wary'
          ? `She flies the colours of ${flag.short}. Her captain does not like the look of you, and her guns are run out.`
          : `She flies the colours of ${flag.short}, and ${flag.short} wants you taken. Her guns are run out.`;
      case 'wary':
        return foe.ai.fleeAt >= 1 ? 'She has seen your flag and is crowding on sail to get clear.' : `She flies the colours of ${flag.short} and holds her course, watching you. She will not start a fight.`;
      case 'friendly':
        return `She flies the colours of ${flag.short} and dips her ensign to you: a friend.`;
      case 'commodore':
        return 'A boat puts off from the flagship under a flag of truce. The Commodore has heard you are no enemy of the King, and offers terms.';
    }
  }

  /** Odds a false flag fools her (better with a locker of every nation's flags). */
  coloursChance(): number {
    return this.has('flags') ? 0.7 : FALSE_COLOURS_CHANCE;
  }

  /** What a bribe to let you pass costs. */
  bribePrice(): number {
    const { foe } = this.hailing;
    return Math.round((20 + 15 * this.sector) * (this.tier(foe.power) === 'hostile' ? 1.5 : 1));
  }

  /** Odds that a captain who meant to fight hears you out instead. */
  parleyChance(): number {
    return Math.max(0.05, Math.min(0.85, 0.4 + this.standing[this.hailing.foe.power] / 150));
  }

  /** Odds she pays toll rather than fight: your guns against hers, and how her flag regards you. */
  tributeChance(): number {
    const { foe } = this.hailing;
    const mine = this.fit.guns.length;
    const hers = foe.ship.guns.length;
    return Math.max(0.15, Math.min(0.85, 0.35 + 0.1 * (mine - hers) + this.standing[foe.power] / 200 + (this.has('figurehead') ? 0.15 : 0)));
  }

  /** Gold a ship pays as toll: half what her hold would give up after a fight. */
  tributeGold(): number {
    const { foe } = this.hailing;
    return Math.round(((foe.plunder[0] + foe.plunder[1]) / 4) * PLUNDER_MULT * (1 + SECTOR_PLUNDER * this.sector));
  }

  /** What you can say to her. */
  hailOptions(): HailOption[] {
    const { foe, intent } = this.hailing;
    const tier = this.tier(foe.power);
    const flag = power(foe.power);
    const out: HailOption[] = [];
    const add = (o: Omit<HailOption, 'available'>) => out.push({ ...o, available: !o.blocker });
    if (intent === 'commodore') {
      add({ id: 'pardon', label: 'Accept the King’s pardon', detail: 'Strike your colours, swear the oath and go home free. The voyage ends.', fight: 'no' });
      add({ id: 'attack', label: 'Refuse, and fight', detail: 'Break the blockade the hard way.', fight: 'yes' });
      return out;
    }
    if (intent === 'hostile') {
      add({ id: 'attack', label: 'Run out the guns', detail: 'Fight her.', fight: 'yes' });
      add({ id: 'parley', label: 'Hail her and parley', detail: 'Talk her out of it. If she will not listen, she fights.', chance: this.parleyChance(), fight: 'maybe', blocker: tier === 'feud' ? `${flag.name} will not parley` : undefined });
      const cost = this.bribePrice();
      add({ id: 'bribe', label: 'Buy her off', detail: 'Gold for her captain to look the other way.', cost, fight: 'no', blocker: tier === 'feud' ? 'blood cannot be bought off' : this.gold < cost ? `needs ${cost} gold` : undefined });
      add({ id: 'colours', label: 'Run up false colours', detail: `Pass as a friend. If she sees through it she fights, and ${flag.short} remembers.`, chance: this.coloursChance(), fight: 'maybe' });
    } else if (intent === 'wary') {
      add({ id: 'attack', label: 'Attack her', detail: foe.ai.fleeAt >= 1 ? 'Run her down before she gets away.' : `She would have let you be: ${flag.short} will not forget it.`, fight: 'yes' });
      add({ id: 'tribute', label: 'Demand toll', detail: 'Fire a gun across her bow and ask for gold. If she refuses, you fight.', chance: this.tributeChance(), fight: 'maybe' });
      add({ id: 'pass', label: 'Let her go by', detail: `${flag.name} will hear you kept the peace.`, fight: 'no' });
    } else {
      add({ id: 'news', label: 'Exchange news', detail: 'Her captain has seen the fleet and knows where it is searching.', fight: 'no' });
      const full = this.provisions + HAIL_TRADE_PROVISIONS > this.maxProvisions;
      add({ id: 'trade', label: 'Buy from her stores', detail: `${HAIL_TRADE_PROVISIONS} provisions from her spare stores.`, cost: HAIL_TRADE_PRICE, fight: 'no', blocker: full ? 'hold is full' : this.gold < HAIL_TRADE_PRICE ? `needs ${HAIL_TRADE_PRICE} gold` : undefined });
      add({ id: 'escort', label: 'Ask her to sail in company', detail: 'She fights beside you in your next battle.', fight: 'no', blocker: tier !== 'allied' ? 'only an ally will' : this.escort ? `${this.escort.name} already sails with you` : undefined });
      add({ id: 'pass', label: 'Dip your colours and sail on', detail: 'Fair winds.', fight: 'no' });
      add({ id: 'attack', label: 'Betray her', detail: 'Every flag at sea will hear of it.', fight: 'yes' });
    }
    return out;
  }

  /** Answer her: talk, pay, trick, threaten, or fight. */
  hail(id: HailId): HailResult {
    const { foe, intent, name } = this.hailing;
    const option = this.hailOptions().find((o) => o.id === id);
    if (!option?.available) throw new Error(`Cannot ${id} now`);
    const p = foe.power;
    const enc = this.encounter as Extract<Encounter, { kind: 'battle' }>;
    const fight = (text: string, changes: string[] = [], aggressor = false): HailResult => {
      enc.aggressor = aggressor;
      enc.betrayal = aggressor && intent === 'friendly';
      this.status = 'battle';
      return { text, changes, fight: true };
    };
    const pass = (text: string, changes: string[] = []): HailResult => {
      this.status = 'chart';
      return { text, changes, fight: false };
    };
    switch (id) {
      case 'pardon':
        this.end('won', 'You accepted the King’s pardon under the guns of the blockade, and sailed home free.', 'The King’s Pardon');
        return { text: 'You strike your colours to the Commodore and swear the oath. The blockade parts to let you through.', changes: [], fight: false };
      case 'attack':
        if (intent === 'hostile' || intent === 'commodore') return fight('You run out the guns.');
        return fight(intent === 'friendly' ? `You run out the guns on ${name} while her people are still waving.` : 'You run out the guns and bear down on her.', [], true);
      case 'parley':
        if (this.rng.chance(this.parleyChance())) return pass(`Her captain hears you out over a glass of wine, and ${name} bears away.`, this.shift(p, 3, false));
        return fight('Her captain has no time for pirates. Her first gun answers you.');
      case 'bribe': {
        const cost = this.bribePrice();
        this.gold -= cost;
        return pass(`Her captain pockets ${cost} gold and finds something interesting on the far horizon.`, [`−${cost} gold`, ...this.shift(p, 2, false)]);
      }
      case 'colours':
        if (this.rng.chance(this.coloursChance())) return pass('You run up a friendly ensign and exchange the right signals. She takes you for one of her own and sails on.');
        return fight('Her captain is not fooled. She runs out her guns, and her flag will remember the trick.', this.shift(p, -FALSE_COLOURS_PENALTY, false));
      case 'tribute': {
        if (this.rng.chance(this.tributeChance())) {
          const gold = this.tributeGold();
          this.gold += gold;
          this.plunderTaken += gold;
          return pass(`She heaves to and sends over a boat with ${gold} gold. Cheaper than a fight, her master says.`, [`+${gold} gold`, ...this.shift(p, -4, true)]);
        }
        return fight('She answers your gun with her own. So be it.', [], true);
      }
      case 'pass':
        return pass(intent === 'friendly' ? 'Fair winds, and she is gone.' : `You let ${name} go about her business.`, this.shift(p, 2, false));
      case 'news':
        this.navy -= NEWS_SETBACK;
        return pass('Her captain marks the fleet’s search on your chart. You can keep clear of it.', ['You gain on the Navy', ...this.shift(p, 1, false)]);
      case 'trade':
        this.gold -= HAIL_TRADE_PRICE;
        this.provisions += HAIL_TRADE_PROVISIONS;
        return pass('Casks and biscuit come across in her boat.', [`−${HAIL_TRADE_PRICE} gold`, `+${HAIL_TRADE_PROVISIONS} provisions`]);
      case 'escort':
        this.escort = { name, power: p };
        return pass(`${name} falls in astern. Her captain will stand by you in the next fight.`);
    }
  }

  /** Between nodes: wounds mend a little (not on empty stores) and the carpenter fixes the worst-damaged system by one point (two with spare spars). */
  private runningRepairs(heal: boolean): void {
    const surgeons = this.condition.crew.filter((c) => c.trait === 'surgeon').length;
    const hp = !heal ? 0 : (this.has('chest') ? 2 * JUMP_HEAL : JUMP_HEAL) + surgeons * SURGEON_TRAIT_HEAL;
    for (const c of this.condition.crew) c.hp = Math.min(100, c.hp + hp);
    for (let i = this.has('spars') ? 2 : 1; i > 0; i--) {
      const worst = (Object.entries(this.condition.damage) as [SystemId, number][]).sort((a, b) => b[1] - a[1])[0];
      if (worst) this.setDamage(worst[0], worst[1] - 1);
    }
  }

  private setDamage(id: SystemId, amount: number): void {
    if (amount > 0) this.condition.damage[id] = amount;
    else delete this.condition.damage[id];
  }

  // --- Battles ------------------------------------------------------------

  currentEnemy(): EnemyDef {
    if (this.encounter.kind !== 'battle') throw new Error('No battle in progress');
    return enemy(this.encounter.enemy);
  }

  /** Build the fight for the current battle encounter. */
  startBattle(opts: Partial<BattleOptions> = {}): Battle {
    const setup = this.battleSetup(opts);
    return new Battle(setup.player, setup.enemy, setup.options);
  }

  /** The ships and options for the current battle encounter, as plain data (a co-op server sends it to its players). */
  battleSetup(opts: Partial<BattleOptions> = {}): BattleSetup {
    if (this.status !== 'battle' || this.encounter.kind !== 'battle') throw new Error('No battle to start');
    const foe = this.currentEnemy();
    // Deeper sectors field better-found ships; the blockade frigate has her own fit.
    const ship = scaleEnemy(foe.ship, this.encounter.boss ? BOSS_TIER : this.sector);
    const hull = Math.round(ship.hull * DIFFICULTY[this.difficulty].enemyHull);
    // The Brethren's sloops have already been at the blockade frigate.
    const aided = this.encounter.boss && this.tier('brethren') === 'allied';
    return {
      player: this.ship,
      enemy: { ...ship, name: this.encounter.name, hull },
      options: {
        enemyHull: aided ? Math.round(hull * (1 - BRETHREN_AID)) : undefined,
        consort: this.escort ? { name: this.escort.name, every: CONSORT_EVERY, damage: CONSORT_DAMAGE } : undefined,
        seed: this.rng.int(2 ** 31),
        // A fearsome figurehead makes a wavering captain strike sooner.
        enemyAI: this.has('figurehead') && foe.ai.surrenderChance > 0 ? { ...foe.ai, surrenderChance: Math.min(1, foe.ai.surrenderChance + 0.1) } : foe.ai,
        playerCondition: this.condition,
        allowEscape: !this.encounter.boss,
        boss: this.encounter.boss,
        enemyReload: DIFFICULTY[this.difficulty].enemyReload,
        playerReload: this.has('drill') ? 1.1 : 1,
        playerNets: this.has('nets'),
        playerShotRate: this.has('lockers') ? { chain: 1.2, grape: 1.2 } : undefined,
        playerPumps: this.has('pumps') ? 1.5 : undefined,
        ...opts,
      },
    };
  }

  /** Record a finished battle: damage carried, plunder taken, the fleet's reaction. */
  finishBattle(battle: Battle): BattleReport {
    if (this.encounter.kind !== 'battle') throw new Error('No battle in progress');
    const o = battle.outcome;
    if (!o) throw new Error('Battle has not finished');
    const enc = this.encounter;
    const foe = enemy(enc.enemy);
    this.condition = battle.player.condition();
    const lines: string[] = [];
    let plunder = 0;

    if (o.won) {
      this.battlesWon++;
      const share = PLUNDER_SHARE[o.kind] ?? 0;
      const base = foe.plunder[0] + this.rng.int(foe.plunder[1] - foe.plunder[0] + 1);
      plunder = Math.round(base * share * PLUNDER_MULT * (1 + SECTOR_PLUNDER * this.sector));
      if (!enc.boss && plunder > 0) {
        this.gold += plunder;
        this.plunderTaken += plunder;
        lines.push(o.kind === 'enemySunk' || o.kind === 'victory' ? `You fish ${plunder} gold from the wreckage.` : `Her hold yields ${plunder} gold.`);
      }
      if (!enc.boss) {
        const food = Math.min(this.maxProvisions - this.provisions, 1 + this.rng.int(3) + (foe.faction === 'merchant' ? 2 : 0));
        if (food > 0) {
          this.provisions += food;
          lines.push(`+${food} provisions from her stores.`);
        }
      }
      if (enc.ambush) {
        this.navy -= AMBUSH_SETBACK;
        lines.push('With her vanguard sunk, the fleet falls back to regroup.');
      }
    } else if (o.kind === 'enemyEscaped' && foe.faction !== 'navy') {
      this.navy += ALARM_DELAY;
      lines.push('She will raise the alarm. The fleet closes in.');
    }

    if (!enc.boss) {
      // Her flag remembers how you treated her, and its friends and enemies hear of it.
      const d = (OUTCOME_STANDING[o.kind] ?? 0) - (enc.aggressor ? (enc.betrayal ? BETRAYAL : AGGRESSION) : 0);
      if (d) lines.push(...this.shift(foe.power, d, true));
      const job = this.commission;
      if (o.won && job?.kind === 'hunt' && job.target === foe.power) lines.push(...this.fulfil(job));
    }
    if (this.escort) {
      lines.push(`${this.escort.name} dips her ensign and parts company.`);
      this.escort = null;
    }

    if (o.kind === 'defeat' || o.kind === 'sunk' || o.kind === 'crewLost') {
      this.end('lost', o.text);
    } else if (enc.boss && o.won) {
      this.end('won', 'You broke the blockade!');
    } else {
      this.status = 'chart';
    }
    if (!enc.boss && (o.kind === 'captured' || o.kind === 'surrender')) {
      // The guns she actually fought with, as found for this sector.
      const guns = scaleEnemy(foe.ship, this.sector).guns.map((g) => g.weapon);
      this.prize = { guns: [...new Set(guns)], recruits: o.kind === 'surrender' ? 1 : 0, taken: false };
    }
    return { kind: o.kind, won: o.won, plunder: enc.boss ? 0 : plunder, lines };
  }

  /** Take one of the beaten ship's guns: into a free gun port, or sold for scrap. Returns what happened. */
  takePrizeGun(weaponId: string): string | null {
    if (!this.prize || this.prize.taken || !this.prize.guns.includes(weaponId)) return null;
    this.prize.taken = true;
    const w = weapon(weaponId);
    if (this.fit.guns.length < MAX_GUNS) {
      this.fit.guns.push({ weapon: weaponId });
      return `Her ${w.name} is swayed across and mounted.`;
    }
    const scrap = Math.floor(w.price / 2);
    this.gold += scrap;
    return `No free gun port: her ${w.name} fetches ${scrap} gold.`;
  }

  /** Sign on one of the surrendered crew. Returns the new hand's name. */
  pressPrizeCrew(): string | null {
    if (!this.prize || this.prize.taken || this.prize.recruits <= 0) return null;
    const name = this.recruit();
    if (name) this.prize.taken = true;
    return name;
  }

  /** Give up the voyage (used by headless runs for stalemates). */
  concede(reason: string): void {
    this.end('lost', reason);
  }

  private end(status: 'won' | 'lost', reason: string, title = ''): void {
    this.status = status;
    this.ending = reason;
    this.endingTitle = title;
  }

  // --- Events ---------------------------------------------------------------

  /**
   * Pick an event that fits the voyage right now: right pool, conditions met, not already seen this voyage
   * if anything fresh is left, and never a unique one twice. Rarer events are drawn less often.
   */
  drawEvent(pool: EventPool): SeaEventDef | null {
    const ok = SEA_EVENTS.filter(
      (e) => (e.pool ?? 'encounter') === pool && this.unmet(e.needs) === null && !(e.unique && this.seenEvents.includes(e.id)),
    );
    const fresh = ok.filter((e) => !this.seenEvents.includes(e.id));
    const list = fresh.length ? fresh : ok;
    if (!list.length) return null;
    // Follow-ups to the voyage's own story come round more readily.
    return this.rng.weighted(list, (e) => RARITY_WEIGHT[e.rarity ?? 'common'] * (e.needs?.flag ? STORY_BOOST : 1) * (this.recent.includes(e.id) ? RECENT_WEIGHT : 1));
  }

  /**
   * Mark the chart with the leads the voyage's story has opened (a half map, a debt owed, a letter of marque): each
   * follow-up waits at an event or open-sea mark ahead, far enough on for any depth it needs. A lead that does not
   * fit on this chart waits for the next sector's.
   */
  placeLeads(): void {
    const placed = new Set(this.chart.nodes.map((n) => n.story).filter(Boolean));
    const leads = SEA_EVENTS.filter(
      (e) =>
        (e.pool ?? 'encounter') === 'encounter' &&
        !!e.needs?.flag &&
        this.flags.has(e.needs.flag) &&
        !(e.needs.noFlag && this.flags.has(e.needs.noFlag)) &&
        !this.seenEvents.includes(e.id) &&
        !placed.has(e.id),
    );
    for (const ev of leads) {
      const spots = this.chart.nodes.filter((n) => n.col > this.node.col && (n.kind === 'event' || n.kind === 'empty') && !n.story && this.progressAt(n.col) >= (ev.needs?.minCol ?? 0));
      if (!spots.length) continue;
      const spot = this.rng.pick(spots);
      spot.kind = 'event';
      spot.story = ev.id;
    }
  }

  /** Voyage progress on the 0..7 scale (see progressCol) at a column of this chart. */
  private progressAt(col: number): number {
    if (this.chart.columns !== SECTOR_COLUMNS) return col;
    const per = SECTOR_COLUMNS - 1;
    return Math.round(((this.sector * per + col) * 7) / (SECTOR_ROUTE.length * per));
  }

  /** Begin an event, casting two crew members as {crew} and {crew2}. */
  startEvent(def: SeaEventDef, actors?: { actor?: string; actor2?: string }): Encounter {
    const names = this.condition.crew.map((m) => m.name);
    const actor = actors?.actor && names.includes(actors.actor) ? actors.actor : this.rng.pick(names);
    const others = names.filter((n) => n !== actor);
    const actor2 = actors?.actor2 && others.includes(actors.actor2) ? actors.actor2 : others.length ? this.rng.pick(others) : undefined;
    if (!this.seenEvents.includes(def.id)) this.seenEvents.push(def.id);
    const variant = def.variants?.length ? this.rng.int(def.variants.length + 1) : 0;
    return this.begin({ kind: 'event', event: def.id, actor, actor2, variant });
  }

  currentEvent(): SeaEventDef {
    if (this.encounter.kind !== 'event') throw new Error('No event in progress');
    return seaEvent(this.encounter.event);
  }

  /** The current event's opening text, in whichever telling was picked, with names filled in. */
  eventText(): string {
    const def = this.currentEvent();
    const v = this.encounter.kind === 'event' ? (this.encounter.variant ?? 0) : 0;
    return this.fill(v > 0 && def.variants?.[v - 1] ? def.variants[v - 1] : def.text);
  }

  /** Fill in {crew}, {crew2} and {ship} for the current event. */
  fill(text: string): string {
    const enc = this.encounter.kind === 'event' ? this.encounter : null;
    return text
      .replaceAll('{crew}', enc?.actor ?? 'a sailor')
      .replaceAll('{crew2}', enc?.actor2 ?? 'another sailor')
      .replaceAll('{ship}', this.def.name);
  }

  /** Why a set of conditions is not met, in a few words, or null if it is. */
  unmet(n: EventNeeds | undefined): string | null {
    if (!n) return null;
    const c = this.condition;
    const col = this.progressCol;
    if (n.crew && c.crew.length < n.crew) return `needs ${n.crew} crew`;
    if (n.gold && this.gold < n.gold) return `needs ${n.gold} gold`;
    if (n.hurt && !c.crew.some((m) => m.hp < 70)) return 'nobody is hurt';
    if (n.damaged && !Object.keys(c.damage).length) return 'nothing is damaged';
    if (n.battered && c.hull >= this.fit.hull / 2) return 'hull is sound';
    if (n.flag && !this.flags.has(n.flag)) return FLAG_LACKING[n.flag] ?? 'you lack something';
    if (n.noFlag && this.flags.has(n.noFlag)) return 'already done';
    if (n.gunPort && this.fit.guns.length >= MAX_GUNS) return 'no free gun port';
    if (n.provisions && this.provisions < n.provisions) return `needs ${n.provisions} provisions`;
    if (n.minSector !== undefined && this.sector < n.minSector) return 'too early';
    if (n.minCol !== undefined && col < n.minCol) return 'too early';
    if (n.maxCol !== undefined && col > n.maxCol) return 'too late';
    if (n.fitting && !this.has(n.fitting)) return `needs ${fitting(n.fitting).name}`;
    if (n.trait && !this.hasTrait(n.trait)) return `needs a ${trait(n.trait).name} aboard`;
    if (n.ship && !n.ship.includes(this.def.id)) return 'not aboard this ship';
    for (const [s, r] of Object.entries(n.skill ?? {}) as [Skill, number][]) {
      if (!c.crew.some((m) => skillRank(m.xp, s) >= r)) return `needs ${r >= 2 ? 'an Expert' : 'a Veteran'} ${SKILL_LABEL[s]}`;
    }
    if (n.gun && !this.fit.guns.some((g) => n.gun!.includes(g.weapon))) return `needs a ${weapon(n.gun[0]).name}`;
    for (const [p, v] of Object.entries(n.standing ?? {}) as [PowerId, number | { max: number }][]) {
      if (typeof v === 'number' && this.standing[p] < v) return `${power(p).name} must think better of you`;
      if (typeof v === 'object' && this.standing[p] > v.max) return `${power(p).name} like you too well`;
    }
    return null;
  }

  /** Why a choice cannot be taken, or null if it can. */
  choiceBlocker(index: number): string | null {
    const choice = this.currentEvent().choices[index];
    if (!choice) return 'no such choice';
    if (this.gold < (choice.cost ?? 0)) return `needs ${choice.cost} gold`;
    return this.unmet(choice.needs);
  }

  canChoose(index: number): boolean {
    return this.choiceBlocker(index) === null;
  }

  chooseEvent(index: number): EventResult {
    if (this.status !== 'event' || this.encounter.kind !== 'event') throw new Error('No event in progress');
    if (!this.canChoose(index)) throw new Error(`Choice ${index} is not available`);
    const { actor, actor2 } = this.encounter;
    const choice = this.currentEvent().choices[index];
    this.gold -= choice.cost ?? 0;
    const picked = this.rng.weighted(choice.outcomes, (o) => o.weight).effect;
    const effect = { ...picked, text: this.fill(picked.text) };
    const changes = this.applyEffect(picked);
    if (choice.cost) changes.unshift(`−${choice.cost} gold`);
    if (picked.ending) {
      this.end('won', effect.text, picked.ending);
    } else if (picked.battle) {
      const foe = enemy(picked.battle);
      this.begin({ kind: 'battle', enemy: foe.id, name: this.shipName(foe), boss: false, ambush: false, text: effect.text });
    } else if (picked.next) {
      this.startEvent(seaEvent(picked.next), { actor, actor2 });
    } else {
      this.status = 'chart';
    }
    return { effect, changes };
  }

  /** Apply an event's effect and describe it. Events can hurt you but never sink you or take your last hand. */
  applyEffect(e: EventEffect): string[] {
    const out: string[] = [];
    const c = this.condition;
    const enc = this.encounter.kind === 'event' ? this.encounter : null;
    const actors: [string | undefined, number | undefined, boolean | undefined][] = [
      [enc?.actor, e.actorHp, e.loseActor],
      [enc?.actor2, e.actor2Hp, e.loseActor2],
    ];
    for (const [name, hp, lose] of actors) {
      const m = c.crew.find((x) => x.name === name);
      if (!m) continue;
      if (lose && c.crew.length > 1) {
        c.crew.splice(c.crew.indexOf(m), 1);
        out.push(`${m.name} lost`);
      } else if (hp) {
        m.hp = Math.max(1, Math.min(100, m.hp + hp));
        out.push(`${m.name} ${hp > 0 ? 'recovers' : 'wounded'}`);
      }
    }
    if (e.damage) {
      for (const [id, n] of Object.entries(e.damage) as [SystemId, number][]) {
        const max = this.fit.systems[id];
        if (!max || n <= 0) continue;
        this.setDamage(id, Math.min(max, (c.damage[id] ?? 0) + n));
        out.push(`${SYSTEM_NAMES[id]} damaged`);
      }
    }
    if (e.upgrade) {
      const offer = this.upgradeOffers().find((o) => o.id === e.upgrade);
      if (offer && !offer.maxed) {
        this.applyUpgrade(e.upgrade);
        out.push(`${offer.label}: ${offer.detail}`);
      } else {
        this.gold += 20;
        out.push('+20 gold');
      }
    }
    if (e.flag) {
      this.flags.add(e.flag);
      this.placeLeads();
    }
    if (e.clearFlag) this.flags.delete(e.clearFlag);
    if (e.gold) {
      const before = this.gold;
      // Richer waters, richer finds; losses stay as written.
      const gold = e.gold > 0 ? Math.round(e.gold * (1 + SECTOR_EVENT_GOLD * this.sector)) : e.gold;
      this.gold = Math.max(0, this.gold + gold);
      out.push(`${e.gold > 0 ? '+' : '−'}${Math.abs(this.gold - before)} gold`);
    }
    if (e.hull) {
      const before = c.hull;
      c.hull = Math.max(1, Math.min(this.fit.hull, c.hull + e.hull));
      if (c.hull !== before) out.push(`${c.hull > before ? '+' : '−'}${Math.abs(c.hull - before)} hull`);
    }
    if (e.crewHp) {
      for (const m of c.crew) m.hp = Math.max(1, Math.min(100, m.hp + e.crewHp));
      out.push(e.crewHp > 0 ? 'Crew healed' : 'Crew wounded');
    }
    if (e.repair && Object.keys(c.damage).length) {
      c.damage = {};
      out.push('Systems repaired');
    }
    for (let i = 0; i < (e.loseCrew ?? 0) && c.crew.length > 1; i++) {
      const lost = c.crew.splice(this.rng.int(c.crew.length), 1)[0];
      out.push(`${lost.name} lost`);
    }
    if (e.recruitName) {
      const name = this.recruit(e.recruitName);
      out.push(name ? `${name} joins the crew` : 'No bunk to spare: they stay ashore');
    }
    for (let i = 0; i < (e.recruit ?? 0); i++) {
      const name = this.recruit();
      out.push(name ? `${name} joins the crew` : 'No bunk to spare: they stay ashore');
    }
    if (e.gun) {
      const w = weapon(e.gun);
      if (this.fit.guns.length < MAX_GUNS) {
        this.fit.guns.push({ weapon: w.id });
        out.push(`${w.name} mounted`);
      } else {
        const scrap = Math.floor(w.price / 2);
        this.gold += scrap;
        out.push(`No free gun port: the ${w.name} fetches ${scrap} gold`);
      }
    }
    if (e.provisions) {
      const before = this.provisions;
      this.provisions = Math.max(0, Math.min(this.maxProvisions, this.provisions + e.provisions));
      const n = this.provisions - before;
      if (n) out.push(`${n > 0 ? '+' : '−'}${Math.abs(n)} provision${Math.abs(n) === 1 ? '' : 's'}`);
      else if (e.provisions > 0) out.push('No room in the hold');
    }
    if (e.navy) {
      this.navy += e.navy;
      out.push(e.navy > 0 ? 'The Navy gains on you' : 'You gain on the Navy');
    }
    for (const [p, d] of Object.entries(e.standing ?? {}) as [PowerId, number][]) out.push(...this.shift(p, d, false));
    return out;
  }

  /** Sign on a new crew member if there is room. Returns their name, or null when the ship is full. */
  private recruit(named?: string, background?: string): string | null {
    if (this.condition.crew.length >= this.maxCrew) return null;
    const name = named ?? this.freshName();
    this.usedNames.add(name);
    // Those who join at sea are a mixed lot: some have a trade.
    const t = background ?? (named ? undefined : this.rng.chance(0.4) ? this.rng.pick(TRAIT_IDS) : undefined);
    const xp = t ? trait(t).xp : undefined;
    this.condition.crew.push({ name, hp: 100, home: '', ...(xp ? { xp: { ...xp } } : {}), ...(t ? { trait: t } : {}) });
    return name;
  }

  private freshName(): string {
    const free = RECRUIT_NAMES.filter((n) => !this.usedNames.has(n));
    return free.length ? this.rng.pick(free) : `Hand #${this.usedNames.size + 1}`;
  }

  /** Whether anyone aboard has this background. */
  hasTrait(id: string): boolean {
    return this.condition.crew.some((c) => c.trait === id);
  }

  /** What a candidate in the hiring hall asks. */
  handPrice(c: Candidate): number {
    return Math.max(5, this.crewPrice + trait(c.trait).premium);
  }

  // --- Port ---------------------------------------------------------------

  /** Hull points missing. */
  hullMissing(): number {
    return this.fit.hull - this.condition.hull;
  }

  canRest(): boolean {
    return this.status === 'port' && this.encounter.kind === 'port' && !this.encounter.rested;
  }

  /** Rest the crew and let the shipwrights mend every system, while the fleet gains on you. */
  rest(): boolean {
    if (!this.canRest() || this.encounter.kind !== 'port') return false;
    this.encounter.rested = true;
    for (const c of this.condition.crew) c.hp = 100;
    this.condition.damage = {};
    this.navy += PORT_REST_DELAY;
    return true;
  }

  canRepairHull(points = 1): boolean {
    return this.status === 'port' && points > 0 && this.hullMissing() >= points && this.gold >= points * HULL_PRICE;
  }

  repairHull(points = 1): boolean {
    if (!this.canRepairHull(points)) return false;
    this.gold -= points * HULL_PRICE;
    this.condition.hull += points;
    return true;
  }

  /** Whether a hand can be signed on here: the one at `pick` in the hiring hall, or any (the cheapest) when unsaid. */
  canHire(pick?: number): boolean {
    if (this.status !== 'port' || this.encounter.kind !== 'port' || this.condition.crew.length >= this.maxCrew || this.portFeud) return false;
    const hands = this.encounter.hands ?? [];
    if (pick === undefined) return hands.length ? hands.some((c) => this.gold >= this.handPrice(c)) : this.gold >= this.crewPrice;
    const c = hands[pick];
    return !!c && this.gold >= this.handPrice(c);
  }

  /** A harbour whose masters want you dead: nobody will sign on, and nobody offers work. */
  get portFeud(): boolean {
    const p = this.portPower;
    return !!p && this.tier(p) === 'feud';
  }

  /** Come into harbour: the armoury and chandler's stock, a dispatch delivered, and work on offer. */
  private enterPort(name: string, stock: string[]): Encounter {
    const welcome: string[] = [];
    const job = this.commission;
    if (job?.kind === 'dispatch' && job.port !== name) welcome.push(...this.fulfil(job));
    const enc: Extract<Encounter, { kind: 'port' }> = { kind: 'port', name, rested: false, stock, welcome };
    this.begin(enc);
    enc.fittings = this.stockFittings();
    enc.hands = this.hiringHall();
    // Foundries and arsenals stock more guns than the chart's armoury list: one more, or the heaviest.
    const special = this.speciality;
    const extra = special === 'heavy' ? ['pdr18', 'carronade'] : special === 'armoury' ? ARMOURY.filter((id) => !stock.includes(id)) : [];
    const more = extra.filter((id) => !stock.includes(id));
    if (more.length) stock.push(this.rng.pick(more));
    enc.commission = this.offerCommission(name);
    return enc;
  }

  /** Three sailors looking for a berth, each with a different background. */
  private hiringHall(): Candidate[] {
    const pool = [...TRAIT_IDS];
    const out: Candidate[] = [];
    while (out.length < 3 && pool.length) {
      const t = pool.splice(this.rng.int(pool.length), 1)[0];
      let name = this.freshName();
      while (out.some((c) => c.name === name) && RECRUIT_NAMES.length > out.length + this.usedNames.size) name = this.freshName();
      out.push({ name, trait: t });
    }
    return out;
  }

  /** What a gift to the harbour's masters costs. */
  giftPrice(): number {
    return Math.round(GIFT_PRICE * (1 + SECTOR_PRICE * this.sector));
  }

  canGift(): boolean {
    return this.inPort && this.encounter.kind === 'port' && !this.encounter.gifted && this.gold >= this.giftPrice();
  }

  /** Pay your respects to whoever holds the port: gold for goodwill, once a visit. */
  gift(): string[] {
    const p = this.portPower;
    if (!this.canGift() || !p || this.encounter.kind !== 'port') return [];
    const cost = this.giftPrice();
    this.gold -= cost;
    this.encounter.gifted = true;
    return [`−${cost} gold`, ...this.shift(p, GIFT_STANDING, false)];
  }

  /** Work the port's masters would give you: hunting their enemies, or carrying their letters on. */
  private offerCommission(port: string): Commission | null {
    if (this.portFeud) return null;
    const patron = portPower(port);
    const ahead = new Set(SECTOR_ROUTE.slice(this.sector).flat().flatMap((id) => sectorDef(id).enemies.map(([e]) => enemy(e).power)));
    const targets = POWER_IDS.filter((p) => p !== patron && relation(patron, p) < 0 && ahead.has(p));
    const scale = 1 + SECTOR_PLUNDER * this.sector;
    if (targets.length && this.rng.chance(0.7)) {
      const target = this.rng.weighted(targets, (p) => -relation(patron, p));
      return { patron, kind: 'hunt', target, port, gold: Math.round(HUNT_REWARD * scale), standing: COMMISSION_STANDING };
    }
    return { patron, kind: 'dispatch', port, gold: Math.round(DISPATCH_REWARD * scale), standing: Math.round(COMMISSION_STANDING * 0.7) };
  }

  canTakeCommission(): boolean {
    return this.inPort && this.encounter.kind === 'port' && !!this.encounter.commission && !this.commission;
  }

  takeCommission(): boolean {
    if (!this.canTakeCommission() || this.encounter.kind !== 'port') return false;
    this.commission = this.encounter.commission!;
    this.encounter.commission = null;
    return true;
  }

  /** Pay out a finished commission. */
  private fulfil(job: Commission): string[] {
    this.commission = null;
    this.gold += job.gold;
    const what = job.kind === 'hunt' ? 'Commission fulfilled' : 'Letters delivered';
    return [`${what}: +${job.gold} gold from ${power(job.patron).short}.`, ...this.shift(job.patron, job.standing, false)];
  }

  /** Sign on a hand from the hiring hall (the cheapest when unsaid). Returns their name. */
  hireCrew(pick?: number): string | null {
    if (!this.canHire(pick) || this.encounter.kind !== 'port') return null;
    const hands = this.encounter.hands ?? [];
    if (!hands.length) {
      this.gold -= this.crewPrice;
      return this.recruit();
    }
    const i = pick ?? hands.reduce((best, c, j) => (this.handPrice(c) < this.handPrice(hands[best]) ? j : best), 0);
    const c = hands[i];
    this.gold -= this.handPrice(c);
    hands.splice(i, 1);
    return this.recruit(c.name, c.trait);
  }

  leavePort(): void {
    if (this.status === 'port') this.status = 'chart';
  }

  // --- Chandler: provisions and fittings ------------------------------------------

  canBuyProvisions(n = 1): boolean {
    return this.inPort && n > 0 && this.provisions + n <= this.maxProvisions && this.gold >= n * this.provisionPrice;
  }

  buyProvisions(n = 1): boolean {
    if (!this.canBuyProvisions(n)) return false;
    this.gold -= n * this.provisionPrice;
    this.provisions += n;
    return true;
  }

  /** Two fittings the port's chandler has, that you don't already carry. */
  private stockFittings(): string[] {
    const pool = FITTING_IDS.filter((id) => !this.has(id));
    const out: string[] = [];
    const n = this.speciality === 'chandler' ? 4 : 3;
    while (out.length < n && pool.length) out.push(pool.splice(this.rng.int(pool.length), 1)[0]);
    return out;
  }

  fittingOffers(): FittingOffer[] {
    if (this.encounter.kind !== 'port') return [];
    return (this.encounter.fittings ?? []).map((id) => {
      const f = fitting(id);
      const price = this.price(f.price);
      return { fitting: f, price, available: this.inPort && !this.has(id) && this.gold >= price };
    });
  }

  buyFitting(id: string): boolean {
    const offer = this.fittingOffers().find((o) => o.fitting.id === id);
    if (!offer?.available || this.encounter.kind !== 'port') return false;
    this.gold -= offer.price;
    this.fittings.push(id);
    this.encounter.fittings = (this.encounter.fittings ?? []).filter((x) => x !== id);
    return true;
  }

  // --- Shipwright and armoury -----------------------------------------------

  private get inPort(): boolean {
    return this.status === 'port' && this.encounter.kind === 'port';
  }

  /** Improvements the shipwright offers, with their prices. */
  upgradeOffers(): UpgradeOffer[] {
    const f = this.fit;
    const offers: UpgradeOffer[] = [];
    const plating = (f.hull - this.def.hull) / PLATING;
    offers.push({
      id: 'hull',
      label: 'Oak planking',
      detail: plating >= MAX_PLATING ? 'She can carry no more timber' : `Max hull ${f.hull} → ${f.hull + PLATING}`,
      price: this.price(35 + 15 * plating),
      maxed: plating >= MAX_PLATING,
      available: plating < MAX_PLATING,
    });
    const extra = f.hands - this.def.hands;
    offers.push({
      id: 'hands',
      label: 'Sign on deckhands',
      detail: extra >= EXTRA_HANDS ? 'No hammocks to spare' : `Deckhands ${f.hands} → ${f.hands + 1}`,
      price: this.price(30 + 10 * extra),
      maxed: extra >= EXTRA_HANDS,
      available: extra < EXTRA_HANDS,
    });
    for (const id of ['sails', 'guns', 'bulwarks', 'pumps', 'helm', 'surgeon'] as SystemId[]) {
      const now = f.systems[id] ?? 0;
      if (!now) continue;
      offers.push({
        id,
        label: `Refit ${SYSTEM_NAMES[id]}`,
        detail: now >= SYSTEM_CAP[id] ? 'Fully fitted' : `${SYSTEM_NAMES[id]} ${now} → ${now + 1}`,
        price: this.price(20 + 8 * now),
        maxed: now >= SYSTEM_CAP[id],
        available: now < SYSTEM_CAP[id],
      });
    }
    // A Navy dockyard does shipwright's work cheaper.
    if (this.speciality === 'shipwright') for (const o of offers) o.price = Math.round(o.price * 0.8);
    for (const o of offers) o.available = o.available && this.inPort && this.gold >= o.price;
    return offers;
  }

  buyUpgrade(id: UpgradeId): boolean {
    const offer = this.upgradeOffers().find((o) => o.id === id);
    if (!offer?.available) return false;
    this.gold -= offer.price;
    this.applyUpgrade(id);
    return true;
  }

  private applyUpgrade(id: UpgradeId): void {
    if (id === 'hull') {
      this.fit.hull += PLATING;
      this.condition.hull += PLATING;
    } else if (id === 'hands') {
      this.fit.hands++;
    } else {
      this.fit.systems[id] = (this.fit.systems[id] ?? 0) + 1;
    }
  }

  /** Guns in this port's armoury. You need a free gun port to buy one. */
  gunOffers(): GunOffer[] {
    if (this.encounter.kind !== 'port') return [];
    const room = this.fit.guns.length < MAX_GUNS;
    return this.encounter.stock.map((id) => {
      const w = weapon(id);
      const price = this.price(w.price);
      return { weapon: w, price, available: this.inPort && room && this.gold >= price };
    });
  }

  buyGun(weaponId: string): boolean {
    const offer = this.gunOffers().find((o) => o.weapon.id === weaponId);
    if (!offer?.available || this.encounter.kind !== 'port') return false;
    this.gold -= offer.price;
    this.fit.guns.push({ weapon: weaponId });
    this.encounter.stock.splice(this.encounter.stock.indexOf(weaponId), 1);
    return true;
  }

  /** What the armoury pays for one of your guns. */
  sellPrice(index: number): number {
    const g = this.fit.guns[index];
    return g ? Math.floor(weapon(g.weapon).price * (this.speciality === 'market' ? 0.75 : 0.5)) : 0;
  }

  canSellGun(index: number): boolean {
    return this.inPort && !!this.fit.guns[index] && this.fit.guns.length > 1;
  }

  sellGun(index: number): boolean {
    if (!this.canSellGun(index)) return false;
    this.gold += this.sellPrice(index);
    this.fit.guns.splice(index, 1);
    return true;
  }

  // --- Saving -----------------------------------------------------------------

  toSave(): RunSave {
    return structuredClone({
      version: 1 as const,
      shipId: this.def.id,
      seed: this.seed,
      rng: this.rng.position,
      chart: this.chart,
      nodeId: this.nodeId,
      navy: this.navy,
      gold: this.gold,
      condition: this.condition,
      fit: this.fit,
      status: this.status,
      encounter: this.encounter,
      jumps: this.jumps,
      visited: this.visited,
      battlesWon: this.battlesWon,
      plunderTaken: this.plunderTaken,
      ending: this.ending,
      usedNames: [...this.usedNames],
      endingTitle: this.endingTitle,
      flags: [...this.flags],
      seenEvents: this.seenEvents,
      prize: this.prize,
      difficulty: this.difficulty,
      sector: this.sector,
      provisions: this.provisions,
      fittings: this.fittings,
      standing: this.standing,
      escort: this.escort,
      commission: this.commission,
      recent: this.recent,
      sectorId: this.sectorId,
      wind: this.wind,
    });
  }

  static fromSave(raw: RunSave): Run {
    if (raw?.version !== 1) throw new Error('Unknown save version');
    const s = structuredClone(raw);
    const run = new Run(s.shipId, s.seed, s.difficulty ?? 'normal');
    run.rng.position = s.rng;
    run.chart = s.chart;
    run.nodeId = s.nodeId;
    run.navy = s.navy;
    run.gold = s.gold;
    run.condition = s.condition;
    run.fit = s.fit;
    // Saves from before bulwarks have no bulwark station in the fit: give her the one she was built with.
    for (const [id, bars] of Object.entries(run.def.systems) as [SystemId, number][]) run.fit.systems[id] ??= bars;
    run.status = s.status;
    run.encounter = s.encounter;
    run.jumps = s.jumps;
    run.visited = s.visited;
    run.battlesWon = s.battlesWon;
    run.plunderTaken = s.plunderTaken;
    run.ending = s.ending;
    run.usedNames = new Set(s.usedNames);
    run.endingTitle = s.endingTitle ?? '';
    run.flags = new Set(s.flags ?? []);
    run.seenEvents = s.seenEvents ?? [];
    run.prize = s.prize ?? null;
    // Saves from before sectors hold one long chart that ends at the blockade: treat it as the last sector.
    run.sector = s.sector ?? (s.chart.columns === SECTOR_COLUMNS ? 0 : SECTOR_ROUTE.length - 1);
    // Saves from before forks in the route sailed the first sector of each stage.
    run.sectorId = s.sectorId ?? SECTOR_ROUTE[Math.min(run.sector, SECTOR_ROUTE.length - 1)][0];
    run.provisions = s.provisions ?? DIFFICULTY[run.difficulty].provisions;
    run.fittings = s.fittings ?? [];
    run.standing = { ...freshStanding(), ...s.standing };
    run.escort = s.escort ?? null;
    run.commission = s.commission ?? null;
    run.recent = s.recent ?? [];
    run.wind = s.wind ?? Math.PI;
    return run;
  }
}

const QUIET_LINES = [
  'Open water and a fair wind. The crew make running repairs.',
  'A long, empty reach under a hot sky. The carpenter is busy below.',
  'Nothing but flying fish and the creak of the rigging. A chance to mend.',
  'A quiet watch. Somebody sings below; the bosun lets it go.',
  'The trade wind holds steady and the horizon stays empty. Small mercies.',
  'Squalls to the south, but none find you. The hands patch and splice.',
];

const FORAGE_LINES = [
  'The hands get a line over the side and haul in a fine dorado. (+1 provision)',
  'A rain squall fills every cask and bucket aboard. (+1 provision)',
  'A sea turtle, sleeping on the swell, is hoisted aboard. (+1 provision)',
  'A drifting crate of ship’s biscuit, barely damp. Somebody’s loss. (+1 provision)',
];

/** A commission in a line, for the port and the ledger. */
export function describeCommission(c: Commission): string {
  return c.kind === 'hunt'
    ? `Take or sink a ship of ${power(c.target!).short} for ${power(c.patron).short}: ${c.gold} gold.`
    : `Carry ${power(c.patron).short}’s letters from ${c.port} to any other port: ${c.gold} gold.`;
}

/** A sailor's rank in a skill from their record (0, 1 Veteran, 2 Expert). */
function skillRank(xp: SkillXp | undefined, skill: Skill): number {
  const v = xp?.[skill] ?? 0;
  return v >= RANK_XP[2] ? 2 : v >= RANK_XP[1] ? 1 : 0;
}

/**
 * What makes a choice special, like FTL's blue options: the fitting, ship, skilled hand, gun or friendship it needs,
 * in a few words for its label. Null for an ordinary choice.
 */
export function specialNeed(needs: EventNeeds | undefined): string | null {
  if (!needs) return null;
  if (needs.fitting) return fitting(needs.fitting).name;
  if (needs.trait) return `${trait(needs.trait).name[0].toUpperCase()}${trait(needs.trait).name.slice(1)} aboard`;
  if (needs.ship) return needs.ship.map((id) => playerShip(id).name).join(' or ');
  const skill = Object.entries(needs.skill ?? {})[0] as [Skill, number] | undefined;
  if (skill) return `${skill[1] >= 2 ? 'Expert' : 'Veteran'} ${SKILL_LABEL[skill[0]]}`;
  if (needs.gun) return weapon(needs.gun[0]).name;
  const friend = (Object.entries(needs.standing ?? {}) as [PowerId, number | { max: number }][]).find(([, v]) => typeof v === 'number' && v > 0);
  if (friend) return `Friend of ${power(friend[0]).short}`;
  return null;
}
