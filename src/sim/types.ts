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
