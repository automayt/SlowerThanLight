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
  /** Display name for ports. */
  name?: string;
  /** Weapon ids a port's armoury has for sale. */
  stock?: string[];
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
  ports: string[];
  /** Weapon ids ports can stock, cheapest first. Heavier guns turn up later in the voyage. */
  armoury?: string[];
}

/** Columns from start to boss inclusive. */
export const CHART_COLUMNS = 8;

/** Rough share of middle nodes of each kind; the rest are open sea. */
const KIND_SHARES: [NodeKind, number][] = [
  ['battle', 0.4],
  ['event', 0.3],
  ['port', 0.12],
];

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

  const ports = [...opts.ports];

  // Deal kinds from a shuffled bag so every chart has a similar mix. No port right outside Tortuga.
  const middle = cols.slice(1, last).flat();
  const bag: NodeKind[] = [];
  for (const [kind, share] of KIND_SHARES) for (let i = Math.round(middle.length * share); i > 0; i--) bag.push(kind);
  while (bag.length < middle.length) bag.push('empty');
  for (const node of middle) {
    const allowed = bag.map((k, i) => (node.col === 1 && k === 'port' ? -1 : i)).filter((i) => i >= 0);
    node.kind = bag.splice(rng.pick(allowed), 1)[0];
  }

  for (let col = 1; col < last; col++) {
    const depth = col / last;
    // A port in the middle of the voyage and one just before the blockade.
    if ((col === Math.floor(last / 2) || col === last - 1) && !cols[col].some((n) => n.kind === 'port')) {
      rng.pick(cols[col]).kind = 'port';
    }
    for (const node of cols[col]) {
      if (node.kind === 'battle') node.enemy = pickEnemy(rng, depth);
      if (node.kind === 'port') {
        if (!ports.length) ports.push(...opts.ports);
        node.name = ports.splice(rng.int(ports.length), 1)[0];
        node.stock = stockArmoury(rng, opts.armoury ?? [], depth);
      }
    }
  }
}

/** Two different guns, the heavy ones likelier the deeper into the voyage. */
function stockArmoury(rng: Rng, armoury: string[], depth: number): string[] {
  const pool = armoury.map((id, i) => ({ id, w: 1 + depth * i }));
  const stock: string[] = [];
  while (stock.length < 2 && pool.length) {
    const pick = rng.weighted(pool, (p) => p.w);
    stock.push(pick.id);
    pool.splice(pool.indexOf(pick), 1);
  }
  return stock;
}

/** Merchants early, more Navy patrols (and the odd treasure galleon) as you near the blockade. */
function pickEnemy(rng: Rng, depth: number): string {
  return rng.weighted(
    [
      ['merchant', 50 - depth * 25],
      ['privateer', 30],
      ['cutter', 15 + depth * 30],
      ['galleon', depth * 10],
    ] as [string, number][],
    (e) => e[1],
  )[0];
}

export function nodeById(chart: SeaChart, id: number): SeaNode {
  const n = chart.nodes[id];
  if (!n) throw new Error(`No sea node ${id}`);
  return n;
}
