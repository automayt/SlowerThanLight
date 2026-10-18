import type { Rng } from './rng';

export type NodeKind = 'start' | 'battle' | 'event' | 'port' | 'empty' | 'boss' | 'exit';

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
  /** For a passage: the id of the sector it leads into. */
  to?: string;
  /** A lead the voyage's story has put here: the id of the event waiting at this mark. */
  story?: string;
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
  /** The last stretch of the voyage ends at the blockade; earlier ones end at a passage into the next. */
  final?: boolean;
  /** Name of the start node (default Tortuga). */
  startName?: string;
  /** Name of the passage at the far end of a non-final chart. */
  exitName?: string;
  /** The passages at the far end of a non-final chart, when there is a choice: each one's name and where it leads. */
  exits?: { name: string; to: string }[];
  /** Who battle nodes hold, with relative weights. Defaults to the classic mix by depth. */
  enemies?: [string, number][];
  /**
   * Where this chart lies in the whole voyage, as [start, end] on a 0..1 scale (default: all of it).
   * Armouries stock heavier guns, and the classic enemy mix turns harder, the deeper into the voyage a port lies.
   */
  depth?: [number, number];
}

/** Columns from start to boss inclusive, for a single-chart voyage. */
export const CHART_COLUMNS = 8;
/** Columns in each sector of a multi-sector voyage. */
export const SECTOR_COLUMNS = 6;

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
    // Three or four marks a column, so most legs offer a real choice; a fork in the voyage ends in more than one passage.
    const count = col === 0 ? 1 : col === last ? (opts.final === false ? Math.max(1, opts.exits?.length ?? 1) : 1) : 3 + rng.int(2);
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
  // Often widen a slice downward when that cannot cross the next node's edges.
  for (let i = 0; i < a.length; i++) {
    const [, hi] = ranges[i];
    const nextLo = i + 1 < a.length ? ranges[i + 1][0] : b.length;
    if (hi + 1 < b.length && nextLo >= hi + 1 && rng.chance(0.85)) ranges[i][1] = hi + 1;
  }
  // And upward, into the node the one above already reaches (sharing a node never crosses).
  for (let i = 1; i < a.length; i++) {
    const [lo] = ranges[i];
    if (lo > 0 && ranges[i - 1][1] <= lo - 1 && rng.chance(0.7)) ranges[i][0] = lo - 1;
  }
  a.forEach((n, i) => {
    for (let j = ranges[i][0]; j <= ranges[i][1]; j++) n.next.push(b[j].id);
  });
}

function assignKinds(rng: Rng, cols: SeaNode[][], opts: ChartOptions): void {
  const last = cols.length - 1;
  cols[0][0].kind = 'start';
  cols[0][0].name = opts.startName ?? 'Tortuga';
  if (opts.final === false) {
    const exits = opts.exits ?? [{ name: opts.exitName ?? 'The Passage', to: '' }];
    cols[last].forEach((node, i) => {
      node.kind = 'exit';
      node.name = exits[i]?.name ?? exits[0].name;
      if (exits[i]?.to) node.to = exits[i].to;
    });
  } else {
    cols[last][0].kind = 'boss';
    cols[last][0].enemy = 'frigate';
  }

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

  const [from, to] = opts.depth ?? [0, 1];
  for (let col = 1; col < last; col++) {
    const depth = from + ((to - from) * col) / last;
    // A port in the middle of the voyage and one just before the blockade.
    if ((col === Math.floor(last / 2) || col === last - 1) && !cols[col].some((n) => n.kind === 'port')) {
      rng.pick(cols[col]).kind = 'port';
    }
    for (const node of cols[col]) {
      if (node.kind === 'battle') node.enemy = opts.enemies ? rng.weighted(opts.enemies, (e) => e[1])[0] : pickEnemy(rng, depth);
      if (node.kind === 'port') {
        if (!ports.length) ports.push(...opts.ports);
        node.name = ports.splice(rng.int(ports.length), 1)[0];
        node.stock = stockArmoury(rng, opts.armoury ?? [], depth);
      }
    }
  }
}

/** Two different guns, likeliest those whose weight suits how deep into the voyage the port lies (light early, heavy late). */
function stockArmoury(rng: Rng, armoury: string[], depth: number): string[] {
  const pool = armoury.map((id, i) => ({ id, w: 1 / (0.15 + Math.abs(i / Math.max(1, armoury.length - 1) - depth)) }));
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
