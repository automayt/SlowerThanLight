import type { Battle } from '../../src/sim/Battle';
import { EXTRA_HANDS, MAX_GUNS, MAX_PLATING, PLATING, SYSTEM_CAP, type Run } from '../../src/sim/Run';
import type { Ship } from '../../src/sim/Ship';
import type { SystemId } from '../../src/sim/types';

/**
 * Checks that must hold at every moment of a voyage or a fight. Each returns what is wrong (empty when all is well);
 * they are plain comparisons rather than expect() calls because the fuzz tests run them on every simulation step.
 */

/** Path to the first number in a value that is NaN or infinite, or null if there is none. */
export function badNumber(value: unknown, path = '', seen = new Set<unknown>()): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} = ${value}`;
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  const entries = value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value].map((v, i) => [i, v]) : Object.entries(value);
  for (const [k, v] of entries) {
    const bad = badNumber(v, `${path}.${String(k)}`, seen);
    if (bad) return bad;
  }
  return null;
}

const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

export function shipProblems(ship: Ship): string[] {
  const out: string[] = [];
  const at = ship.side;
  if (!within(ship.hull, 0, ship.def.hull)) out.push(`${at} hull ${ship.hull}/${ship.def.hull}`);
  if (ship.freeHands() < 0) out.push(`${at} more hands allocated than she has (${ship.freeHands()} free)`);
  for (const s of ship.systems.values()) {
    if (!within(s.damage, 0, s.max)) out.push(`${at} ${s.id} damage ${s.damage}/${s.max}`);
    if (s.hands < 0 || ship.allocated(s.id) > ship.capacity(s.id)) out.push(`${at} ${s.id} has ${ship.allocated(s.id)} hands for ${ship.capacity(s.id)} bars`);
  }
  for (const g of ship.guns) if (!within(g.charge, 0, g.def.loadTime)) out.push(`${at} gun charge ${g.charge}`);
  for (const r of ship.rooms.values()) {
    // Water moves by floating-point volumes, so allow a hair over the brim.
    if (!within(r.fire, 0, 100) || !within(r.water, 0, 100.001) || !within(r.sabotage, 0, 100)) out.push(`${at} ${r.def.id} fire ${r.fire} water ${r.water} sabotage ${r.sabotage}`);
  }
  if (!within(ship.layers, 0, ship.system('bulwarks')?.max ?? 0)) out.push(`${at} ${ship.layers} bulwark layers`);
  if (!within(ship.escape, 0, 100)) out.push(`${at} escape ${ship.escape}`);
  const slots = new Set<string>();
  for (const c of ship.crew) {
    // The dead are cleared at the end of every step.
    if (!(c.hp > 0 && c.hp <= c.maxHp)) out.push(`${at} ${c.name} hp ${c.hp}`);
    if (!ship.rooms.has(c.room) || c.waypoints.some((w) => !ship.rooms.has(w.room))) out.push(`${at} ${c.name} in or heading for an unknown room`);
    const slot = `${c.slot.x},${c.slot.y}`;
    if (slots.has(slot)) out.push(`${at} ${c.name} shares a tile at ${slot}`);
    slots.add(slot);
  }
  return out;
}

export function battleProblems(battle: Battle): string[] {
  const out = [...shipProblems(battle.player), ...shipProblems(battle.enemy)];
  // Every crew member is in exactly one place: aboard one ship, or crossing.
  const everyone = [...battle.player.crew, ...battle.enemy.crew, ...battle.transit.map((t) => t.crew)];
  if (new Set(everyone).size !== everyone.length) out.push('someone is in two places at once');
  if (battle.player.crew.some((c) => c.side === 'enemy' && battle.outcome)) out.push('enemy boarders left aboard after the fight');
  return out;
}

export function runProblems(run: Run): string[] {
  const out: string[] = [];
  const c = run.condition;
  if (!within(c.hull, run.over ? 0 : 1, run.fit.hull)) out.push(`hull ${c.hull}/${run.fit.hull}`);
  if (!run.over && !c.crew.length) out.push('sailing with nobody aboard');
  if (c.crew.length > run.maxCrew) out.push(`${c.crew.length} crew for ${run.maxCrew} bunks`);
  if (new Set(c.crew.map((m) => m.name)).size !== c.crew.length) out.push('two crew share a name');
  for (const m of c.crew) if (!within(m.hp, 1, 100)) out.push(`${m.name} hp ${m.hp}`);
  for (const [id, n] of Object.entries(c.damage) as [SystemId, number][]) if (!within(n, 1, run.fit.systems[id] ?? 0)) out.push(`${id} damage ${n}`);
  if (!Number.isInteger(run.gold) || run.gold < 0) out.push(`gold ${run.gold}`);
  if (!Number.isInteger(run.provisions) || !within(run.provisions, 0, run.maxProvisions)) out.push(`provisions ${run.provisions}/${run.maxProvisions}`);
  // The fit stays within what the shipwright and armoury can give.
  if (!within(run.fit.guns.length, 1, MAX_GUNS)) out.push(`${run.fit.guns.length} guns`);
  if (!within(run.fit.hands - run.def.hands, 0, EXTRA_HANDS)) out.push(`${run.fit.hands} hands`);
  if (!within(run.fit.hull - run.def.hull, 0, PLATING * MAX_PLATING)) out.push(`max hull ${run.fit.hull}`);
  for (const [id, bars] of Object.entries(run.fit.systems) as [SystemId, number][]) {
    const built = run.def.systems[id] ?? 0;
    if (!within(bars, built, Math.max(SYSTEM_CAP[id], built))) out.push(`${id} ${bars} bars`);
  }
  if (new Set(run.fittings).size !== run.fittings.length) out.push('a fitting bought twice');
  if (!run.chart.nodes[run.nodeId] || !run.visited.includes(run.nodeId)) out.push(`at node ${run.nodeId}`);
  if (!within(run.sector, 0, 2)) out.push(`sector ${run.sector}`);
  const kind: Partial<Record<string, string>> = { battle: 'battle', event: 'event', port: 'port' };
  if (kind[run.status] && run.encounter.kind !== kind[run.status]) out.push(`status ${run.status} with a ${run.encounter.kind} encounter`);
  const bad = badNumber(run.toSave());
  if (bad) out.push(`bad number at ${bad}`);
  return out;
}
