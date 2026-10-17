export type SystemId = 'helm' | 'sails' | 'guns' | 'pumps' | 'surgeon' | 'bulwarks';
export type ShotType = 'round' | 'chain' | 'grape' | 'hot';
export type Side = 'player' | 'enemy';

export const SHOT_TYPES: ShotType[] = ['round', 'chain', 'grape', 'hot'];

/** Systems that draw from the ship's pool of hands via +/- (guns draw hands per powered gun). */
export const HANDS_SYSTEMS: SystemId[] = ['bulwarks', 'sails', 'pumps', 'surgeon'];

export const SYSTEM_NAMES: Record<SystemId, string> = {
  bulwarks: 'Bulwarks',
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
  /** How well her people fight hand to hand (1 = ordinary sailors; marines and soldiers more, merchant hands less). */
  melee?: number;
  systems: Partial<Record<SystemId, number>>;
  /** Stout oak sides: balls of this damage or less often glance off (see Combat.applyHit). */
  armour?: number;
  rooms: RoomDef[];
  guns: GunMount[];
  crew: CrewDef[];
}

export type Faction = 'navy' | 'merchant' | 'privateer' | 'pirate';

/** An opponent: its ship, how its captain behaves and what it carries. */
export interface EnemyDef {
  id: string;
  ship: ShipDef;
  faction: Faction;
  /** Captain temperament, passed to the AI (see AIOptions). */
  ai: { fleeAt: number; surrenderChance: number; surrenderAt: number; boardWith?: number; focus?: SystemId };
  /** Gold in her hold, as [min, max]. */
  plunder: [number, number];
  /** Names she might sail under; one is picked per encounter. */
  names: string[];
  /** Line shown when she is sighted. */
  sighting: string;
  /** More ways of telling the sighting; one is picked at random (with `sighting`). */
  sightings?: string[];
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
  /** Provisions added to (or taken from) the hold, up to what it can carry and never below empty. */
  provisions?: number;
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
  /** At least this many provisions in the hold. */
  provisions?: number;
  /** Only from this sector of the voyage on (0 = the Windward Isles, 1 = the Spanish Main). */
  minSector?: number;
  /** Chart columns the event can turn up in (on the voyage-wide 0..7 scale, see Run.progressCol). */
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
  /** Other ways the same situation can be told; one of text/variants is picked each time. */
  variants?: string[];
  /** Defaults to 'encounter'. */
  pool?: EventPool;
  /** Defaults to 'common'. */
  rarity?: EventRarity;
  /** At most once per voyage, even when the pool runs dry. */
  unique?: boolean;
  needs?: EventNeeds;
  choices: EventChoice[];
}
