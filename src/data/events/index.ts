import type { SeaEventDef } from '../../sim/types';
import { ABOARD_EVENTS } from './aboard';
import { ENCOUNTER_EVENTS } from './encounters';
import { LEGEND_EVENTS } from './legends';
import { WEATHER_EVENTS } from './weather';

/** Every event in the game. */
export const SEA_EVENTS: SeaEventDef[] = [...ENCOUNTER_EVENTS, ...ABOARD_EVENTS, ...WEATHER_EVENTS, ...LEGEND_EVENTS];

const BY_ID = new Map(SEA_EVENTS.map((e) => [e.id, e]));

export function seaEvent(id: string): SeaEventDef {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`Unknown event: ${id}`);
  return e;
}
