export type SystemId = 'helm' | 'sails' | 'guns' | 'pumps' | 'surgeon';
export type ShotType = 'round' | 'chain' | 'grape' | 'hot';
export type Side = 'player' | 'enemy';

export const SHOT_TYPES: ShotType[] = ['round', 'chain', 'grape', 'hot'];

/** Systems that draw from the ship's pool of hands via +/- (guns draw hands per powered gun). */
export const HANDS_SYSTEMS: SystemId[] = ['sails', 'pumps', 'surgeon'];

export const SYSTEM_NAMES: Record<SystemId, string> = {
  helm: 'Helm',
  sails: 'Sails',
  guns: 'Gun Deck',
  pumps: 'Pumps',
  surgeon: 'Surgeon',
};

export interface Vec {
  x: number;
  y: number;
}

export interface RoomDef {
  id: string;
  name: string;
  /** Top-left tile and size in tiles. Bow points toward +x. */
  x: number;
  y: number;
  w: number;
  h: number;
  system?: SystemId;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** Hands needed to keep the gun crewed (FTL weapon power). */
  hands: number;
  /** Seconds to load. */
  loadTime: number;
  /** Damage per ball. */
  damage: number;
  /** Balls per volley. */
  shots: number;
  /** Extra miss chance in percent. */
  inaccuracy: number;
  /** Price in gold at a port armoury. */
  price: number;
}

export interface GunMount {
  weapon: string;
  shot?: ShotType;
}

export interface CrewDef {
  name: string;
  /** Room id the crew member starts in and returns to (their station). */
  room: string;
}

export interface ShipDef {
  id: string;
  name: string;
  className: string;
  description: string;
  hull: number;
  hands: number;
  /** Flat evasion modifier in percent from hull shape. */
  speedBonus: number;
  systems: Partial<Record<SystemId, number>>;
  rooms: RoomDef[];
  guns: GunMount[];
  crew: CrewDef[];
}

export type Faction = 'navy' | 'merchant' | 'privateer';

/** An opponent: its ship, how its captain behaves and what it carries. */
export interface EnemyDef {
  id: string;
  ship: ShipDef;
  faction: Faction;
  /** Captain temperament, passed to the AI (see AIOptions). */
  ai: { fleeAt: number; surrenderChance: number; surrenderAt: number };
  /** Gold in her hold, as [min, max]. */
  plunder: [number, number];
  /** Names she might sail under; one is picked per encounter. */
  names: string[];
  /** Line shown when she is sighted. */
  sighting: string;
}

/** Something the shipwright can improve. */
export type UpgradeId = SystemId | 'hands' | 'hull';

/**
 * What happens when an event choice resolves. Every field is optional.
 * Texts may name crew: {crew} and {crew2} are two different crew members picked for the event, {ship} is your ship.
 */
export interface EventEffect {
  text: string;
  gold?: number;
  hull?: number;
  /** HP added to (or taken from) every crew member. Events wound but never kill this way. */
  crewHp?: number;
  /** HP added to or taken from {crew} / {crew2} only. */
  actorHp?: number;
  actor2Hp?: number;
  recruit?: number;
  /** A particular person signs on (if there is a bunk). */
  recruitName?: string;
  /** Random crew lost (never the last one). */
  loseCrew?: number;
  /** {crew} / {crew2} is lost (never the last one). */
  loseActor?: boolean;
  loseActor2?: boolean;
  /** Columns the Navy fleet gains on you (negative: you gain on them). */
  navy?: number;
  /** Mend all system damage. */
  repair?: boolean;
  /** Damage points dealt to systems. */
  damage?: Partial<Record<SystemId, number>>;
  /** A free shipwright upgrade (gold instead if it is already maxed). */
  upgrade?: UpgradeId;
  /** Start a fight with this enemy. */
  battle?: string;
  /** Mount this weapon in a free gun port (or sell it for scrap if there is none). */
  gun?: string;
  /** Story flags to set or clear, for events that follow on from this one. */
  flag?: string;
  clearFlag?: string;
  /** Go straight on to another event (a second page of the same story). */
  next?: string;
  /** End the voyage happily with this title (e.g. accepting a pardon). */
  ending?: string;
}

/** Conditions an event or a choice needs. All given conditions must hold. */
export interface EventNeeds {
  /** At least this many crew. */
  crew?: number;
  gold?: number;
  /** Some crew member is wounded (below 70 HP). */
  hurt?: boolean;
  /** Some system is damaged. */
  damaged?: boolean;
  /** Hull below half. */
  battered?: boolean;
  flag?: string;
  noFlag?: string;
  /** A free gun port. */
  gunPort?: boolean;
  /** Chart columns the event can turn up in. */
  minCol?: number;
  maxCol?: number;
}

export type EventRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/** Where an event turns up: at an "Unknown" node, as an incident aboard while crossing open sea, or only as the next page of another event. */
export type EventPool = 'encounter' | 'incident' | 'chain';

export interface EventChoice {
  label: string;
  /** Gold paid up front; the choice is unavailable without it. */
  cost?: number;
  needs?: EventNeeds;
  outcomes: { weight: number; effect: EventEffect }[];
}

export interface SeaEventDef {
  id: string;
  title: string;
  text: string;
  /** Defaults to 'encounter'. */
  pool?: EventPool;
  /** Defaults to 'common'. */
  rarity?: EventRarity;
  /** At most once per voyage, even when the pool runs dry. */
  unique?: boolean;
  needs?: EventNeeds;
  choices: EventChoice[];
}
