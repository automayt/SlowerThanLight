import type { Rng } from './rng';

export type NodeKind = 'start' | 'battle' | 'event' | 'port' | 'empty' | 'boss';

export interface SeaNode {
  id: number;
  /** Column, 0 at the start; the boss sits in the last column. */
  col: number;
  /** Vertical position 0..1 on the chart. */
  y: number;
  kind: NodeKind;
  /** Enemy id for battle and boss nodes. */
  enemy?: string;
  /** Event id for event nodes. */
  event?: string;
  /** Display name for ports. */
  name?: string;
  /** Ids of nodes in the next column you can sail to. */
  next: number[];
}

export interface SeaChart {
  nodes: SeaNode[];
  columns: number;
}

export interface ChartOptions {
  /** Total columns including start and boss. */
  columns?: number;
  events: string[];
  ports: string[];
}

/** Columns from start to boss inclusive. */
export const CHART_COLUMNS = 8;

/**
 * Lay out a left-to-right chart: one start node, 2-3 nodes per middle column, one boss.
 * Edges only join neighbouring columns and never cross, and every node has a way in and a way out.
 */
export function generateChart(rng: Rng, opts: ChartOptions): SeaChart {
  const columns = opts.columns ?? CHART_COLUMNS;
  const nodes: SeaNode[] = [];
  const cols: SeaNode[][] = [];
  const last = columns - 1;

  for (let col = 0; col < columns; col++) {
    const count = col === 0 || col === last ? 1 : 2 + rng.int(2);
    const column: SeaNode[] = [];
    for (let i = 0; i < count; i++) {
      const base = count === 1 ? 0.5 : 0.12 + (0.76 * i) / (count - 1);
      const jitter = count === 1 ? 0 : (rng.next() - 0.5) * 0.12;
      const node: SeaNode = { id: nodes.length, col, y: base + jitter, kind: 'empty', next: [] };
      nodes.push(node);
      column.push(node);
    }
    cols.push(column);
  }

  for (let col = 0; col < last; col++) link(rng, cols[col], cols[col + 1]);
  assignKinds(rng, cols, opts);
  return { nodes, columns };
}

/** Connect two columns (both sorted top to bottom) without crossings. */
function link(rng: Rng, a: SeaNode[], b: SeaNode[]): void {
  // Each node in `a` covers a contiguous, monotone slice of `b`.
  const ranges = a.map((_, i) => {
    const lo = Math.floor((i * b.length) / a.length);
    const hi = Math.max(lo, Math.ceil(((i + 1) * b.length) / a.length) - 1);
    return [lo, hi];
  });
  // Occasionally widen a slice downward when that cannot cross the next node's edges.
  for (let i = 0; i < a.length; i++) {
    const [, hi] = ranges[i];
    const nextLo = i + 1 < a.length ? ranges[i + 1][0] : b.length;
    if (hi + 1 < b.length && nextLo >= hi + 1 && rng.chance(0.5)) ranges[i][1] = hi + 1;
  }
  a.forEach((n, i) => {
    for (let j = ranges[i][0]; j <= ranges[i][1]; j++) n.next.push(b[j].id);
  });
}

function assignKinds(rng: Rng, cols: SeaNode[][], opts: ChartOptions): void {
  const last = cols.length - 1;
  cols[0][0].kind = 'start';
  cols[0][0].name = 'Tortuga';
  cols[last][0].kind = 'boss';
  cols[last][0].enemy = 'frigate';

  const events = [...opts.events];
  const ports = [...opts.ports];

  for (let col = 1; col < last; col++) {
    const depth = col / last;
    for (const node of cols[col]) {
      const roll = rng.weighted(
        [
          ['battle', 42],
          ['event', 30],
          ['empty', 14],
          ['port', col === 1 ? 0 : 14],
        ] as [NodeKind, number][],
        (k) => k[1],
      )[0];
      node.kind = roll;
    }
    // A port in the middle of the voyage and one just before the blockade.
    if ((col === Math.floor(last / 2) || col === last - 1) && !cols[col].some((n) => n.kind === 'port')) {
      rng.pick(cols[col]).kind = 'port';
    }
    for (const node of cols[col]) {
      if (node.kind === 'battle') node.enemy = pickEnemy(rng, depth);
      if (node.kind === 'event') {
        if (!events.length) events.push(...opts.events);
        node.event = events.splice(rng.int(events.length), 1)[0];
      }
      if (node.kind === 'port') {
        if (!ports.length) ports.push(...opts.ports);
        node.name = ports.splice(rng.int(ports.length), 1)[0];
      }
    }
  }
}

/** Merchants early, more Navy patrols as you near the blockade. */
function pickEnemy(rng: Rng, depth: number): string {
  return rng.weighted(
    [
      ['merchant', 50 - depth * 25],
      ['privateer', 30],
      ['cutter', 15 + depth * 30],
    ] as [string, number][],
    (e) => e[1],
  )[0];
}

export function nodeById(chart: SeaChart, id: number): SeaNode {
  const n = chart.nodes[id];
  if (!n) throw new Error(`No sea node ${id}`);
  return n;
}
