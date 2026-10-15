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

/** What happens when an event choice resolves. Every field is optional. */
export interface EventEffect {
  text: string;
  gold?: number;
  hull?: number;
  /** HP added to (or taken from) every crew member. Events wound but never kill. */
  crewHp?: number;
  recruit?: number;
  loseCrew?: number;
  /** Columns the Navy fleet gains on you (negative: you gain on them). */
  navy?: number;
  /** Mend all system damage. */
  repair?: boolean;
  /** Start a fight with this enemy. */
  battle?: string;
  /** Mount this weapon in a free gun port (or sell it for scrap if there is none). */
  gun?: string;
}

export interface EventChoice {
  label: string;
  /** Gold paid up front; the choice is unavailable without it. */
  cost?: number;
  outcomes: { weight: number; effect: EventEffect }[];
}

export interface SeaEventDef {
  id: string;
  title: string;
  text: string;
  choices: EventChoice[];
}
