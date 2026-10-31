import type { PowerId } from '../sim/types';

/**
 * Painted portraits (public/art/portrait-*.jpg, 320x400, listed in the art manifest and loaded up front).
 * Everything here returns an art name: its texture is `art:<name>` once loaded. Pure data: no Phaser.
 */

/** The pool of ordinary faces a hand, a hailed master or a stranger can wear. */
export const CREW_FACES = Array.from({ length: 12 }, (_, i) => `portrait-crew-${String(i + 1).padStart(2, '0')}`);

/** Who a portrait can show. */
export type PortraitSubject =
  /** A captain from data/captains.ts, by id. */
  | { captain: string }
  /** Anyone else with a name (a crew member, a stranger): one of the crew faces, always the same for the same name. */
  | { crew: string }
  /** The harbour masters of a power. */
  | { power: PowerId }
  | 'crane'
  | 'tavern'
  | 'dice';

/** A stable hash of a name (FNV-1a), so a face never changes between screens, saves or players. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The crew face a name wears. */
export function crewFace(name: string): string {
  return CREW_FACES[hash(name.trim().toLowerCase()) % CREW_FACES.length];
}

/** The art name of a subject's portrait: `art:${portraitFor(...)}` is its texture key. */
export function portraitFor(who: PortraitSubject): string {
  if (who === 'crane') return 'portrait-crane';
  if (who === 'tavern') return 'portrait-tavern';
  if (who === 'dice') return 'portrait-dice';
  if ('captain' in who) return `portrait-captain-${who.captain}`;
  if ('power' in who) return `portrait-harbour-${who.power}`;
  return crewFace(who.crew);
}

/** The master of a hailed ship: Crown, Spanish and French officers in their uniforms, anyone else a face from the pool. */
export function shipMasterPortrait(power: PowerId, shipName: string): string {
  return power === 'crown' || power === 'spain' || power === 'france' ? portraitFor({ power }) : portraitFor({ crew: shipName });
}

/** Someone who speaks in an event: the face, and the name on the plate. */
export interface EventSpeaker {
  portrait: string;
  name: string;
}

const crew = (name: string, plate = name): EventSpeaker => ({ portrait: crewFace(name), name: plate });

/** Events told by one person: their face and name plate frame the tale. */
export const EVENT_SPEAKERS: Record<string, EventSpeaker> = {
  'crane-calling-card': { portrait: 'portrait-crane', name: 'A letter from Silas Crane' },
  'crane-quartermaster': crew('Ezekiel Vane', 'Ezekiel Vane, the Black Dog’s quartermaster'),
  deserter: crew('the deserter', 'A Navy deserter'),
  mutineers: crew('mutineer spokesman', 'The mutineers’ spokesman'),
  hermit: crew('hermit of the cay', 'The hermit'),
  midshipman: crew('young midshipman', 'A midshipman'),
  cartographer: crew('the cartographer', 'The cartographer'),
  trader: { portrait: 'portrait-harbour-trade', name: 'A Dutch trader' },
  governor: { portrait: 'portrait-harbour-crown', name: 'The Governor' },
  'governor-wish': { portrait: 'portrait-harbour-crown', name: 'The Governor' },
  envoy: { portrait: 'portrait-harbour-france', name: 'An envoy' },
  marque: { portrait: 'portrait-harbour-france', name: 'A French commissary' },
  dice: { portrait: 'portrait-dice', name: 'A card-sharp' },
  missionary: crew('the missionary', 'A missionary'),
};

/** A few words a hailed master calls across the water, by how she greets you. Picked by her name, so it stays put. */
const HAIL_LINES: Record<'hostile' | 'wary' | 'friendly' | 'commodore' | 'flee', string[]> = {
  hostile: ['Heave to and strike your colours, or we sink you where you lie!', 'Back your topsails, you gallows-bait. We are coming aboard.', 'Not one step closer. Our guns are loaded and our patience is not.'],
  wary: ['Keep your distance and we’ll keep ours.', 'We have no quarrel with you. See that it stays that way.', 'State your business, and state it from where you are.'],
  flee: ['Crowd on sail! Every stitch she’ll carry!', 'Pirates! Hard a-weather, and pray they’re slow!'],
  friendly: ['Fair winds to you, friend! What news from astern?', 'Well met! We’ll share what we have, if you share your news.', 'Ahoy there! You’re a welcome sight in these waters.'],
  commodore: ['The Commodore sends his compliments, and an offer you would be wise to hear.'],
};

/** What Crane shouts when his greeting holds no words of his own. */
const CRANE_LINES = ['I’ve been waiting for you, Captain. Patiently. Like a dog.', 'There you are. I was beginning to think you’d drowned without me.'];

/** The line a hailed ship's master calls out. */
export function hailLine(intent: string, fleeing: boolean, shipName: string): string {
  const lines = fleeing ? HAIL_LINES.flee : (HAIL_LINES[intent as keyof typeof HAIL_LINES] ?? HAIL_LINES.wary);
  return lines[hash(shipName) % lines.length];
}

/** Crane's words out of his greeting (the parts in quotation marks), or a taunt when it has none. */
export function craneLine(greeting: string, met: number): string {
  const quoted = [...greeting.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1].trim());
  return quoted.length ? quoted.join(' ') : CRANE_LINES[met % CRANE_LINES.length];
}

/** A greeting with its quoted words taken out, leaving the narration around them. */
export function withoutQuotes(text: string): string {
  return text
    .replace(/\s*["“][^"”]+["”]\s*/g, ' ')
    .replace(/\s+([.,:;])/g, '$1')
    .replace(/:\s*$/, '.')
    .trim();
}

/** How a harbour master greets you, by how their masters regard you. */
const HARBOUR_LINES: Record<'feud' | 'hostile' | 'wary' | 'friendly' | 'allied', string> = {
  feud: 'You have a nerve, putting in here. Pay your dues, buy what you must, and be gone before someone fetches a rope.',
  hostile: 'Your name is known here, Captain, and not kindly. Prices are what I say they are.',
  wary: 'Captain. Your papers are in order, or near enough. Keep your crew sober and we shall have no trouble.',
  friendly: 'Welcome back, Captain! The harbour is yours. Is there anything my masters can do for you?',
  allied: 'Captain! An honour. Anything you need, you have only to ask, and there is work for a friend.',
};

/** The harbour master's greeting. */
export function harbourLine(tier: keyof typeof HARBOUR_LINES): string {
  return HARBOUR_LINES[tier];
}
