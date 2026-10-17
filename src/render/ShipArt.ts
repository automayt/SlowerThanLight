import Phaser from 'phaser';
import { Rng } from '../sim/rng';
import type { Ship } from '../sim/Ship';
import type { RoomDef, Vec } from '../sim/types';

/** Ship art is painted at this multiple of screen resolution, then shown at 1/ART_SCALE so it stays crisp when scaled up. */
export const ART_SCALE = 2;

/** How a mast is rigged: square yards across the deck, a gaff and boom fore-and-aft, or a long slanting lateen or lug yard. */
export type RigKind = 'square' | 'gaff' | 'lateen' | 'lug';

/** The lines of a ship's class, so a galleon, a xebec and a cutter each read as themselves at a glance. */
export interface HullStyle {
  /** Stern half-width as a share of the beam: 1 is a broad transom, low a pointed, double-ended stern. */
  transom: number;
  /** How far the stern and bow run past the room grid, in tiles. */
  sternOut: number;
  bowOut: number;
  /** Bow fullness: high is a bluff, apple-cheeked bow, low a fine entry. */
  bluff: number;
  bowsprit: number;
  /** Rig of each mast: main, fore, then mizzen. Small hulls carry fewer. */
  rig: RigKind[];
  /** A towering stern castle and a beakhead. */
  castle?: boolean;
  /** A raised forecastle, its break shadowing the waist. */
  forecastle?: boolean;
  /** Glazed quarter galleries bulging from the stern quarters. */
  galleries?: boolean;
}

const STYLES: [RegExp, HullStyle][] = [
  [/galleon/, { transom: 1, sternOut: 0.95, bowOut: 1.45, bluff: 2.8, bowsprit: 1.25, rig: ['square', 'square', 'lateen'], castle: true, forecastle: true, galleries: true }],
  [/frigate/, { transom: 0.95, sternOut: 0.8, bowOut: 1.7, bluff: 2.5, bowsprit: 1.35, rig: ['square', 'square', 'square'], forecastle: true, galleries: true }],
  [/xebec/, { transom: 0.1, sternOut: 1.35, bowOut: 2, bluff: 1.5, bowsprit: 0.9, rig: ['lateen', 'lateen', 'lateen'] }],
  [/lugger/, { transom: 0.4, sternOut: 1.3, bowOut: 1.6, bluff: 1.9, bowsprit: 1.4, rig: ['lug', 'lug', 'lug'] }],
  [/schooner|guarda/, { transom: 0.72, sternOut: 0.8, bowOut: 1.95, bluff: 1.55, bowsprit: 1.75, rig: ['gaff', 'gaff'] }],
  [/brigantine/, { transom: 0.85, sternOut: 0.75, bowOut: 1.7, bluff: 2, bowsprit: 1.3, rig: ['gaff', 'square'] }],
  [/brig/, { transom: 0.97, sternOut: 0.7, bowOut: 1.35, bluff: 3.2, bowsprit: 1, rig: ['square', 'square'], forecastle: true }],
  [/sloop-of-war/, { transom: 0.9, sternOut: 0.8, bowOut: 1.7, bluff: 2.2, bowsprit: 1.3, rig: ['square', 'square', 'square'], galleries: true }],
  [/cutter/, { transom: 0.68, sternOut: 0.7, bowOut: 1.45, bluff: 2.4, bowsprit: 2.2, rig: ['gaff'] }],
  [/sloop/, { transom: 0.75, sternOut: 0.75, bowOut: 1.75, bluff: 1.75, bowsprit: 1.9, rig: ['gaff'] }],
];
const DEFAULT_STYLE: HullStyle = { transom: 0.9, sternOut: 0.75, bowOut: 1.6, bluff: 2.1, bowsprit: 1.1, rig: ['square', 'square', 'square'] };

export function hullStyle(def: { className: string }): HullStyle {
  const name = def.className.toLowerCase();
  return STYLES.find(([re]) => re.test(name))?.[1] ?? DEFAULT_STYLE;
}

/** A spar and the sail it carries, in tile coordinates (bow toward +x). */
export interface Spar {
  kind: RigKind;
  mast: Vec;
  /** The yard or boom, end to end. */
  a: Vec;
  b: Vec;
  /** Which way the sail bellies when it draws, as a unit vector. */
  belly: Vec;
  /** Mainmast: the biggest spread of canvas. */
  main: boolean;
}

export interface ShipGeometry {
  /** Padding around the room grid, in tiles. */
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  /** Hull outline in tile coordinates (room grid origin, bow toward +x). */
  outline: Vec[];
  /** Inside edge of the bulwarks. */
  deck: Vec[];
  /** Mast positions in tile coordinates. */
  masts: Vec[];
  /** One per mast, in the same order. */
  spars: Spar[];
  /** Headsail from the foremast out to the bowsprit, if she sets one. */
  jib: { a: Vec; b: Vec } | null;
  style: HullStyle;
  /** Half the hull's width at its widest, in tiles. */
  beam: number;
  stern: number;
  tip: number;
  /** End of the bowsprit. */
  sprit: number;
  /** Half-width of the hull at x, less an optional inset. */
  half: (x: number, inset?: number) => number;
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Fit a smooth sailing-ship hull, in the lines of her class, around the ship's rooms. */
export function shipGeometry(ship: Ship): ShipGeometry {
  const style = hullStyle(ship.def);
  const W = ship.width;
  const H = ship.height;
  const mid = H / 2;
  const rooms = [...ship.rooms.values()].map((r) => r.def);
  const stern = -style.sternOut;
  const tip = W + style.bowOut;
  const fullRows = rooms.filter((r) => r.y === 0 || r.y + r.h === H);
  const lastFull = fullRows.length ? Math.max(...fullRows.map((r) => r.x + r.w)) : W * 0.6;
  const bowStart = Math.min(Math.max(lastFull - 0.7, W * 0.45), W - 0.4);
  // A pointed stern takes longer to swell out to full breadth.
  const sternRun = 1.2 + (1 - style.transom) * 0.6;

  const shape = (x: number) =>
    x <= bowStart
      ? style.transom + (1 - style.transom) * smoothstep(stern, stern + sternRun, x)
      : Math.pow(Math.max(0, 1 - Math.pow((x - bowStart) / (tip - bowStart), style.bluff)), 0.6);

  // Wide enough that every room corner sits inside the bulwarks with a margin.
  let beam = mid + 0.5;
  for (const r of rooms) {
    for (const x of [r.x, r.x + r.w]) {
      const f = shape(x);
      if (f < 0.3) continue;
      for (const y of [r.y, r.y + r.h]) beam = Math.max(beam, (Math.abs(y - mid) + 0.42) / f);
    }
  }
  const half = (x: number, inset = 0) => Math.max(0, beam * shape(x) - inset);

  const round = 0.12 + (1 - style.transom) * 0.45;
  const outline = profile(stern, tip, mid, (x) => half(x), round);
  const deck = profile(stern + 0.3, tip - 0.65, mid, (x) => half(x, 0.28), round);

  const masts: Vec[] = [];
  const sails = rooms.find((r) => r.system === 'sails');
  const count = Math.min(style.rig.length, W >= 8 ? 3 : W >= 7 ? 2 : 1);
  masts.push({ x: sails ? sails.x + sails.w / 2 : W * 0.4, y: mid });
  if (count >= 2) masts.push({ x: Math.min(W - 0.9, masts[0].x + W * 0.5), y: mid });
  if (count >= 3) masts.push({ x: 0.9, y: mid });

  const spars = masts.map((m, i): Spar => {
    const kind = style.rig[i];
    const main = i === 0;
    const up = { x: 0, y: -1 };
    if (kind === 'square') {
      const yardHalf = half(m.x) * (main ? 1.14 : 1.02) + 0.12;
      const brace = 0.07;
      const at = (s: number) => ({ x: m.x - Math.sin(brace) * yardHalf * s, y: mid + Math.cos(brace) * yardHalf * s });
      return { kind, mast: m, a: at(-1), b: at(1), belly: { x: 1, y: 0 }, main };
    }
    if (kind === 'gaff') {
      // The boom runs aft over the deck to the next mast or the taffrail.
      const aft = Math.max(stern + 0.35, ...masts.filter((o) => o.x < m.x - 0.1).map((o) => o.x + 0.35));
      return { kind, mast: m, a: { x: m.x, y: mid }, b: { x: Math.max(aft, m.x - 2.6), y: mid }, belly: up, main };
    }
    // Lateen and lug yards slant across the deck, peaked up aft.
    const len = kind === 'lateen' ? (main ? 3.4 : i === 1 ? 3 : 2.4) : half(m.x) * 2 * 0.95;
    const ang = kind === 'lateen' ? 0.42 : 1.05;
    const c = { x: m.x + (kind === 'lateen' ? 0.35 : 0.1), y: mid };
    const d = { x: Math.cos(ang) * (len / 2), y: Math.sin(ang) * (len / 2) };
    return { kind, mast: m, a: { x: c.x + d.x, y: c.y + d.y }, b: { x: c.x - d.x, y: c.y - d.y }, belly: { x: Math.sin(ang), y: -Math.cos(ang) }, main };
  });
  const sprit = tip + style.bowsprit;
  const foremost = spars.reduce<Spar | null>((f, s) => (!f || s.mast.x > f.mast.x ? s : f), null);
  const jib = foremost && foremost.kind !== 'lateen' ? { a: { x: foremost.mast.x + 0.25, y: mid }, b: { x: tip + (sprit - tip) * 0.6, y: mid } } : null;

  const padT = Math.max(beam - mid + 0.9, beam * 1.25 - mid + 0.35);
  return { padL: -stern + 1.1, padR: sprit - W + 1.1, padT, padB: padT, outline, deck, masts, spars, jib, style, beam, stern, tip, sprit, half };
}

function profile(x0: number, x1: number, mid: number, half: (x: number) => number, round = 0.12): Vec[] {
  const n = 56;
  const top: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const h = half(x);
    if (h > 0.01 || i === n) top.push({ x, y: mid - h });
  }
  const bottom = top
    .slice(0, -1)
    .reverse()
    .map((p) => ({ x: p.x, y: 2 * mid - p.y }));
  // A gently rounded transom, or a pointed stern on a double-ender.
  return [...top, ...bottom, { x: x0 - round, y: mid }];
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function sourceImage(scene: Phaser.Scene, key: string): CanvasImageSource | null {
  return scene.textures.exists(key) ? (scene.textures.get(key).getSourceImage() as CanvasImageSource) : null;
}

function makeCanvas(scene: Phaser.Scene, key: string, w: number, h: number): Phaser.Textures.CanvasTexture {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  return scene.textures.createCanvas(key, Math.ceil(w), Math.ceil(h))!;
}

type Ctx = CanvasRenderingContext2D;

interface Painter {
  ctx: Ctx;
  u: number;
  X: (x: number) => number;
  Y: (y: number) => number;
  rnd: Rng;
}

function path(p: Painter, pts: Vec[]): void {
  const { ctx, X, Y } = p;
  ctx.beginPath();
  pts.forEach((pt, i) => (i ? ctx.lineTo(X(pt.x), Y(pt.y)) : ctx.moveTo(X(pt.x), Y(pt.y))));
  ctx.closePath();
}

function pattern(ctx: Ctx, img: CanvasImageSource | null, scale: number): CanvasPattern | null {
  if (!img) return null;
  const pat = ctx.createPattern(img, 'repeat');
  pat?.setTransform(new DOMMatrix().scale(scale));
  return pat;
}

/** The colours a ship flies at her stern. */
export type Ensign = 'pirate' | 'navy' | 'spanish' | 'trade';

export interface EnsignArt {
  key: string;
  /** Where the hoist meets the staff, in texture pixels. */
  hoistX: number;
  hoistY: number;
}

export interface ShipTextures {
  base: string;
  rig: string;
  ensign: EnsignArt;
  geom: ShipGeometry;
}

/** Hull paint by the colours she flies: a band along the gunports and a wash over the planking. */
const LIVERY: Record<Ensign, { band: string; trim: string | null; wash: string | null }> = {
  pirate: { band: '#5e1a12', trim: null, wash: 'rgba(8,6,6,0.3)' },
  navy: { band: '#c8963a', trim: '#1a1208', wash: 'rgba(10,10,14,0.22)' },
  spanish: { band: '#8e2a1c', trim: '#d9aa48', wash: 'rgba(120,30,18,0.2)' },
  trade: { band: '#8a6a3e', trim: null, wash: 'rgba(160,120,70,0.12)' },
};

/**
 * Paint a ship's hull, deck, compartments and fittings (base), her masts, spars and standing rigging (rig) and her
 * ensign into canvas textures. Hull and rig are painted bow-right and the view flips them for the enemy; the ensign
 * is painted already facing the right way (`mirror` for the enemy) because the view waves it in strips.
 * The sails themselves are drawn live by the view, so they can fill, furl and tear.
 */
export function paintShip(scene: Phaser.Scene, ship: Ship, tile: number, keyPrefix: string, flag: Ensign, mirror = false): ShipTextures {
  const geom = shipGeometry(ship);
  const u = tile * ART_SCALE;
  const w = (geom.padL + ship.width + geom.padR) * u;
  const h = (geom.padT + ship.height + geom.padB) * u;
  const X = (x: number) => (x + geom.padL) * u;
  const Y = (y: number) => (y + geom.padT) * u;

  const baseTex = makeCanvas(scene, `${keyPrefix}-base`, w, h);
  const base: Painter = { ctx: baseTex.getContext(), u, X, Y, rnd: new Rng(hashSeed(ship.def.id)) };
  paintHull(scene, base, ship, geom, flag);
  paintCompartments(scene, base, ship, geom);
  baseTex.refresh();

  const rigTex = makeCanvas(scene, `${keyPrefix}-rig`, w, h);
  const rig: Painter = { ctx: rigTex.getContext(), u, X, Y, rnd: new Rng(hashSeed(ship.def.id) + 7) };
  paintRig(rig, ship, geom);
  rigTex.refresh();

  // The ensign: hoist at the right edge, flying left (or mirrored).
  const L = 1.05 * u;
  const fw = L + 0.2 * u;
  const fh = 1.2 * u;
  const flagTex = makeCanvas(scene, `${keyPrefix}-flag`, fw, fh);
  const fctx = flagTex.getContext();
  const hoistX = mirror ? 0.1 * u : fw - 0.1 * u;
  if (mirror) {
    fctx.translate(fw, 0);
    fctx.scale(-1, 1);
  }
  paintEnsign(fctx, fw - 0.1 * u, fh * 0.42, u, flag);
  flagTex.refresh();

  return { base: `${keyPrefix}-base`, rig: `${keyPrefix}-rig`, ensign: { key: `${keyPrefix}-flag`, hoistX, hoistY: fh * 0.42 }, geom };
}

// --- Hull ------------------------------------------------------------------

function paintHull(scene: Phaser.Scene, p: Painter, ship: Ship, g: ShipGeometry, flag: Ensign): void {
  const { ctx, u, X, Y } = p;
  const mid = ship.height / 2;
  const st = g.style;
  const livery = LIVERY[flag];
  const aft = g.outline[g.outline.length - 1].x;

  // Rudder and bowsprit sit under the hull edge.
  ctx.fillStyle = '#2b1a0d';
  ctx.fillRect(X(aft - 0.3), Y(mid - 0.07), 0.4 * u, 0.14 * u);
  if (st.castle || st.rig[0] === 'lateen') beakhead(p, g, mid, livery.trim ?? '#c9a24a');
  spar(ctx, X(ship.width - 0.6), Y(mid), X(g.sprit), Y(mid), 0.2 * u, 0.1 * u);
  // Jib-boom lashings.
  ctx.strokeStyle = '#c9b07a';
  ctx.lineWidth = 0.03 * u;
  for (const k of [0.35, 0.6]) {
    const x = X(g.tip + (g.sprit - g.tip) * k);
    ctx.beginPath();
    ctx.moveTo(x, Y(mid) - 0.07 * u);
    ctx.lineTo(x, Y(mid) + 0.07 * u);
    ctx.stroke();
  }

  // Drop shadow on the water.
  ctx.save();
  ctx.shadowColor = 'rgba(0,10,20,0.55)';
  ctx.shadowBlur = 0.5 * u;
  ctx.shadowOffsetX = 0.08 * u;
  ctx.shadowOffsetY = 0.22 * u;
  path(p, g.outline);
  ctx.fillStyle = '#24160c';
  ctx.fill();
  ctx.restore();

  if (st.galleries) for (const s of [-1, 1]) quarterGallery(p, g, mid, s, livery.trim ?? '#c9a24a');

  // Tarred planking.
  ctx.save();
  path(p, g.outline);
  ctx.clip();
  ctx.fillStyle = pattern(ctx, sourceImage(scene, 'art:tex-hull'), (0.9 * u) / 120) ?? '#3a2616';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (livery.wash) {
    ctx.fillStyle = livery.wash;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  // Strakes following the curve of the hull.
  for (let i = 1; i <= 3; i++) {
    const inset = i * 0.06;
    ctx.strokeStyle = i % 2 ? 'rgba(0,0,0,0.45)' : 'rgba(255,214,160,0.12)';
    ctx.lineWidth = 0.02 * u;
    path(p, insetOutline(g, mid, inset));
    ctx.stroke();
  }
  const light = ctx.createLinearGradient(0, Y(mid - g.beam), 0, Y(mid + g.beam));
  light.addColorStop(0, 'rgba(255,230,190,0.16)');
  light.addColorStop(0.5, 'rgba(0,0,0,0)');
  light.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();

  ctx.strokeStyle = '#140b05';
  ctx.lineWidth = 0.05 * u;
  path(p, g.outline);
  ctx.stroke();

  // A painted strake along the gunports: the navy's ochre, Spain's red and gold.
  ctx.save();
  path(p, g.outline);
  ctx.clip();
  ctx.strokeStyle = livery.band;
  ctx.lineWidth = 0.09 * u;
  path(p, insetOutline(g, mid, 0.1));
  ctx.stroke();
  if (livery.trim) {
    ctx.strokeStyle = livery.trim;
    ctx.lineWidth = 0.018 * u;
    for (const inset of [0.055, 0.145]) {
      path(p, insetOutline(g, mid, inset));
      ctx.stroke();
    }
  }
  ctx.restore();

  // Gunports along the guns' stretch of the hull.
  const guns = [...ship.rooms.values()].find((r) => r.def.system === 'guns')?.def;
  if (guns) {
    for (let i = 0; i < guns.w; i++) {
      const x = guns.x + i + 0.5;
      for (const s of [-1, 1]) {
        const y = mid + s * (g.half(x) - 0.09);
        ctx.fillStyle = '#0d0805';
        ctx.fillRect(X(x) - 0.14 * u, Y(y) - 0.05 * u, 0.28 * u, 0.1 * u);
        ctx.strokeStyle = '#8a5a30';
        ctx.lineWidth = 0.02 * u;
        ctx.strokeRect(X(x) - 0.14 * u, Y(y) - 0.05 * u, 0.28 * u, 0.1 * u);
      }
    }
  }

  // Bulwark cap rail.
  ctx.strokeStyle = '#7d5230';
  ctx.lineWidth = 0.1 * u;
  path(p, insetOutline(g, mid, 0.2));
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,220,170,0.35)';
  ctx.lineWidth = 0.02 * u;
  path(p, insetOutline(g, mid, 0.17));
  ctx.stroke();

  // Deck planking.
  ctx.save();
  path(p, g.deck);
  ctx.clip();
  paintPlanks(scene, p, ship, g);
  ctx.restore();
  ctx.strokeStyle = 'rgba(20,10,4,0.7)';
  ctx.lineWidth = 0.04 * u;
  path(p, g.deck);
  ctx.stroke();

  // Raised decks: the poop of a stern castle and the forecastle, each breaking down to the waist with a shadow.
  const rooms = [...ship.rooms.values()].map((r) => r.def);
  if (st.castle) {
    const helm = rooms.find((r) => r.system === 'helm');
    raisedDeck(p, g, mid, g.stern, helm ? helm.x + helm.w : 2, 1, livery.trim ?? '#c9a24a');
  }
  if (st.forecastle) {
    const fore = Math.min(...rooms.filter((r) => r.x + r.w === ship.width).map((r) => r.x));
    raisedDeck(p, g, mid, fore, g.tip, -1, livery.trim);
  }

  // Stern gallery windows and lanterns.
  const sx = g.stern + 0.32;
  for (let i = -1; i <= 1; i++) {
    if (st.transom < 0.6) break;
    const wy = mid + i * 0.42;
    ctx.fillStyle = '#ffd27a';
    ctx.fillRect(X(sx) - 0.07 * u, Y(wy) - 0.12 * u, 0.14 * u, 0.24 * u);
    ctx.strokeStyle = '#2b1a0d';
    ctx.lineWidth = 0.03 * u;
    ctx.strokeRect(X(sx) - 0.07 * u, Y(wy) - 0.12 * u, 0.14 * u, 0.24 * u);
  }
  for (const s of [-1, 1]) lantern(ctx, X(g.stern + 0.2), Y(mid + s * (g.half(g.stern + 0.2) - 0.12)), u);
  lantern(ctx, X(g.tip - 0.55), Y(mid), u * 0.8);
}

function insetOutline(g: ShipGeometry, mid: number, inset: number): Vec[] {
  return profile(g.stern + inset, g.tip - inset * 2.2, mid, (x) => g.half(x, inset), 0.12 + (1 - g.style.transom) * 0.45);
}

/** A deck raised over the waist between x0 and x1; `dir` 1 breaks forward (a stern castle), -1 aft (a forecastle). */
function raisedDeck(p: Painter, g: ShipGeometry, mid: number, x0: number, x1: number, dir: 1 | -1, trim: string | null): void {
  const { ctx, u, X, Y } = p;
  const bx = dir === 1 ? x1 : x0;
  ctx.save();
  path(p, g.deck);
  ctx.clip();
  // A stern castle towers well above the waist: warmer, sunlit planking, a deep shadow and a gilded taffrail.
  const castle = dir === 1;
  const drop = castle ? 0.6 : 0.45;
  ctx.fillStyle = castle ? 'rgba(255,214,150,0.14)' : 'rgba(255,236,200,0.08)';
  ctx.fillRect(X(x0), 0, (x1 - x0) * u, ctx.canvas.height);
  const sh = ctx.createLinearGradient(X(bx), 0, X(bx + dir * drop), 0);
  sh.addColorStop(0, `rgba(10,5,0,${castle ? 0.62 : 0.5})`);
  sh.addColorStop(1, 'rgba(10,5,0,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(Math.min(X(bx), X(bx + dir * drop)), 0, drop * u, ctx.canvas.height);
  if (castle && trim) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, X(x1), ctx.canvas.height);
    ctx.clip();
    ctx.strokeStyle = trim;
    ctx.lineWidth = 0.09 * u;
    path(p, g.deck);
    ctx.stroke();
    ctx.restore();
  }
  // The breast rail across the break, with turned balusters.
  const hw = g.half(bx, 0.28);
  ctx.strokeStyle = '#4a2a12';
  ctx.lineWidth = 0.13 * u;
  ctx.beginPath();
  ctx.moveTo(X(bx), Y(mid - hw));
  ctx.lineTo(X(bx), Y(mid + hw));
  ctx.stroke();
  ctx.strokeStyle = '#a8743f';
  ctx.lineWidth = 0.05 * u;
  ctx.stroke();
  ctx.fillStyle = trim ?? '#d8c08a';
  for (let y = mid - hw + 0.2; y < mid + hw - 0.1; y += 0.32) {
    ctx.beginPath();
    ctx.arc(X(bx), Y(y), 0.035 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A glazed gallery bulging from the stern quarter. */
function quarterGallery(p: Painter, g: ShipGeometry, mid: number, side: number, trim: string): void {
  const { ctx, u, X, Y } = p;
  const cx = g.stern + 0.85;
  const cy = mid + side * (g.half(cx) - 0.02);
  ctx.beginPath();
  ctx.ellipse(X(cx), Y(cy), 0.55 * u, 0.22 * u, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#35200f';
  ctx.fill();
  ctx.strokeStyle = trim;
  ctx.lineWidth = 0.03 * u;
  ctx.stroke();
  for (let i = -1; i <= 1; i++) {
    ctx.fillStyle = '#ffcf78';
    ctx.fillRect(X(cx + i * 0.26) - 0.06 * u, Y(cy + side * 0.1) - 0.04 * u, 0.12 * u, 0.08 * u);
  }
}

/** A carved beakhead under the bowsprit, with a gilded figurehead at its point. */
function beakhead(p: Painter, g: ShipGeometry, mid: number, trim: string): void {
  const { ctx, u, X, Y } = p;
  const t = g.tip;
  path(p, [
    { x: t - 0.7, y: mid - 0.3 },
    { x: t + 0.7, y: mid - 0.08 },
    { x: t + 0.95, y: mid },
    { x: t + 0.7, y: mid + 0.08 },
    { x: t - 0.7, y: mid + 0.3 },
  ]);
  ctx.fillStyle = '#4a2c14';
  ctx.fill();
  ctx.strokeStyle = '#1d1007';
  ctx.lineWidth = 0.03 * u;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20,10,4,0.6)';
  ctx.lineWidth = 0.015 * u;
  for (let x = t - 0.4; x < t + 0.6; x += 0.14) {
    const hw = 0.3 - ((x - t + 0.7) / 1.4) * 0.22;
    ctx.beginPath();
    ctx.moveTo(X(x), Y(mid - hw));
    ctx.lineTo(X(x), Y(mid + hw));
    ctx.stroke();
  }
  ctx.fillStyle = trim;
  ctx.beginPath();
  ctx.ellipse(X(t + 0.82), Y(mid), 0.13 * u, 0.06 * u, 0, 0, Math.PI * 2);
  ctx.fill();
}

function paintPlanks(scene: Phaser.Scene, p: Painter, ship: Ship, g: ShipGeometry): void {
  const { ctx, u, X, Y, rnd } = p;
  const x0 = X(g.stern);
  const x1 = X(g.tip);
  const y0 = Y(ship.height / 2 - g.beam);
  const y1 = Y(ship.height / 2 + g.beam);
  const ph = 0.2 * u;
  for (let y = y0; y < y1; y += ph) {
    let x = x0 - rnd.next() * 2 * u;
    while (x < x1) {
      const len = (1.6 + rnd.next() * 2.4) * u;
      const l = 40 + rnd.next() * 9;
      ctx.fillStyle = `hsl(${28 + rnd.next() * 6}, ${38 + rnd.next() * 10}%, ${l}%)`;
      ctx.fillRect(x, y, len, ph);
      ctx.fillStyle = 'rgba(40,22,8,0.6)';
      ctx.fillRect(x, y, 0.015 * u, ph);
      ctx.fillStyle = 'rgba(30,16,6,0.5)';
      ctx.fillRect(x + 0.06 * u, y + ph * 0.3, 0.025 * u, 0.025 * u);
      ctx.fillRect(x + 0.06 * u, y + ph * 0.65, 0.025 * u, 0.025 * u);
      x += len;
    }
    ctx.fillStyle = 'rgba(35,18,6,0.65)';
    ctx.fillRect(x0, y, x1 - x0, 0.022 * u);
  }
  const grain = sourceImage(scene, 'art:tex-deck');
  if (grain) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = pattern(ctx, grain, (1.1 * u) / 150)!;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }
  const sun = ctx.createRadialGradient(X(1), Y(-0.5), 0, X(1), Y(-0.5), 9 * u);
  sun.addColorStop(0, 'rgba(255,236,190,0.18)');
  sun.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = sun;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

// --- Compartments and fittings ---------------------------------------------

const ROOM_TINT: Record<string, string> = {
  helm: 'rgba(120,70,30,0.10)',
  sails: 'rgba(0,0,0,0.06)',
  guns: 'rgba(40,20,10,0.16)',
  pumps: 'rgba(20,40,60,0.14)',
  surgeon: 'rgba(120,30,30,0.08)',
};

function paintCompartments(scene: Phaser.Scene, p: Painter, ship: Ship, g: ShipGeometry): void {
  const { ctx, u, X, Y } = p;
  void scene;
  void g;
  for (const room of ship.rooms.values()) {
    const d = room.def;
    const x = X(d.x);
    const y = Y(d.y);
    const w = d.w * u;
    const h = d.h * u;
    ctx.fillStyle = 'rgba(25,12,4,0.18)';
    ctx.fillRect(x, y, w, h);
    if (d.system && ROOM_TINT[d.system]) {
      ctx.fillStyle = ROOM_TINT[d.system];
      ctx.fillRect(x, y, w, h);
    }
    // Inner shadow under the bulkheads.
    const e = 0.16 * u;
    const edges: [number, number, number, number, number, number, number, number][] = [
      [x, y, w, e, x, y, x, y + e],
      [x, y + h - e, w, e, x, y + h, x, y + h - e],
      [x, y, e, h, x, y, x + e, y],
      [x + w - e, y, e, h, x + w, y, x + w - e, y],
    ];
    for (const [rx, ry, rw, rh, gx0, gy0, gx1, gy1] of edges) {
      const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      grad.addColorStop(0, 'rgba(10,5,0,0.35)');
      grad.addColorStop(1, 'rgba(10,5,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(rx, ry, rw, rh);
    }
    paintFittings(p, d);
  }

  // Bulkheads.
  for (const room of ship.rooms.values()) {
    const d = room.def;
    ctx.strokeStyle = '#2a170a';
    ctx.lineWidth = 0.09 * u;
    ctx.strokeRect(X(d.x), Y(d.y), d.w * u, d.h * u);
    ctx.strokeStyle = 'rgba(255,222,170,0.22)';
    ctx.lineWidth = 0.02 * u;
    ctx.strokeRect(X(d.x) + 0.055 * u, Y(d.y) + 0.055 * u, d.w * u - 0.11 * u, d.h * u - 0.11 * u);
  }

  // Doors: hatches let into the bulkheads.
  for (const door of ship.doors) {
    const ax = door.ta.x + 0.5;
    const ay = door.ta.y + 0.5;
    const bx = door.tb.x + 0.5;
    const by = door.tb.y + 0.5;
    const cx = X((ax + bx) / 2);
    const cy = Y((ay + by) / 2);
    const across = Math.abs(ax - bx) > Math.abs(ay - by);
    const dw = (across ? 0.2 : 0.56) * u;
    const dh = (across ? 0.56 : 0.2) * u;
    ctx.fillStyle = '#8b5a2e';
    ctx.fillRect(cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.strokeStyle = '#2a170a';
    ctx.lineWidth = 0.035 * u;
    ctx.strokeRect(cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.fillStyle = '#c9a36a';
    if (across) ctx.fillRect(cx - 0.02 * u, cy - dh / 2 + 0.06 * u, 0.04 * u, dh - 0.12 * u);
    else ctx.fillRect(cx - dw / 2 + 0.06 * u, cy - 0.02 * u, dw - 0.12 * u, 0.04 * u);
  }
}

function paintFittings(p: Painter, d: RoomDef): void {
  const { ctx, u, X, Y, rnd } = p;
  const cx = d.x + d.w / 2;
  const cy = d.y + d.h / 2;
  const name = d.name.toLowerCase();
  switch (d.system) {
    case 'helm':
      binnacle(ctx, X(cx + 0.35), Y(cy), u);
      wheel(ctx, X(cx - 0.1), Y(cy), u * 0.3);
      return;
    case 'sails':
      fifeRail(ctx, X(cx), Y(cy), u);
      for (const [dx, dy] of [
        [-0.35, -0.6],
        [0.35, 0.62],
      ])
        if (d.h > 1) coil(ctx, X(cx + dx), Y(cy + dy), u * 0.13);
      return;
    case 'guns':
      for (let i = 0; i < d.w; i++) {
        const x = X(d.x + i + 0.5);
        cannon(ctx, x, Y(d.y + 0.3), -Math.PI / 2, u);
        if (d.h > 1) cannon(ctx, x, Y(d.y + d.h - 0.3), Math.PI / 2, u);
      }
      if (d.h > 2) for (let i = 0; i < d.w; i += 2) shotRack(ctx, X(d.x + i + 0.5), Y(cy), u);
      return;
    case 'pumps':
      for (let i = 0; i < Math.min(2, d.w); i++) pump(ctx, X(d.x + 0.5 + i * (d.w - 1)), Y(cy), u);
      grate(ctx, X(cx), Y(cy), u * Math.min(0.8, d.w * 0.3), u * 0.5);
      return;
    case 'surgeon':
      cot(ctx, X(d.x + 0.55), Y(cy), u);
      if (d.w > 1) chest(ctx, X(d.x + d.w - 0.4), Y(cy), u, '#5b3a1e', true);
      return;
  }
  if (name.includes('magazine') || name.includes('hold')) {
    for (let i = 0; i < d.w * d.h * 2; i++) barrel(ctx, X(d.x + 0.3 + rnd.next() * (d.w - 0.6)), Y(d.y + 0.3 + rnd.next() * (d.h - 0.6)), u * 0.15);
    return;
  }
  if (name.includes('quarters') || name.includes('mess') || name.includes('berth')) {
    for (let i = 0; i < d.w; i++) hammock(ctx, X(d.x + i + 0.5), Y(cy), u, d.h);
    return;
  }
  if (name.includes('fore') || name.includes('bow')) {
    capstan(ctx, X(cx), Y(cy), u);
    coil(ctx, X(cx + 0.3 * d.w - 0.1), Y(d.y + 0.3), u * 0.12);
    return;
  }
  // Any other room: stores.
  crate(ctx, X(d.x + 0.35), Y(d.y + 0.35), u * 0.3, rnd.next() * 0.3);
  barrel(ctx, X(d.x + d.w - 0.3), Y(d.y + d.h - 0.3), u * 0.15);
}

// --- Fitting painters (all in canvas pixels) ---------------------------------

function spar(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number): void {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0);
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, -w0 / 2);
  ctx.lineTo(len, -w1 / 2);
  ctx.lineTo(len, w1 / 2);
  ctx.lineTo(0, w0 / 2);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, -w0 / 2, 0, w0 / 2);
  grad.addColorStop(0, '#a87346');
  grad.addColorStop(0.5, '#6e4420');
  grad.addColorStop(1, '#3d2410');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#1d1007';
  ctx.lineWidth = Math.max(1, w1 * 0.25);
  ctx.stroke();
  ctx.restore();
}

function lantern(ctx: Ctx, x: number, y: number, u: number): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 0.45 * u);
  glow.addColorStop(0, 'rgba(255,210,120,0.55)');
  glow.addColorStop(1, 'rgba(255,180,80,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 0.45 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe2a0';
  ctx.strokeStyle = '#2b1a0d';
  ctx.lineWidth = 0.025 * u;
  ctx.beginPath();
  ctx.arc(x, y, 0.07 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function wheel(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#2b1a0d';
  ctx.lineWidth = r * 0.18;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3);
    ctx.stroke();
  }
  ctx.strokeStyle = '#9a6538';
  ctx.lineWidth = r * 0.1;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 1.28, Math.sin(a) * r * 1.28);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
  ctx.strokeStyle = '#2b1a0d';
  ctx.lineWidth = r * 0.3;
  ctx.stroke();
  ctx.strokeStyle = '#b07a46';
  ctx.lineWidth = r * 0.17;
  ctx.stroke();
  ctx.fillStyle = '#c8a050';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2b1a0d';
  ctx.lineWidth = r * 0.06;
  ctx.stroke();
  ctx.restore();
}

function binnacle(ctx: Ctx, x: number, y: number, u: number): void {
  const s = 0.22 * u;
  ctx.fillStyle = '#6b4321';
  ctx.strokeStyle = '#2b1a0d';
  ctx.lineWidth = 0.03 * u;
  ctx.fillRect(x - s / 2, y - s / 2, s, s);
  ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  ctx.fillStyle = '#c8b48a';
  ctx.beginPath();
  ctx.arc(x, y, s * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a0402a';
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.25);
  ctx.lineTo(x, y + s * 0.25);
  ctx.stroke();
}

function fifeRail(ctx: Ctx, x: number, y: number, u: number): void {
  const s = 0.62 * u;
  ctx.strokeStyle = '#2b1a0d';
  ctx.lineWidth = 0.1 * u;
  ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  ctx.strokeStyle = '#a06c3c';
  ctx.lineWidth = 0.06 * u;
  ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  ctx.fillStyle = '#e4d3a8';
  for (let i = 0; i < 4; i++) {
    const t = -s / 2 + (s * (i + 0.5)) / 4;
    for (const [px, py] of [
      [x + t, y - s / 2],
      [x + t, y + s / 2],
    ]) {
      ctx.beginPath();
      ctx.arc(px, py, 0.025 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function cannon(ctx: Ctx, x: number, y: number, ang: number, u: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  // Carriage.
  ctx.fillStyle = '#5c3a1c';
  ctx.strokeStyle = '#1d1007';
  ctx.lineWidth = 0.025 * u;
  ctx.fillRect(-0.22 * u, -0.15 * u, 0.32 * u, 0.3 * u);
  ctx.strokeRect(-0.22 * u, -0.15 * u, 0.32 * u, 0.3 * u);
  ctx.fillStyle = '#2a1a0c';
  for (const [wx, wy] of [
    [-0.2, -0.19],
    [-0.2, 0.13],
    [0.02, -0.19],
    [0.02, 0.13],
  ])
    ctx.fillRect(wx * u, wy * u, 0.09 * u, 0.06 * u);
  // Barrel.
  const grad = ctx.createLinearGradient(0, -0.07 * u, 0, 0.07 * u);
  grad.addColorStop(0, '#6a6a68');
  grad.addColorStop(0.45, '#2e2e2e');
  grad.addColorStop(1, '#111');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-0.25 * u, -0.075 * u);
  ctx.lineTo(0.38 * u, -0.05 * u);
  ctx.lineTo(0.38 * u, 0.05 * u);
  ctx.lineTo(-0.25 * u, 0.075 * u);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0a0a0a';
  ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(-0.29 * u, 0, 0.04 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(0.34 * u, -0.065 * u, 0.05 * u, 0.13 * u);
  ctx.restore();
}

function shotRack(ctx: Ctx, x: number, y: number, u: number): void {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath();
      ctx.arc(x + (i - 1) * 0.1 * u, y + (j - 0.5) * 0.1 * u, 0.045 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function pump(ctx: Ctx, x: number, y: number, u: number): void {
  ctx.fillStyle = '#3d3d3d';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 0.03 * u;
  ctx.beginPath();
  ctx.arc(x, y, 0.13 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#7a7a76';
  ctx.beginPath();
  ctx.arc(x - 0.03 * u, y - 0.03 * u, 0.05 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b4321';
  ctx.lineWidth = 0.05 * u;
  ctx.beginPath();
  ctx.moveTo(x, y - 0.3 * u);
  ctx.lineTo(x, y + 0.3 * u);
  ctx.stroke();
}

function grate(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(10,6,2,0.65)';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = '#8b5a2e';
  ctx.lineWidth = Math.max(1, w * 0.05);
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + (w * i) / 4, y - h / 2);
    ctx.lineTo(x - w / 2 + (w * i) / 4, y + h / 2);
    ctx.moveTo(x - w / 2, y - h / 2 + (h * i) / 4);
    ctx.lineTo(x + w / 2, y - h / 2 + (h * i) / 4);
    ctx.stroke();
  }
  ctx.strokeStyle = '#2a170a';
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
}

function cot(ctx: Ctx, x: number, y: number, u: number): void {
  const w = 0.75 * u;
  const h = 0.36 * u;
  ctx.fillStyle = '#4a2e16';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = '#e8dfc8';
  ctx.fillRect(x - w / 2 + 0.04 * u, y - h / 2 + 0.04 * u, w - 0.08 * u, h - 0.08 * u);
  ctx.fillStyle = '#7b2d26';
  ctx.fillRect(x - w / 2 + 0.24 * u, y - h / 2 + 0.04 * u, w - 0.28 * u, h - 0.08 * u);
  ctx.strokeStyle = '#2a170a';
  ctx.lineWidth = 0.025 * u;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
}

function chest(ctx: Ctx, x: number, y: number, u: number, color: string, cross = false): void {
  const s = 0.3 * u;
  ctx.fillStyle = color;
  ctx.fillRect(x - s / 2, y - s / 2, s, s * 0.75);
  ctx.strokeStyle = '#1d1007';
  ctx.lineWidth = 0.025 * u;
  ctx.strokeRect(x - s / 2, y - s / 2, s, s * 0.75);
  if (cross) {
    ctx.fillStyle = '#c23b2e';
    ctx.fillRect(x - 0.025 * u, y - s / 2 + 0.05 * u, 0.05 * u, s * 0.75 - 0.1 * u);
    ctx.fillRect(x - s / 2 + 0.06 * u, y - s / 2 + s * 0.375 - 0.025 * u, s - 0.12 * u, 0.05 * u);
  }
}

function barrel(ctx: Ctx, x: number, y: number, r: number): void {
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grad.addColorStop(0, '#b07a46');
  grad.addColorStop(1, '#5a3618');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1d1007';
  ctx.lineWidth = r * 0.14;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(30,20,10,0.8)';
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.65, 0, Math.PI * 2);
  ctx.stroke();
}

function crate(ctx: Ctx, x: number, y: number, s: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = '#a06c3a';
  ctx.fillRect(-s / 2, -s / 2, s, s);
  ctx.strokeStyle = '#3a220e';
  ctx.lineWidth = s * 0.08;
  ctx.strokeRect(-s / 2, -s / 2, s, s);
  ctx.beginPath();
  ctx.moveTo(-s / 2, -s / 2);
  ctx.lineTo(s / 2, s / 2);
  ctx.moveTo(s / 2, -s / 2);
  ctx.lineTo(-s / 2, s / 2);
  ctx.stroke();
  ctx.restore();
}

function hammock(ctx: Ctx, x: number, y: number, u: number, rows: number): void {
  const h = Math.min(rows, 2) * 0.7 * u;
  ctx.strokeStyle = 'rgba(40,25,10,0.7)';
  ctx.lineWidth = 0.02 * u;
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2 - 0.08 * u);
  ctx.lineTo(x, y + h / 2 + 0.08 * u);
  ctx.stroke();
  ctx.fillStyle = '#d8c9a3';
  ctx.beginPath();
  ctx.ellipse(x, y, 0.16 * u, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b5a3a';
  ctx.stroke();
}

function capstan(ctx: Ctx, x: number, y: number, u: number): void {
  ctx.strokeStyle = '#4a2e16';
  ctx.lineWidth = 0.06 * u;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 0.36 * u, y + Math.sin(a) * 0.36 * u);
    ctx.stroke();
  }
  const grad = ctx.createRadialGradient(x - 0.04 * u, y - 0.04 * u, 0, x, y, 0.16 * u);
  grad.addColorStop(0, '#b07a46');
  grad.addColorStop(1, '#5a3618');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, 0.16 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1d1007';
  ctx.lineWidth = 0.03 * u;
  ctx.stroke();
}

function coil(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.strokeStyle = '#c9b07a';
  ctx.lineWidth = r * 0.22;
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 6; a += 0.2) {
    const rr = r * (0.2 + (a / (Math.PI * 6)) * 0.8);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (a === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(60,40,15,0.6)';
  ctx.lineWidth = r * 0.06;
  ctx.stroke();
}

// --- Rig ---------------------------------------------------------------------

/** A small texture painted in the ship's own coordinates: (x, y) is its top-left corner in the hull texture, in pixels. */
export interface ShipPiece {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Paint each mast's sail furled along its spar into its own small texture, so the view can show it furled or set. */
export function paintFurls(scene: Phaser.Scene, ship: Ship, g: ShipGeometry, tile: number, keyPrefix: string): ShipPiece[] {
  const u = tile * ART_SCALE;
  return g.spars.map((s, i) => {
    const m = 0.45;
    const x0 = (Math.min(s.a.x, s.b.x) - m + g.padL) * u;
    const y0 = (Math.min(s.a.y, s.b.y) - m + g.padT) * u;
    const w = (Math.abs(s.a.x - s.b.x) + m * 2) * u;
    const h = (Math.abs(s.a.y - s.b.y) + m * 2) * u;
    const key = `${keyPrefix}-furl${i}`;
    const tex = makeCanvas(scene, key, w, h);
    const p: Painter = { ctx: tex.getContext(), u, X: (x) => (x + g.padL) * u - x0, Y: (y) => (y + g.padT) * u - y0, rnd: new Rng(hashSeed(ship.def.id) + i) };
    furledSail(p, s);
    tex.refresh();
    return { key, x: x0, y: y0, w: Math.ceil(w), h: Math.ceil(h) };
  });
}

function paintRig(p: Painter, ship: Ship, g: ShipGeometry): void {
  const { ctx, u, X, Y } = p;
  const mid = ship.height / 2;
  const sorted = [...g.masts].sort((a, b) => a.x - b.x);
  const fore = sorted[sorted.length - 1] ?? { x: ship.width / 2, y: mid };

  // Stays: bowsprit to foremast, and mast to mast.
  ctx.strokeStyle = 'rgba(25,15,8,0.55)';
  ctx.lineWidth = 0.022 * u;
  ctx.beginPath();
  ctx.moveTo(X(g.sprit - 0.05), Y(mid));
  ctx.lineTo(X(fore.x), Y(mid));
  for (let i = 1; i < sorted.length; i++) {
    ctx.moveTo(X(sorted[i - 1].x), Y(mid));
    ctx.lineTo(X(sorted[i].x), Y(mid));
  }
  ctx.stroke();

  g.spars.forEach((sp) => {
    const m = sp.mast;
    const big = sp.main;

    // Shrouds down to the rails.
    ctx.strokeStyle = 'rgba(25,15,8,0.5)';
    ctx.lineWidth = 0.02 * u;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const rx = m.x - 0.5 + k * 0.2;
        ctx.beginPath();
        ctx.moveTo(X(m.x), Y(m.y));
        ctx.lineTo(X(rx), Y(mid + s * (g.half(rx) - 0.15)));
        ctx.stroke();
      }
    }

    // The yard or boom, casting its shadow on the deck.
    const { a, b } = sp;
    const [w0, w1] = sp.kind === 'square' ? [0.13, 0.09] : sp.kind === 'gaff' ? [0.12, 0.08] : [0.1, 0.05];
    ctx.save();
    ctx.shadowColor = 'rgba(0,10,20,0.45)';
    ctx.shadowBlur = 0.25 * u;
    ctx.shadowOffsetX = 0.06 * u;
    ctx.shadowOffsetY = 0.18 * u;
    if (sp.kind === 'square') {
      // Tapering to both yardarms.
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      spar(ctx, X(c.x), Y(c.y), X(a.x), Y(a.y), w0 * u, w1 * u);
      spar(ctx, X(c.x), Y(c.y), X(b.x), Y(b.y), w0 * u, w1 * u);
    } else spar(ctx, X(a.x), Y(a.y), X(b.x), Y(b.y), w0 * u, w1 * u);
    ctx.restore();

    // Masthead and fighting top.
    const topS = (big ? 0.4 : 0.3) * u;
    ctx.save();
    ctx.shadowColor = 'rgba(0,10,20,0.4)';
    ctx.shadowBlur = 0.2 * u;
    ctx.shadowOffsetY = 0.15 * u;
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(X(m.x) - topS / 2, Y(m.y) - topS / 2, topS, topS);
    ctx.restore();
    ctx.strokeStyle = '#1d1007';
    ctx.lineWidth = 0.03 * u;
    ctx.strokeRect(X(m.x) - topS / 2, Y(m.y) - topS / 2, topS, topS);
    ctx.strokeStyle = 'rgba(255,220,170,0.25)';
    ctx.strokeRect(X(m.x) - topS / 2 + 0.04 * u, Y(m.y) - topS / 2 + 0.04 * u, topS - 0.08 * u, topS - 0.08 * u);
    const mg = ctx.createRadialGradient(X(m.x) - 0.04 * u, Y(m.y) - 0.04 * u, 0, X(m.x), Y(m.y), 0.11 * u);
    mg.addColorStop(0, '#b07a46');
    mg.addColorStop(1, '#4a2c12');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(X(m.x), Y(m.y), 0.11 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1d1007';
    ctx.stroke();
  });

  // The ensign staff at the taffrail (the flag itself is waved by the view).
  ctx.fillStyle = '#3d2410';
  ctx.beginPath();
  ctx.arc(X(g.stern + 0.1), Y(mid), 0.05 * u, 0, Math.PI * 2);
  ctx.fill();
}

/** A lumpy bundle of canvas lashed along a spar. */
function furledSail(p: Painter, sp: Spar): void {
  const { ctx, u, X, Y } = p;
  const { a, b } = sp;
  const big = sp.main;
  const len = Math.hypot(X(b.x) - X(a.x), Y(b.y) - Y(a.y));
  ctx.save();
  ctx.translate(X(a.x), Y(a.y));
  ctx.rotate(Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x)));
  const inset = (sp.kind === 'gaff' ? 0.1 : 0.22) * u;
  const thick = (big ? 0.2 : 0.17) * u;
  const off = -0.07 * u;
  // A lumpy bundle of canvas.
  const steps = Math.max(6, Math.round((len - inset * 2) / (0.26 * u)));
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const x = inset + ((len - inset * 2) * i) / steps;
    const taper = Math.sin((Math.PI * i) / steps) * 0.55 + 0.45;
    const y = off - thick * taper * (0.92 + 0.08 * Math.sin(i * 2.3));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const x = inset + ((len - inset * 2) * i) / steps;
    const taper = Math.sin((Math.PI * i) / steps) * 0.55 + 0.45;
    ctx.lineTo(x, off + thick * 0.35 * taper);
  }
  ctx.closePath();
  const cloth = ctx.createLinearGradient(0, off - thick, 0, off + thick * 0.35);
  cloth.addColorStop(0, '#f4ecd6');
  cloth.addColorStop(0.6, '#d9cdae');
  cloth.addColorStop(1, '#a69676');
  ctx.fillStyle = cloth;
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,45,25,0.85)';
  ctx.lineWidth = 0.022 * u;
  ctx.stroke();
  // Folds and gaskets.
  ctx.strokeStyle = 'rgba(120,100,70,0.45)';
  ctx.lineWidth = 0.015 * u;
  for (let x = inset + 0.13 * u; x < len - inset; x += 0.13 * u) {
    ctx.beginPath();
    ctx.moveTo(x, off - thick * 0.75);
    ctx.lineTo(x + 0.04 * u, off + thick * 0.2);
    ctx.stroke();
  }
  ctx.strokeStyle = '#4a3218';
  ctx.lineWidth = 0.03 * u;
  for (let x = inset + 0.3 * u; x < len - inset - 0.1 * u; x += 0.5 * u) {
    ctx.beginPath();
    ctx.moveTo(x, off - thick * 0.95);
    ctx.lineTo(x, off + thick * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A small ensign streaming astern from a staff at (fx, fy): the Jolly Roger, the red ensign, Spain's Burgundy cross
 * or a merchant's house flag. Painted bow-right, so it flies toward -x; the view mirrors it for the enemy.
 */
function paintEnsign(ctx: Ctx, fx: number, fy: number, u: number, flag: Ensign): void {
  const L = 1.05 * u;
  const H = 0.27 * u;
  /** Flag-local point: t runs 0 (hoist, at the staff) to 1 (fly), v from -1 (top edge) to 1 (bottom edge). */
  const at = (t: number, v: number) => ({ x: fx - t * L, y: fy + v * H });

  ctx.fillStyle = '#3d2410';
  ctx.beginPath();
  ctx.arc(fx, fy, 0.05 * u, 0, Math.PI * 2);
  ctx.fill();

  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(fx, fy - H);
    ctx.bezierCurveTo(fx - 0.35 * L, fy - H * 1.45, fx - 0.65 * L, fy - H * 0.45, fx - L, fy - H * 0.95);
    ctx.lineTo(fx - L, fy + H * 1.05);
    ctx.bezierCurveTo(fx - 0.65 * L, fy + H * 1.55, fx - 0.35 * L, fy + H * 0.55, fx, fy + H);
    ctx.closePath();
  };
  const field: Record<Ensign, string> = { pirate: '#141414', navy: '#b3261e', spanish: '#efe9da', trade: '#1f4f8a' };
  outline();
  ctx.save();
  ctx.shadowColor = 'rgba(0,10,20,0.4)';
  ctx.shadowBlur = 0.15 * u;
  ctx.shadowOffsetY = 0.15 * u;
  ctx.fillStyle = field[flag];
  ctx.fill();
  ctx.restore();

  ctx.save();
  outline();
  ctx.clip();
  const band = (t0: number, v0: number, t1: number, v1: number, width: number, color: string) => {
    const a = at(t0, v0);
    const b = at(t1, v1);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  switch (flag) {
    case 'pirate': {
      // Crossed bones beneath a skull: knobbed ends so they read as bones, not a cross.
      const bone = (t0: number, v0: number, t1: number, v1: number) => {
        band(t0, v0, t1, v1, 0.045 * u, '#ece6d6');
        ctx.fillStyle = '#ece6d6';
        for (const [t, v] of [
          [t0, v0],
          [t1, v1],
        ]) {
          const p = at(t, v);
          ctx.beginPath();
          ctx.arc(p.x - 0.025 * u, p.y - 0.012 * u, 0.028 * u, 0, Math.PI * 2);
          ctx.arc(p.x + 0.025 * u, p.y + 0.012 * u, 0.028 * u, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      bone(0.3, 0.05, 0.7, 0.8);
      bone(0.7, 0.05, 0.3, 0.8);
      const s = at(0.5, -0.3);
      const r = 0.105 * u;
      ctx.fillStyle = '#ece6d6';
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(s.x - r * 0.55, s.y + r * 0.4, r * 1.1, r * 0.75);
      ctx.fillStyle = '#141414';
      ctx.beginPath();
      ctx.arc(s.x - r * 0.4, s.y + r * 0.05, r * 0.28, 0, Math.PI * 2);
      ctx.arc(s.x + r * 0.4, s.y + r * 0.05, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(s.x - r * 0.05, s.y + r * 0.85, r * 0.1, r * 0.3);
      break;
    }
    case 'navy': {
      // The red ensign: the Union in the canton at the hoist.
      const c0 = at(0, -1.2);
      const cw = 0.42 * L;
      const ch = H * 1.2;
      ctx.fillStyle = '#1d2f6b';
      ctx.fillRect(c0.x - cw, c0.y, cw, ch);
      ctx.save();
      ctx.beginPath();
      ctx.rect(c0.x - cw, c0.y, cw, ch);
      ctx.clip();
      band(0, -1.2, 0.42, 0, 0.06 * u, '#f2efe6');
      band(0.42, -1.2, 0, 0, 0.06 * u, '#f2efe6');
      band(0.21, -1.2, 0.21, 0, 0.09 * u, '#f2efe6');
      band(0, -0.6, 0.42, -0.6, 0.09 * u, '#f2efe6');
      band(0.21, -1.2, 0.21, 0, 0.05 * u, '#c8202a');
      band(0, -0.6, 0.42, -0.6, 0.05 * u, '#c8202a');
      ctx.restore();
      break;
    }
    case 'spanish': {
      // The Cross of Burgundy: a red saltire of rough-hewn staves, knots left on the branches.
      band(0.1, -1.05, 0.9, 1.05, 0.075 * u, '#b8231c');
      band(0.1, 1.05, 0.9, -1.05, 0.075 * u, '#b8231c');
      ctx.fillStyle = '#b8231c';
      for (const k of [0.25, 0.4, 0.6, 0.75]) {
        for (const dir of [1, -1]) {
          const p = at(0.1 + 0.8 * k, dir * (-1.05 + 2.1 * k));
          ctx.beginPath();
          ctx.arc(p.x + ((k * 7) % 2 > 1 ? 1 : -1) * 0.04 * u, p.y - dir * 0.03 * u, 0.026 * u, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'trade':
      // A merchant house flag: blue, with a broad white band and a red ball.
      band(0, 0, 1.1, 0, H * 0.7, '#efe9da');
      ctx.fillStyle = '#b8231c';
      ctx.beginPath();
      ctx.arc(at(0.45, 0).x, at(0.45, 0).y, 0.07 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
  outline();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 0.02 * u;
  ctx.stroke();
}
